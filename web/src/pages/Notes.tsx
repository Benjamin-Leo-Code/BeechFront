import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pin, PinOff, Trash2, ChevronLeft } from 'lucide-react';
import { api, refresh, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Loading, SearchInput, confirm, toast } from '../ui';
import { isoDateTime, matches, relative } from '../format';
import type { Note } from '../types';

const KEY = '/notes';

export function NotesPage() {
  const { data, error, loading } = useApi<Note[]>(KEY);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => (data || []).filter((n) => matches(q, n.title, n.body)), [data, q]);
  const current = data?.find((n) => n.id === openId) || null;

  async function create() {
    const n = await api<Note>(KEY, { body: { title: 'Untitled', body: '' } });
    await refresh(KEY);
    setOpenId(n.id);
  }

  return (
    <div className={`page notes-page ${current ? 'has-open' : ''}`}>
      <div className="page-head">
        <div><h1>Notes</h1><p className="muted">House info, codes hints, service dates, to‑dos</p></div>
        <Button icon={<Plus size={16} />} variant="primary" onClick={create}>New note</Button>
      </div>
      <ErrorNote error={error} what="notes" />
      {loading && <Loading />}
      {data && (
        <div className="notes-layout">
          <div className="notes-list">
            <SearchInput value={q} onChange={setQ} placeholder="Search notes" />
            <Card pad={false}>
              {list.length === 0 ? <Empty>{data.length ? 'No matches.' : 'No notes yet.'}</Empty> : (
                <ul className="rows">
                  {list.map((n) => (
                    <li key={n.id} className={`row clickable ${n.id === openId ? 'selected' : ''}`} onClick={() => setOpenId(n.id)}>
                      <div className="row-main">
                        <div className="row-title"><strong>{n.title || 'Untitled'}</strong>{n.pinned && <Pin size={12} className="muted" />}</div>
                        <div className="row-sub"><span>{relative(n.updated)}</span><span className="clip">{n.body.split('\n')[0]}</span></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          {current ? <Editor key={current.id} note={current} onClose={() => setOpenId(null)} /> : <div className="notes-placeholder hide-sm"><Empty>Pick a note or start a new one.</Empty></div>}
        </div>
      )}
    </div>
  );
}

function Editor({ note, onClose }: { note: Note; onClose: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ title, body });
  latest.current = { title, body };

  const save = async (extra: Partial<Note> = {}) => {
    clearTimeout(timer.current);
    try {
      await api(KEY, { body: { ...note, ...latest.current, ...extra } });
      setSaved(true);
      refresh(KEY);
    } catch (e) { toast((e as Error).message, 'bad'); }
  };

  useEffect(() => {
    if (title === note.title && body === note.body) return;
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  }, [title, body]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  async function remove() {
    if (!(await confirm({ title: `Delete “${note.title || 'Untitled'}”?`, action: 'Delete', danger: true }))) return;
    await api(`${KEY}/${note.id}`, { method: 'DELETE' });
    onClose();
    refresh(KEY);
  }

  return (
    <Card className="editor" title={
      <><span className="show-sm"><Button small variant="ghost" icon={<ChevronLeft size={18} />} title="Back" onClick={async () => { if (!saved) await save(); onClose(); }} /></span>
        <span className="muted small">{saved ? `Saved · ${isoDateTime(note.updated)}` : 'Saving…'}</span></>
    } actions={<>
      <Button small icon={note.pinned ? <PinOff size={15} /> : <Pin size={15} />} title={note.pinned ? 'Unpin' : 'Pin'} onClick={() => save({ pinned: !note.pinned })} />
      <Button small icon={<Trash2 size={15} />} title="Delete" onClick={remove} />
    </>}>
      <input className="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" onBlur={() => !saved && save()} />
      <textarea className="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write something…" onBlur={() => !saved && save()} />
    </Card>
  );
}
