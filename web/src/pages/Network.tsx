import { useMemo, useState } from 'react';
import { ExternalLink, RotateCw, Wifi, Cable, ShieldCheck, Router, Radio, Network as NetIcon } from 'lucide-react';
import { api, refresh, useApi } from '../api';
import { Bar, Button, Card, Dot, Empty, ErrorNote, Loading, SearchInput, Segmented, confirm, useAction } from '../ui';
import { bitrate, duration, matches, since } from '../format';
import type { Meta, Unifi, UnifiDevice } from '../types';

const deviceIcon = (d: UnifiDevice) =>
  d.features.includes('gateway') ? <Router size={20} /> : d.features.includes('accessPoint') ? <Radio size={20} /> : <NetIcon size={20} />;

export function NetworkPage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Unifi>('/unifi', 15000);
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'WIRELESS' | 'WIRED' | 'guest'>('all');
  const { busy, run } = useAction();

  const gateway = data?.devices.find((d) => d.features.includes('gateway'));
  const clients = useMemo(() => (data?.clients || [])
    .filter((c) => (type === 'all' || (type === 'guest' ? c.guest : c.type === type)) && matches(q, c.name, c.ip, c.mac, c.uplink))
    .sort((a, b) => a.name.localeCompare(b.name)), [data, q, type]);

  async function restart(d: UnifiDevice) {
    if (!(await confirm({
      title: `Restart ${d.name}?`,
      body: d.features.includes('gateway') ? 'The whole house will lose internet (and probably this page) for a few minutes.' : 'Devices connected through it will drop off briefly.',
      action: 'Restart', danger: true,
    }))) return;
    await run(d.id, () => api(`/unifi/devices/${d.id}/restart`, { method: 'POST' }), `${d.name} is restarting`);
    refresh('/unifi');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Network</h1><p className="muted">UniFi{data?.version ? ` Network ${data.version}` : ''}</p></div>
        {meta.webUrls.unifi && <Button icon={<ExternalLink size={16} />} href={meta.webUrls.unifi}>Open UniFi</Button>}
      </div>
      <ErrorNote error={error} what="UniFi" />
      {loading && <Loading rows={5} />}
      {data && (
        <>
          {gateway && (
            <div className="stats">
              <div><span>Download</span><strong>{bitrate(gateway.rx)}</strong></div>
              <div><span>Upload</span><strong>{bitrate(gateway.tx)}</strong></div>
              <div><span>Clients</span><strong>{data.clients.length}</strong></div>
              <div><span>Gateway up</span><strong>{duration(gateway.uptime)}</strong></div>
            </div>
          )}
          <Card title="UniFi devices" pad={false}>
            <ul className="rows">
              {data.devices.map((d) => (
                <li key={d.id} className="row">
                  <span className="row-icon">{deviceIcon(d)}</span>
                  <div className="row-main">
                    <div className="row-title">
                      <strong>{d.name}</strong>
                      <span className="state"><Dot tone={d.state === 'ONLINE' ? 'ok' : d.state === 'OFFLINE' ? 'bad' : 'warn'} />{d.state.toLowerCase().replace(/_/g, ' ')}</span>
                      {d.firmwareUpdatable && <span className="badge badge-info">update</span>}
                    </div>
                    <div className="row-sub"><span>{d.model}</span><span>{d.ip}</span>{d.uptime !== null && <span>up {duration(d.uptime)}</span>}</div>
                  </div>
                  {d.cpu !== null && (
                    <div className="mini-meters">
                      <div className="with-bar"><span>CPU</span><Bar value={d.cpu} /></div>
                      <div className="with-bar"><span>Mem</span><Bar value={d.memory} /></div>
                    </div>
                  )}
                  <div className="row-actions">
                    <Button icon={<RotateCw size={16} />} title={`Restart ${d.name}`} busy={busy === d.id} disabled={d.state !== 'ONLINE'} onClick={() => restart(d)} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Find a client by name, IP or MAC" />
            <Segmented value={type} onChange={setType} options={[
              { value: 'all', label: 'All', count: data.clients.length },
              { value: 'WIRELESS', label: 'Wi‑Fi', count: data.clients.filter((c) => c.type === 'WIRELESS').length },
              { value: 'WIRED', label: 'Wired', count: data.clients.filter((c) => c.type === 'WIRED').length },
              { value: 'guest', label: 'Guests', count: data.clients.filter((c) => c.guest).length },
            ]} />
          </div>
          <Card pad={false}>
            {clients.length === 0 ? <Empty>No clients match.</Empty> : (
              <ul className="rows compact">
                {clients.map((c) => (
                  <li key={c.id} className="row">
                    <span className="row-icon">{c.type === 'WIRED' ? <Cable size={18} /> : c.guest ? <ShieldCheck size={18} /> : <Wifi size={18} />}</span>
                    <div className="row-main">
                      <div className="row-title"><strong>{c.name}</strong>{c.guest && <span className="badge">guest</span>}</div>
                      <div className="row-sub"><span className="mono">{c.ip || 'no IP'}</span>{c.uplink && <span>via {c.uplink}</span>}<span className="mono hide-sm">{c.mac}</span></div>
                    </div>
                    <span className="muted small">{since(c.connectedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
