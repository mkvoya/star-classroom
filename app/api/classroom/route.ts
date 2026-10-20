import { getDb } from '@/db';
import { classrooms, classroomRounds } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Classroom } from '@/app/classroom';
export const dynamic = 'force-dynamic';
type Person = { id: string; key: string; name: string; lastSeen: number };
type State = { teacherKey: string; teacherName: string; members: Person[]; round: number; status: Classroom['status']; roster: string[]; answers: Record<string,string> };
class Problem extends Error { constructor(message: string, public status = 400) { super(message); } }
function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
async function key(request: Request) {
  const value = request.headers.get('x-classroom-key') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Problem('请先填写名字，再进入课堂。', 401);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
function name(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) throw new Problem('名字需要填写 1–20 个字。'); return value.trim(); }
function code(value: unknown) { if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw new Problem('请输入 6 位课堂码。'); return value; }
function view(s: State, roomCode: string, hash: string, revision: number): Classroom {
  const teacher = s.teacherKey === hash;
  const me = s.members.find(m => m.key === hash);
  if (!teacher && !me) throw new Problem('你还不在这个课堂，请重新加入。', 403);
  return { code: roomCode, teacherName: s.teacherName, role: teacher ? 'teacher' : 'student', myId: me?.id || null, round: s.round, status: s.status, revision,
    members: s.members.map(m => ({ id: m.id, name: m.name, online: Date.now() - m.lastSeen < 45000, participating: s.roster.includes(m.id), submitted: Object.hasOwn(s.answers, m.id), ...(s.status === 'revealed' && Object.hasOwn(s.answers, m.id) ? { answer: s.answers[m.id] } : {}) })),
    submitted: s.roster.filter(id => Object.hasOwn(s.answers,id)).length, total: s.roster.length, ownAnswer: me ? s.answers[me.id] ?? null : null };
}
function reveal(s: State) { if (s.status === 'answering' && s.roster.length > 0 && s.roster.every(id => Object.hasOwn(s.answers, id))) s.status = 'revealed'; }
async function read(roomCode: string) { const rows = await getDb().select().from(classrooms).where(eq(classrooms.code, roomCode)); if (!rows[0]) throw new Problem('没有找到这个课堂，请检查课堂码。', 404); return rows[0]; }
export async function GET(request: Request) {
  try { const hash = await key(request); const roomCode = code(new URL(request.url).searchParams.get('code')); const row = await read(roomCode); return reply(view(JSON.parse(row.state), roomCode, hash, row.revision)); }
  catch (e) { return failure(e); }
}
function failure(e: unknown) { return e instanceof Problem ? reply({ error: e.message }, e.status) : reply({ error: '暂时连接不上课堂，请稍后重试。' }, 503); }
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new Problem('请求来源不匹配。', 403);
    const hash = await key(request);
    const raw = await request.text(); if (raw.length > 8000) throw new Problem('提交内容太长了。', 413);
    let body; try { body = JSON.parse(raw); } catch { throw new Problem('请求格式有误。'); }
    if (!body || typeof body !== 'object') throw new Problem('请求格式有误。');
    if (body.action === 'create') {
      const teacherName = name(body.name);
      for (let attempt=0; attempt<5; attempt++) {
        const roomCode = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
        const state: State = { teacherKey: hash, teacherName, members: [], round: 0, status: 'waiting', roster: [], answers: {} };
        const result = await getDb().insert(classrooms).values({ code: roomCode, state: JSON.stringify(state), revision: 0, createdAt: new Date().toISOString() }).onConflictDoNothing().returning({ code: classrooms.code });
        if (result.length) return reply(view(state, roomCode, hash, 0));
      }
      throw new Problem('课堂创建繁忙，请重试。', 503);
    }
    const roomCode = code(body.code);
    for (let attempt=0; attempt<10; attempt++) {
      const row = await read(roomCode); const s: State = JSON.parse(row.state);
      const teacher = s.teacherKey === hash; let me = s.members.find(m => m.key === hash);
      const teacherOnly = () => { if (!teacher) throw new Problem('只有创建课堂的老师可以操作。', 403); };
      if (body.action === 'join') {
        const studentName = name(body.name);
        if (!teacher) {
          if (me) { me.name = studentName; me.lastSeen = Date.now(); }
          else { if (s.members.length >= 60) throw new Problem('这个课堂已经满员了（60 人）。'); me = { id: crypto.randomUUID(), key: hash, name: studentName, lastSeen: Date.now() }; s.members.push(me); }
        }
      } else {
        if (!teacher && !me) throw new Problem('你还不在这个课堂，请重新加入。', 403);
        switch (body.action) {
          case 'heartbeat': if (me) me.lastSeen = Date.now(); break;
          case 'start': teacherOnly();
            if (s.status === 'answering') throw new Problem('请先等本轮收齐答案。');
            if (body.round !== s.round) throw new Problem('课堂已更新，请稍后重试。', 409);
            if (!s.members.length) throw new Problem('至少有一位同学加入后才能开始。');
            if (s.status === 'revealed') await getDb().insert(classroomRounds).values({ id: `${roomCode}-${s.round}`, code: roomCode, round: s.round, answers: JSON.stringify(s.members.filter(m=>s.roster.includes(m.id)).map(m=>({name:m.name,answer:s.answers[m.id]}))), savedAt: new Date().toISOString() }).onConflictDoNothing();
            s.round++; s.status='answering'; s.roster=s.members.map(m => m.id); s.answers={}; break;
          case 'submit':
            if (!me || s.status !== 'answering' || body.round !== s.round || !s.roster.includes(me.id)) throw new Problem('本轮暂时不能提交，请查看课堂状态。', 409);
            if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.trim().length > 1000) throw new Problem('请填写 1–1000 字的答案。');
            if (Object.hasOwn(s.answers, me.id)) throw new Problem('你已经提交过本轮答案啦。', 409);
            s.answers[me.id]=body.answer.trim(); me.lastSeen=Date.now(); reveal(s); break;
          case 'remove': teacherOnly();
            if (typeof body.memberId !== 'string' || !s.members.some(m=>m.id===body.memberId)) throw new Problem('同学已经离开了。');
            s.members=s.members.filter(m=>m.id!==body.memberId);
            s.roster=s.roster.filter(id=>id!==body.memberId); delete s.answers[body.memberId];
            if (!s.roster.length && s.status==='answering') s.status='waiting'; else reveal(s); break;
          default: throw new Problem('不支持这个操作。');
        }
      }
      const saved = await getDb().update(classrooms).set({ state: JSON.stringify(s), revision: row.revision+1 }).where(and(eq(classrooms.code, roomCode), eq(classrooms.revision,row.revision))).returning({ revision: classrooms.revision });
      if (saved.length) return reply(view(s,roomCode,hash,row.revision+1));
    }
    throw new Problem('刚刚有很多同学在操作，请再试一次。', 409);
  } catch (e) { return failure(e); }
}
