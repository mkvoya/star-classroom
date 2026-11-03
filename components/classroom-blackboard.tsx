'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Send } from 'lucide-react';
import type { Classroom } from '@/app/classroom';
import { BLACKBOARD_LIMIT, EMPTY_BLACKBOARD } from '@/lib/blackboard';

type Draft = { text: string; baseVersion: number };
const plugins = [remarkGfm];
function MarkdownContent({ text }: { text: string }) {
  return <div className="board-markdown"><Markdown remarkPlugins={plugins} skipHtml
    components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}
  >{text}</Markdown></div>;
}

export function ClassroomBlackboard({ room, identity, onPublished }: {
  room: Classroom; identity: string; onPublished: (room: Classroom) => void;
}) {
  const teacher = room.role === 'teacher';
  const board = room.blackboard ?? EMPTY_BLACKBOARD;
  const storageKey = `tongxue-blackboard-${room.code}-${identity}`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    if (!teacher) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return saved && typeof saved.text === 'string' && saved.text.length <= BLACKBOARD_LIMIT && Number.isInteger(saved.baseVersion) ? saved : null;
    } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const text = draft?.text ?? board.markdown;
  const conflict = draft !== null && draft.baseVersion !== board.version;
  const dirty = text !== board.markdown;
  function remember(next: Draft | null) {
    setDraft(next);
    try { if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); }
    catch { setNotice('浏览器无法保存草稿，请在离开前复制备份。'); }
  }
  async function publish() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/classroom', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'x-classroom-key': identity },
        body: JSON.stringify({ action: 'blackboard-publish', code: room.code, markdown: text, boardVersion: draft?.baseVersion ?? board.version }),
      });
      const next = await response.json() as Classroom & { error?: string };
      if (!response.ok) throw new Error(next.error || '发布失败，请重试。');
      onPublished(next); remember(null); setNotice('已发布，同学们会自动看到更新。');
    } catch (e) { setError((e as Error).name === 'TimeoutError' ? '发布确认超时，草稿已保留。请查看已发布内容后再重试。' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="blackboard" aria-labelledby="blackboard-title">
    <div className="section-title"><h2 id="blackboard-title"><BookOpen size={20}/>课堂黑板</h2><span className="board-badge">{board.version ? `已发布 · 第 ${board.version} 版` : '等待老师落笔'}</span></div>
    {teacher ? <>
      <p className="board-hint">写下题目、提示或课堂笔记。编辑后点击发布，同学们会看到同一块黑板。</p>
      <div className="board-editor-grid">
        <div><label htmlFor="blackboard-editor">Markdown 编辑区 <span>{text.length} / {BLACKBOARD_LIMIT}</span></label>
          <textarea id="blackboard-editor" value={text} maxLength={BLACKBOARD_LIMIT} disabled={busy} spellCheck={false}
            onChange={e => { remember({ text: e.target.value, baseVersion: draft?.baseVersion ?? board.version }); setNotice(''); setError(''); }}
            placeholder={'# 今天的题目\n\n请思考：\n- 你的解法是什么？\n- 为什么这样做？\n\n```python\nprint("Hello, class!")\n```'}/>
          <p className="board-hint">支持标题、加粗、列表、链接、图片、表格和代码块。草稿只保存在本浏览器，尚未向学生发布。</p>
        </div>
        <div className="board-preview"><h3>预览 <span>仅老师可见</span></h3>{text.trim() ? <MarkdownContent text={text}/> : <p className="board-empty">写点什么，这里会显示排版效果。</p>}</div>
      </div>
      {conflict && <p className="error" role="alert">黑板已在其他页面更新，当前草稿不会被覆盖。请先复制草稿，再载入已发布内容后编辑。</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="board-actions"><button className="primary" disabled={busy || !dirty || conflict} onClick={publish}><Send size={16}/>{busy ? '发布中…' : '发布给全班'}</button>
        <button className="secondary" disabled={busy || draft === null} onClick={() => { remember(null); setError(''); setNotice('已载入已发布内容。'); }}>载入已发布内容</button>
        <span role="status">{notice || (dirty ? '有未发布的修改' : '与已发布内容一致')}</span></div>
      <details className="board-published"><summary>查看学生当前看到的内容</summary>{board.markdown.trim() ? <MarkdownContent text={board.markdown}/> : <p className="board-empty">黑板还没有内容。</p>}</details>
    </> : board.markdown.trim() ? <MarkdownContent text={board.markdown}/> : <p className="board-empty">老师还没有写下内容，发布后会自动出现在这里。</p>}
  </section>;
}
