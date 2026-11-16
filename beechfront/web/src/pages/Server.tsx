import { ExternalLink, Play, Power, RotateCw, Square, Bell, Monitor, Zap } from 'lucide-react';
import { api, refresh, useApi } from '../api';
import { Bar, Button, Card, Dot, Empty, ErrorNote, Loading, confirm, useAction, type Tone } from '../ui';
import { kib, bytes, pct, since } from '../format';
import type { ArrayInfo, Disk, Meta, SystemInfo, Vm } from '../types';

const vmTone = (s: string): Tone => (s === 'running' ? 'ok' : s === 'paused' || s === 'pmsuspended' ? 'warn' : s === 'crashed' ? 'bad' : 'off');

export function ServerPage({ meta }: { meta: Meta }) {
  const sys = useApi<SystemInfo>('/unraid/system', 5000);
  const arr = useApi<ArrayInfo>('/unraid/array', 30000);
  const vms = useApi<Vm[]>('/unraid/vms', 5000);
  const notes = useApi<{ info: number; warning: number; alert: number; total: number }>('/unraid/notifications', 60000);
  const { busy, run } = useAction();

  async function vmAction(v: Vm, action: string, label: string, danger = false) {
    if (action !== 'start' && !(await confirm({
      title: `${label} ${v.name}?`,
      body: action === 'forceStop' ? 'This is like pulling the plug – unsaved state in the VM will be lost.' : v.name === meta.haVmName ? 'This console runs inside Home Assistant, so it will drop out until the VM is back.' : undefined,
      action: label, danger,
    }))) return;
    await run(`${v.id}:${action}`, () => api(`/unraid/vms/${encodeURIComponent(v.id)}/${action}`, { method: 'POST' }), `${v.name}: ${label.toLowerCase()} sent`);
    refresh('/unraid/vms');
  }

  const s = sys.data;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{s?.hostname || 'Server'}</h1><p className="muted">{s ? `Unraid ${s.version ?? ''} · up ${since(s.bootedAt)}` : 'Unraid'}</p></div>
        {meta.webUrls.unraid && <Button icon={<ExternalLink size={16} />} href={meta.webUrls.unraid}>Open Unraid</Button>}
      </div>

      <div className="grid-2">
        <Card title="System">
          <ErrorNote error={sys.error} what="system info" />
          {sys.loading && <Loading />}
          {s && (
            <div className="kv">
              {s.cpu && <div><span>Processor</span><strong>{s.cpu}</strong></div>}
              {s.cpuPercent !== null && <div className="with-bar"><span>CPU</span><Bar value={s.cpuPercent} /><strong>{s.cpuPercent}%</strong></div>}
              {s.memory && <div className="with-bar"><span>Memory</span><Bar value={s.memory.percent} /><strong>{bytes(s.memory.used, 1)} / {bytes(s.memory.total, 0)}</strong></div>}
              {notes.data && (
                <div><span>Notifications</span><strong className="state">
                  {notes.data.alert + notes.data.warning > 0 ? <><Dot tone={notes.data.alert ? 'bad' : 'warn'} />{notes.data.alert + notes.data.warning} need reading</> : <><Bell size={14} />{notes.data.total ? `${notes.data.total} unread` : 'None'}</>}
                </strong></div>
              )}
            </div>
          )}
        </Card>

        <Card title="Virtual machines" icon={<Monitor size={18} />} pad={false}>
          <ErrorNote error={vms.error} what="VMs" />
          {vms.loading && <div className="card-body"><Loading rows={2} /></div>}
          {vms.data && (vms.data.length === 0 ? <Empty>No VMs.</Empty> : (
            <ul className="rows">
              {vms.data.map((v) => (
                <li key={v.id} className="row">
                  <div className="row-main">
                    <div className="row-title"><strong>{v.name}</strong><span className="state"><Dot tone={vmTone(v.state)} />{v.state}</span></div>
                  </div>
                  <div className="row-actions">
                    {v.state === 'running' ? (
                      <>
                        <Button icon={<RotateCw size={16} />} title="Reboot" busy={busy === `${v.id}:reboot`} onClick={() => vmAction(v, 'reboot', 'Reboot')} />
                        <Button icon={<Square size={15} />} title="Shut down" busy={busy === `${v.id}:stop`} onClick={() => vmAction(v, 'stop', 'Shut down', true)} />
                        <Button icon={<Zap size={16} />} title="Force stop" busy={busy === `${v.id}:forceStop`} onClick={() => vmAction(v, 'forceStop', 'Force stop', true)} />
                      </>
                    ) : v.state === 'paused' ? (
                      <Button icon={<Play size={16} />} variant="primary" title="Resume" busy={busy === `${v.id}:resume`} onClick={() => vmAction(v, 'resume', 'Resume')} />
                    ) : (
                      <Button icon={<Power size={16} />} variant="primary" title="Start" busy={busy === `${v.id}:start`} onClick={() => vmAction(v, 'start', 'Start')} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </Card>
      </div>

      <Card title={<>Array{arr.data && <span className={`badge badge-${arr.data.state === 'STARTED' ? 'ok' : 'bad'}`}>{arr.data.state?.toLowerCase()}</span>}</>} pad={false}>
        <ErrorNote error={arr.error} what="the array" />
        {arr.loading && <div className="card-body"><Loading /></div>}
        {arr.data && (
          <>
            <div className="card-body capacity">
              <Bar value={pct(arr.data.capacity.used, arr.data.capacity.total)} />
              <p><strong>{kib(arr.data.capacity.used)}</strong> used of {kib(arr.data.capacity.total)} · <strong>{kib(arr.data.capacity.free)}</strong> free</p>
            </div>
            <div className="table-wrap">
              <table className="disks">
                <thead><tr><th>Disk</th><th>Size</th><th className="w-bar">Used</th><th>Temp</th><th>Errors</th><th>Status</th></tr></thead>
                <tbody>
                  {[...arr.data.parities, ...arr.data.disks, ...arr.data.caches].map((d) => <DiskRow key={d.name} d={d} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function DiskRow({ d }: { d: Disk }) {
  const used = pct(d.fsUsed, d.fsSize);
  const ok = /OK$/.test(d.status || '');
  return (
    <tr>
      <td><strong>{d.name}</strong></td>
      <td>{kib(d.size, 0)}</td>
      <td className="w-bar">{used !== null ? <div className="with-bar"><Bar value={used} /><span>{used}%</span></div> : <span className="muted">–</span>}</td>
      <td className={d.temp !== null && d.temp >= 50 ? 'text-bad' : ''}>{d.temp !== null ? `${d.temp} °C` : <span className="muted">spun down</span>}</td>
      <td className={d.errors ? 'text-warn' : 'muted'}>{d.errors}</td>
      <td><span className="state"><Dot tone={ok ? 'ok' : 'bad'} />{(d.status || '').replace(/^DISK_/, '').toLowerCase()}</span></td>
    </tr>
  );
}
