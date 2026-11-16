import { CheckCircle2, ChevronRight, Thermometer, Lightbulb, Download, Wifi, Server, Boxes, House, Network, Monitor } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../api';
import { navigate } from '../router';
import { AppIcon, Bar, Card, Dot, ErrorNote, Loading, type Tone } from '../ui';
import { bitrate, kib, pct, since } from '../format';
import type { Meta, Overview } from '../types';

const levelTone: Record<string, Tone> = { alert: 'bad', warning: 'warn', info: 'info' };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <p className="muted">
      {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </p>
  );
}

const isErr = (t: object): t is { error?: string; off?: boolean } => 'error' in t || 'off' in t;

export function OverviewPage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Overview>('/overview', 15000);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{greeting()}</h1><Clock /></div>
      </div>
      <ErrorNote error={error} what="the overview" />
      {loading && <Loading rows={4} />}
      {data && (
        <>
          {data.pinned.length > 0 && (
            <section>
              <h2 className="section-title">Quick launch</h2>
              <div className="launch-grid">
                {data.pinned.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="launch" title={l.name}>
                    <AppIcon src={l.icon} name={l.name} size={32} />
                    <span>{l.name}</span>
                    {(l.health || l.running !== undefined) && <Dot tone={(l.health ? l.health.up : l.running) ? 'ok' : 'bad'} />}
                  </a>
                ))}
              </div>
            </section>
          )}

          <div className="overview-grid">
          <Card title={data.attention.length ? `Needs attention · ${data.attention.length}` : 'Needs attention'} pad={false}>
            {data.attention.length === 0 ? (
              <div className="all-clear"><CheckCircle2 size={22} /> All clear – nothing needs you right now.</div>
            ) : (
              <ul className="attention">
                {data.attention.map((a, i) => (
                  <li key={i}>
                    <button onClick={() => a.page && navigate(a.page)} disabled={!a.page}>
                      <Dot tone={levelTone[a.level]} />
                      <span className="att-text"><strong>{a.title}</strong>{a.detail && <small>{a.detail}</small>}</span>
                      <span className="att-source">{a.source}</span>
                      {a.page && <ChevronRight size={16} className="muted" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="tiles">
            {meta.integrations.unraid && <ServerTile t={data.tiles.server} vms={data.tiles.vms} />}
            {meta.integrations.unraid && (
              <Tile title="Containers" icon={<Boxes size={18} />} page="containers" t={data.tiles.containers}>
                {(t) => (
                  <>
                    <div className="big">{t.running}<span>/{t.total} running</span></div>
                    <Bar value={pct(t.running, t.total)} tone={t.running === t.total ? 'ok' : 'warn'} />
                  </>
                )}
              </Tile>
            )}
            {meta.integrations.homeassistant && (
              <Tile title="Home" icon={<House size={18} />} page="home" t={data.tiles.home}>
                {(t) => (
                  <div className="tile-list">
                    {t.climate.map((c) => (
                      <div key={c.name}><Thermometer size={16} /><span>{c.name}</span><strong>{c.current}°C{c.target ? ` → ${c.target}°` : ''}</strong></div>
                    ))}
                    <div><Lightbulb size={16} /><span>Lights on</span><strong>{t.lightsOn} of {t.lights}</strong></div>
                    <div><Download size={16} /><span>Updates</span><strong>{t.updates || 'None'}</strong></div>
                  </div>
                )}
              </Tile>
            )}
            {meta.integrations.unifi && (
              <Tile title="Network" icon={<Network size={18} />} page="network" t={data.tiles.network}>
                {(t) => (
                  <div className="tile-list">
                    <div><Dot tone={t.devicesOnline === t.devices ? 'ok' : 'bad'} /><span>UniFi devices</span><strong>{t.devicesOnline}/{t.devices} online</strong></div>
                    <div><Wifi size={16} /><span>Clients</span><strong>{t.clients} ({t.wireless} Wi‑Fi)</strong></div>
                    {t.gateway && <div><Network size={16} /><span>WAN</span><strong>↓ {bitrate(t.gateway.rx)} · ↑ {bitrate(t.gateway.tx)}</strong></div>}
                  </div>
                )}
              </Tile>
            )}
          </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile<T extends object>({ title, icon, page, t, children }: {
  title: string; icon: ReactNode; page: 'containers' | 'home' | 'network' | 'server'; t: T | { error?: string; off?: boolean }; children: (t: T) => ReactNode;
}) {
  return (
    <button className="card tile" onClick={() => navigate(page)}>
      <header className="card-head"><h2>{icon}{title}</h2><ChevronRight size={16} className="muted" /></header>
      <div className="card-body">
        {isErr(t) ? <p className="muted">{t.off ? 'Not configured' : `Unavailable – ${t.error}`}</p> : children(t as T)}
      </div>
    </button>
  );
}

function ServerTile({ t, vms }: { t: Overview['tiles']['server']; vms: Overview['tiles']['vms'] }) {
  return (
    <Tile title={isErr(t) ? 'Server' : t.hostname || 'Server'} icon={<Server size={18} />} page="server" t={t}>
      {(s) => (
        <div className="tile-list">
          {s.cpuPercent !== null && <div className="with-bar"><span>CPU</span><Bar value={s.cpuPercent} /><strong>{s.cpuPercent}%</strong></div>}
          {s.memory && <div className="with-bar"><span>RAM</span><Bar value={s.memory.percent} /><strong>{s.memory.percent}%</strong></div>}
          {s.array && <div className="with-bar"><span>Array</span><Bar value={pct(s.array.used, s.array.total)} /><strong>{kib(s.array.free, 0)} free</strong></div>}
          {vms?.map((v) => <div key={v.id}><Monitor size={16} /><span>{v.name}</span><strong className="state"><Dot tone={v.state === 'running' ? 'ok' : 'off'} />{v.state}</strong></div>)}
          <div className="muted small">Up {since(s.bootedAt)}{s.version ? ` · Unraid ${s.version}` : ''}</div>
        </div>
      )}
    </Tile>
  );
}
