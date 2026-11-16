import { useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, RotateCw, ShieldCheck, Minus, Plus, Play, Download, Lock, LockOpen, ArrowUp, ArrowDown } from 'lucide-react';
import { api, mutate, refresh, useApi } from '../api';
import { Button, Card, Dot, Empty, ErrorNote, Loading, SearchInput, Segmented, Switch, confirm, toast, useAction } from '../ui';
import { matches, relative, titleCase } from '../format';
import type { Entity, Meta } from '../types';

const KEY = '/ha/states';
type Tab = 'controls' | 'scenes' | 'automations' | 'updates' | 'sensors' | 'all';
const CONTROLS = ['light', 'switch', 'fan', 'cover', 'lock', 'climate', 'input_boolean', 'media_player', 'vacuum'];
const DOMAIN_LABELS: Record<string, string> = {
  light: 'Lights', switch: 'Switches', fan: 'Fans', cover: 'Doors & blinds', lock: 'Locks', climate: 'Heating & climate',
  input_boolean: 'Toggles', media_player: 'Media', scene: 'Scenes', script: 'Scripts', automation: 'Automations', update: 'Updates',
  sensor: 'Sensors', binary_sensor: 'Binary sensors', person: 'People', device_tracker: 'Device trackers', weather: 'Weather',
};
const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'automation']);
const tabOf = (e: Entity): Tab | null =>
  CONTROLS.includes(e.domain) ? 'controls'
    : ['scene', 'script'].includes(e.domain) ? 'scenes'
      : e.domain === 'automation' ? 'automations'
        : e.domain === 'update' ? 'updates'
          : ['sensor', 'binary_sensor', 'person', 'weather', 'sun', 'device_tracker'].includes(e.domain) ? 'sensors' : null;

export function HomePage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Entity[]>(KEY, 5000);
  const info = useApi<{ version: string; name: string }>('/ha/info');
  const [tab, setTab] = useState<Tab>('controls');
  const [q, setQ] = useState('');
  const { busy, run } = useAction();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length || 0 };
    for (const e of data || []) { const t = tabOf(e); if (t) c[t] = (c[t] || 0) + 1; }
    c.updates = data?.filter((e) => e.domain === 'update' && e.state === 'on').length || 0;
    return c;
  }, [data]);

  const list = useMemo(() => {
    const all = data || [];
    const filtered = q ? all.filter((e) => matches(q, e.name, e.id)) : all.filter((e) => tab === 'all' || tabOf(e) === tab);
    const sorted = filtered.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
    return tab === 'updates' && !q ? sorted.sort((a, b) => Number(b.state === 'on') - Number(a.state === 'on')) : sorted;
  }, [data, tab, q]);

  async function call(e: Entity, domain: string, service: string, extra: Record<string, unknown> = {}, optimistic?: string) {
    if (optimistic) mutate<Entity[]>(KEY, (xs) => xs.map((x) => (x.id === e.id ? { ...x, state: optimistic } : x)));
    await run(e.id, () => api('/ha/service', { body: { domain, service, data: { entity_id: e.id, ...extra } } }));
    setTimeout(() => refresh(KEY), 600);
  }

  async function restartHa() {
    if (!(await confirm({ title: 'Restart Home Assistant?', body: 'Automations and the HA app will be unavailable for a minute or two.', action: 'Restart', danger: true }))) return;
    await run('restart', () => api('/ha/service', { body: { domain: 'homeassistant', service: 'restart' } }), 'Home Assistant is restarting');
  }
  async function checkConfig() {
    await run('check', async () => {
      const r = await api<{ result: string; errors: string | null }>('/ha/check-config', { method: 'POST' });
      toast(r.result === 'valid' ? 'Configuration is valid' : `Config invalid: ${r.errors}`, r.result === 'valid' ? 'ok' : 'bad');
    });
  }

  const grouped = useMemo(() => {
    const g = new Map<string, Entity[]>();
    for (const e of list) g.set(e.domain, [...(g.get(e.domain) || []), e]);
    return [...g];
  }, [list]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{info.data?.name || 'Home'}</h1><p className="muted">Home Assistant {info.data?.version ?? ''}</p></div>
        <div className="head-actions">
          <Button icon={<ShieldCheck size={16} />} busy={busy === 'check'} onClick={checkConfig}>Check config</Button>
          <Button icon={<RotateCw size={16} />} busy={busy === 'restart'} onClick={restartHa}>Restart</Button>
          {meta.webUrls.homeassistant && <Button icon={<ExternalLink size={16} />} href={meta.webUrls.homeassistant} title="Open Home Assistant" />}
        </div>
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search all entities" />
        {!q && <Segmented value={tab} onChange={setTab} options={[
          { value: 'controls', label: 'Controls' }, { value: 'scenes', label: 'Scenes' }, { value: 'automations', label: 'Automations' },
          { value: 'updates', label: 'Updates', count: counts.updates || undefined }, { value: 'sensors', label: 'Sensors' }, { value: 'all', label: 'All' },
        ]} />}
      </div>
      <ErrorNote error={error} what="Home Assistant" />
      {loading && <Loading rows={6} />}
      {data && list.length === 0 && <Card><Empty>Nothing here.</Empty></Card>}
      <div className="masonry">
        {grouped.map(([domain, items]) => (
          <Card key={domain} title={DOMAIN_LABELS[domain] || titleCase(domain)} pad={false}>
            <ul className="rows">
              {items.map((e) => <EntityRow key={e.id} e={e} busy={busy === e.id} call={call} />)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EntityRow({ e, busy, call }: { e: Entity; busy: boolean; call: (e: Entity, d: string, s: string, x?: Record<string, unknown>, o?: string) => void }) {
  const unavailable = e.state === 'unavailable' || e.state === 'unknown';
  let control: ReactNode = null;
  let detail: ReactNode = relative(e.changed);
  let value: ReactNode = null;

  if (TOGGLEABLE.has(e.domain)) {
    const on = e.state === 'on';
    control = <Switch label={e.name} checked={on} busy={busy || unavailable} onChange={() => call(e, e.domain === 'automation' ? 'automation' : 'homeassistant', on ? 'turn_off' : 'turn_on', {}, on ? 'off' : 'on')} />;
    if (e.domain === 'light' && on && e.attrs.brightness) detail = `${Math.round((e.attrs.brightness / 255) * 100)}% · ${detail}`;
    if (e.domain === 'automation') control = <><Button small icon={<Play size={14} />} title="Run now" onClick={() => call(e, 'automation', 'trigger')} />{control}</>;
  } else if (e.domain === 'scene' || e.domain === 'script') {
    control = <Button small icon={<Play size={14} />} busy={busy} onClick={() => call(e, e.domain, 'turn_on')}>{e.domain === 'scene' ? 'Activate' : 'Run'}</Button>;
    detail = e.domain === 'script' && e.state === 'on' ? 'Running' : '';
  } else if (e.domain === 'update') {
    detail = `${e.attrs.installed_version ?? '?'}${e.state === 'on' ? ` → ${e.attrs.latest_version}` : ' · up to date'}`;
    if (e.state === 'on') control = <Button small icon={<Download size={14} />} busy={busy || e.attrs.in_progress} onClick={async () => {
      if (await confirm({ title: `Install ${e.attrs.title || e.name}?`, body: `${e.attrs.installed_version} → ${e.attrs.latest_version}`, action: 'Install' })) call(e, 'update', 'install');
    }}>Install</Button>;
  } else if (e.domain === 'lock') {
    const locked = e.state === 'locked';
    value = <span className="state"><Dot tone={locked ? 'ok' : 'warn'} />{e.state}</span>;
    control = <Button small icon={locked ? <LockOpen size={14} /> : <Lock size={14} />} busy={busy} onClick={async () => {
      if (locked && !(await confirm({ title: `Unlock ${e.name}?`, action: 'Unlock', danger: true }))) return;
      call(e, 'lock', locked ? 'unlock' : 'lock');
    }}>{locked ? 'Unlock' : 'Lock'}</Button>;
  } else if (e.domain === 'cover') {
    value = <span className="state">{e.state}{e.attrs.current_position !== undefined ? ` · ${e.attrs.current_position}%` : ''}</span>;
    control = <>
      <Button small icon={<ArrowUp size={14} />} title="Open" busy={busy} onClick={async () => {
        if (e.deviceClass === 'garage' && !(await confirm({ title: `Open ${e.name}?`, action: 'Open' }))) return;
        call(e, 'cover', 'open_cover');
      }} />
      <Button small icon={<ArrowDown size={14} />} title="Close" busy={busy} onClick={() => call(e, 'cover', 'close_cover')} />
    </>;
  } else if (e.domain === 'climate') {
    const target = e.attrs.temperature as number | undefined;
    detail = `${e.attrs.hvac_action ? titleCase(e.attrs.hvac_action) : titleCase(e.state)}${e.attrs.current_temperature !== undefined ? ` · now ${e.attrs.current_temperature}°C` : ''}`;
    if (typeof target === 'number') control = (
      <div className="stepper">
        <Button small icon={<Minus size={14} />} title="Lower" busy={busy} onClick={() => call(e, 'climate', 'set_temperature', { temperature: target - 0.5 })} />
        <strong>{target}°</strong>
        <Button small icon={<Plus size={14} />} title="Raise" busy={busy} onClick={() => call(e, 'climate', 'set_temperature', { temperature: target + 0.5 })} />
      </div>
    );
  } else {
    const num = Number(e.state);
    const shown = !isNaN(num) && e.state !== '' ? `${Number.isInteger(num) ? num : num.toFixed(1)}${e.unit ? ` ${e.unit}` : ''}` : e.state;
    const battLow = e.deviceClass === 'battery' && num <= 20;
    value = <span className={`state ${battLow ? 'text-bad' : ''}`}>{e.domain === 'binary_sensor' ? binaryLabel(e) : shown}</span>;
  }

  return (
    <li className={`row ${unavailable ? 'dim' : ''}`}>
      <div className="row-main">
        <div className="row-title"><strong>{e.name}</strong>{unavailable && <span className="badge badge-warn">{e.state}</span>}</div>
        <div className="row-sub"><span>{detail}</span></div>
      </div>
      {value}
      {control && <div className="row-actions">{control}</div>}
    </li>
  );
}

function binaryLabel(e: Entity) {
  const on = e.state === 'on';
  const map: Record<string, [string, string]> = {
    door: ['Open', 'Closed'], window: ['Open', 'Closed'], motion: ['Motion', 'Clear'], occupancy: ['Occupied', 'Clear'],
    running: ['Running', 'Not running'], moisture: ['Wet', 'Dry'], smoke: ['Smoke!', 'Clear'], connectivity: ['Connected', 'Disconnected'],
  };
  const [a, b] = map[e.deviceClass || ''] || ['On', 'Off'];
  return on ? a : b;
}
