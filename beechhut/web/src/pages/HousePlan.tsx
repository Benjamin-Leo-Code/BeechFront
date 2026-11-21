import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Square, Maximize2, Minimize2, Scissors, Box } from 'lucide-react';
import { Button, Card, Empty, ErrorNote, Loading } from '../ui';
import { PlanViewer, type ViewerControls } from './PlanViewer';
import type { HousePlan, Meta, PlanPart } from '../types';

const FORMATS = ['usdz', 'glb'] as const;
const CHECK_EVERY = 2 * 60_000;

/** Read plan.json from the house plan folder; file paths in it are relative to that folder. */
async function fetchPlan(base: string): Promise<{ plan: HousePlan; text: string }> {
  const url = new URL('plan.json', new URL(base, location.href));
  const res = await fetch(url, { cache: 'no-cache' }).catch(() => { throw new Error(`Couldn’t reach ${url.pathname}`); });
  if (res.status === 404) throw new Error(`There’s no plan.json at ${url.pathname} – check the House plan address setting`);
  if (!res.ok) throw new Error(`Couldn’t load ${url.pathname} (HTTP ${res.status})`);
  const text = await res.text();
  let raw: { name?: unknown; parts?: unknown };
  try { raw = JSON.parse(text); } catch { throw new Error('plan.json isn’t valid JSON'); }
  if (!Array.isArray(raw.parts)) throw new Error('plan.json needs a "parts" list');
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const parts = raw.parts.map((p: Record<string, any>, i): PlanPart => {
    const format = String(p.file || '').split('.').pop()?.toLowerCase() as PlanPart['format'];
    if (!FORMATS.includes(format)) throw new Error(`Part ${i + 1} in plan.json must point at a .usdz or .glb file`);
    const pos = Array.isArray(p.position) ? p.position : [];
    return {
      id: String(p.id || p.file),
      name: String(p.name || p.id || p.file),
      level: p.level ? String(p.level) : null,
      format,
      url: new URL(String(p.file), url).href,
      position: [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)],
      rotation: num(p.rotation, 0),
      unitScale: num(p.unitScale, 0) > 0 ? p.unitScale : null,
    };
  });
  return { plan: { name: typeof raw.name === 'string' ? raw.name : 'House plan', parts }, text };
}

/** The whole house in 3D, loaded straight from the house plan folder. */
export default function HousePlanPage({ meta }: { meta: Meta }) {
  const base = meta.housePlanUrl;
  const [plan, setPlan] = useState<HousePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const viewer = useRef<ViewerControls>(null);

  // Load the plan, then look for changes every couple of minutes while the page is open.
  useEffect(() => {
    if (!base) return;
    let last = '';
    let stop = false;
    const load = () => fetchPlan(base)
      .then(({ plan: p, text }) => { if (!stop && text !== last) { last = text; setPlan(p); } if (!stop) setError(null); })
      .catch((e: Error) => !stop && setError(e.message));
    load();
    const t = setInterval(() => !document.hidden && load(), CHECK_EVERY);
    return () => { stop = true; clearInterval(t); };
  }, [base]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div className="page plan-page">
      <div className="page-head"><div><h1>House Plan</h1></div></div>

      {!base && (
        <Card>
          <Empty>
            <Box size={36} strokeWidth={1.4} />
            <p><strong>No house plan set up yet</strong></p>
            <p className="muted small">Set <strong>House plan address</strong> on the add-on’s Configuration tab to the folder holding <code>plan.json</code>.</p>
          </Empty>
        </Card>
      )}
      {base && error && !plan && <ErrorNote error={error} what="the house plan" />}
      {base && !plan && !error && <Loading rows={3} />}

      {plan && (
        <div className={`plan-stage ${expanded ? 'expanded' : ''}`}>
          {plan.parts.length === 0
            ? <div className="plan-overlay">The plan doesn’t have any parts yet.</div>
            : <PlanViewer parts={plan.parts} onSelect={setSelected} onReady={() => viewer.current?.cutaway(cutaway)} controlsRef={viewer} />}
          <div className="plan-tools">
            <Button icon={<RotateCcw size={16} />} title="Reset view" onClick={() => viewer.current?.reset()} />
            <Button icon={<Square size={15} />} title="View from above" onClick={() => viewer.current?.top()} />
            <Button icon={<Scissors size={16} />} title={cutaway ? 'Show full-height walls' : 'Cut walls down to see inside'} variant={cutaway ? 'primary' : 'default'}
              onClick={() => { viewer.current?.cutaway(!cutaway); setCutaway(!cutaway); }} />
            <Button icon={expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />} title={expanded ? 'Exit full screen' : 'Full screen'} onClick={() => setExpanded((x) => !x)} />
          </div>
          {selected && <div className="plan-label">{selected}</div>}
          {error && <div className="plan-warning" title={error}>Couldn’t check for plan updates</div>}
          <div className="plan-hint">Drag to rotate · scroll or pinch to zoom · right-drag or two fingers to move · tap something to identify it</div>
        </div>
      )}
    </div>
  );
}
