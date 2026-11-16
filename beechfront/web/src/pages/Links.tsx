import { RotateCw } from 'lucide-react';
import { useApi } from '../api';
import { AppIcon, Button, Card, Dot, Empty, ErrorNote, Loading } from '../ui';
import type { Container, LinkGroup, Meta } from '../types';

export function LinksPage({ meta }: { meta: Meta }) {
  const { data, error, loading, refresh } = useApi<LinkGroup[]>('/links', 60000);
  const containers = useApi<Container[]>(meta.integrations.unraid ? '/containers' : null);
  const apps = (containers.data || []).filter((c) => c.url);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Links</h1><p className="muted">Everything with a web page, in one place</p></div>
        <Button icon={<RotateCw size={16} />} title="Re-check" onClick={refresh} />
      </div>
      <ErrorNote error={error} what="links" />
      {loading && <Loading rows={4} />}
      {data?.map((g) => (
        <Card key={g.name} title={g.name}>
          <div className="link-grid">
            {g.items.map((l) => (
              <a key={l.url} className="link-card" href={l.url} target="_blank" rel="noreferrer">
                <AppIcon src={l.icon} name={l.name} size={36} />
                <span className="link-text"><strong>{l.name}</strong><small>{l.description || l.url.replace(/^https?:\/\//, '')}</small></span>
                {l.health && <span className="link-health" title={l.health.up ? `${l.health.ms} ms` : l.health.error || `HTTP ${l.health.status}`}>
                  <Dot tone={l.health.up ? 'ok' : 'bad'} />{l.health.up && <small>{l.health.ms} ms</small>}
                </span>}
              </a>
            ))}
          </div>
        </Card>
      ))}
      {data && data.length === 0 && !apps.length && <Card><Empty>No links yet – add some under <code>links:</code> in config.yaml.</Empty></Card>}
      {apps.length > 0 && (
        <Card title="Container apps">
          <div className="link-grid">
            {apps.map((c) => (
              <a key={c.id} className="link-card" href={c.url!} target="_blank" rel="noreferrer">
                <AppIcon src={c.icon} name={c.name} size={36} />
                <span className="link-text"><strong>{c.name}</strong><small>{c.url!.replace(/^https?:\/\//, '')}</small></span>
                <span className="link-health"><Dot tone={c.state === 'running' ? 'ok' : 'off'} /></span>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
