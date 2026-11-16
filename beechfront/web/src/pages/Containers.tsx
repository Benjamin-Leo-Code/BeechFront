import { useMemo, useState } from 'react';
import { ExternalLink, Play, RotateCw, Square, Star, MoreHorizontal } from 'lucide-react';
import { api, mutate, refresh, useApi } from '../api';
import { AppIcon, Button, Card, Dot, Empty, ErrorNote, Loading, Modal, SearchInput, Segmented, confirm, useAction, type Tone } from '../ui';
import { matches } from '../format';
import type { Container, Meta } from '../types';

const KEY = '/containers';
const tone = (s: string): Tone => (s === 'running' ? 'ok' : s === 'paused' || s === 'restarting' ? 'warn' : s === 'dead' ? 'bad' : 'off');
const label = (s: string) => (s === 'exited' ? 'stopped' : s);

export function ContainersPage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Container[]>(KEY, 5000);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [sheet, setSheet] = useState<Container | null>(null);
  const { busy, run } = useAction();

  const list = useMemo(() => (data || []).filter((c) =>
    (filter === 'all' || (filter === 'running' ? c.state === 'running' : c.state !== 'running')) && matches(q, c.name, c.image)), [data, q, filter]);
  const running = data?.filter((c) => c.state === 'running').length ?? 0;

  async function act(c: Container, action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && !(await confirm({
      title: `${action === 'stop' ? 'Stop' : 'Restart'} ${c.name}?`,
      action: action === 'stop' ? 'Stop' : 'Restart', danger: action === 'stop',
    }))) return;
    const ok = await run(`${c.id}:${action}`, () => api(`${KEY}/${encodeURIComponent(c.id)}/${action}`, { method: 'POST' }), `${c.name} ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`);
    if (ok) mutate<Container[]>(KEY, (cs) => cs.map((x) => (x.id === c.id ? { ...x, state: action === 'stop' ? 'exited' : 'running' } : x)));
    refresh(KEY);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Containers</h1><p className="muted">{data ? `${running} of ${data.length} running` : 'Docker on Unraid'}</p></div>
        {meta.webUrls.unraid && <Button icon={<ExternalLink size={16} />} href={`${meta.webUrls.unraid}/Docker`}>Unraid Docker</Button>}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Filter containers" />
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: data?.length }, { value: 'running', label: 'Running', count: running },
          { value: 'stopped', label: 'Stopped', count: data ? data.length - running : undefined },
        ]} />
      </div>
      <ErrorNote error={error} what="containers" />
      {loading && <Loading rows={6} />}
      {data && (
        <Card pad={false}>
          {list.length === 0 ? <Empty>No containers match.</Empty> : (
            <ul className="rows">
              {list.map((c) => (
                <li key={c.id} className="row">
                  <AppIcon src={c.icon} name={c.name} size={36} />
                  <div className="row-main">
                    <div className="row-title">
                      <strong>{c.name}</strong>
                      {c.favourite && <Star size={13} className="fav" />}
                      <span className="state"><Dot tone={tone(c.state)} />{label(c.state)}</span>
                      {c.state !== 'running' && c.autoStart && <span className="badge badge-warn">autostart</span>}
                    </div>
                    <div className="row-sub">
                      <span title={c.image} className="hide-sm">{c.image.replace(/^(ghcr\.io|lscr\.io|docker\.io)\//, '')}</span>
                      <span>{c.status}</span>
                      {c.ports.length > 0 && <span className="hide-sm">{c.ports.map((p) => p.public).join(', ')}</span>}
                    </div>
                  </div>
                  <div className="row-actions show-sm">
                    {c.state === 'running'
                      ? c.url && <Button icon={<ExternalLink size={16} />} title={`Open ${c.name}`} href={c.url} />
                      : <Button icon={<Play size={16} />} title="Start" variant="primary" busy={busy === `${c.id}:start`} onClick={() => act(c, 'start')} />}
                    <Button icon={<MoreHorizontal size={18} />} title="More" onClick={() => setSheet(c)} />
                  </div>
                  <div className="row-actions hide-sm">
                    {c.url && <Button icon={<ExternalLink size={16} />} title={`Open ${c.name}`} href={c.url} disabled={c.state !== 'running'} />}
                    {c.state === 'running' ? (
                      <>
                        <Button icon={<RotateCw size={16} />} title="Restart" busy={busy === `${c.id}:restart`} onClick={() => act(c, 'restart')} />
                        <Button icon={<Square size={15} />} title="Stop" busy={busy === `${c.id}:stop`} onClick={() => act(c, 'stop')} />
                      </>
                    ) : (
                      <Button icon={<Play size={16} />} title="Start" variant="primary" busy={busy === `${c.id}:start`} onClick={() => act(c, 'start')} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {sheet && (
        <Modal title={sheet.name} onClose={() => setSheet(null)}>
          <div className="sheet-actions">
            {sheet.url && sheet.state === 'running' && <Button icon={<ExternalLink size={18} />} href={sheet.url}>Open web UI</Button>}
            {sheet.state === 'running' ? (
              <>
                <Button icon={<RotateCw size={18} />} onClick={() => { setSheet(null); act(sheet, 'restart'); }}>Restart</Button>
                <Button icon={<Square size={16} />} onClick={() => { setSheet(null); act(sheet, 'stop'); }}>Stop</Button>
              </>
            ) : <Button icon={<Play size={18} />} variant="primary" onClick={() => { setSheet(null); act(sheet, 'start'); }}>Start</Button>}
          </div>
          <p className="muted small">{sheet.image} · {sheet.status}{sheet.ports.length ? ` · ports ${sheet.ports.map((p) => p.public).join(', ')}` : ''}</p>
        </Modal>
      )}
    </div>
  );
}
