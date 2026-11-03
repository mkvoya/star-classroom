// Only connection descriptions are stored on the server, never file contents.
export type FileSignal = { id: string; memberId: string; offer: string; answer?: string; at: number };
export type FileState = { session: string; seen: number; signals: Record<string, FileSignal> };
export type FileView = { session: string | null; signals: FileSignal[] };
const LEASE = 20000;
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
export function fileView(state: FileState | undefined, teacher: boolean, memberId?: string, include = false, now = Date.now()): FileView {
  if (!state || now - state.seen >= LEASE) return { session: null, signals: [] };
  return { session: state.session, signals: include ? Object.values(state.signals).filter(s => now-s.at < 120000 && (teacher || s.memberId === memberId)) : [] };
}
export function updateFiles(previous: FileState | undefined, body: Record<string, unknown>, teacher: boolean, memberId?: string, now = Date.now()): FileState | undefined {
  if (body.action === 'files-open') {
    if (!teacher || !validId(body.session)) throw new Error('只有老师可以开启接收。');
    return { session: body.session, seen: now, signals: {} };
  }
  if (!previous || previous.session !== body.session || now-previous.seen >= LEASE) throw new Error('老师已停止接收，请等待老师重新开启。');
  const state = { ...previous, signals: Object.fromEntries(Object.entries(previous.signals).filter(([,s])=>now-s.at<120000)) };
  if (body.action === 'files-pulse' || body.action === 'files-close') {
    if (!teacher) throw new Error('只有老师可以操作接收状态。');
    return body.action === 'files-close' ? undefined : { ...state, seen: now };
  }
  if (!validId(body.id)) throw new Error('传输编号无效。');
  if (body.action === 'files-offer') {
    if (teacher || !memberId || typeof body.sdp !== 'string' || body.sdp.length > 12000 || !body.sdp.startsWith('v=0')) throw new Error('连接请求无效。');
    state.signals[memberId] = { id: body.id, memberId, offer: body.sdp, at: now };
  } else if (body.action === 'files-answer') {
    if (!teacher || typeof body.memberId !== 'string' || typeof body.sdp !== 'string' || body.sdp.length > 12000 || !body.sdp.startsWith('v=0')) throw new Error('连接应答无效。');
    const signal = state.signals[body.memberId];
    if (!signal || signal.id !== body.id) throw new Error('学生已重试，请重新连接。');
    signal.answer = body.sdp;
  } else throw new Error('不支持这个文件操作。');
  return state;
}
