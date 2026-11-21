import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Square, Maximize2, Minimize2, Scissors, Box } from 'lucide-react';
import { useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Loading } from '../ui';
import { PlanViewer, type ViewerControls } from './PlanViewer';
import type { HousePlan, Meta } from '../types';

/** The whole house in 3D – assembled from the plan kept in GitHub. */
export default function HousePlanPage(_: { meta: Meta }) {
  const { data, error, loading } = useApi<HousePlan>('/house-plan', 120000);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const viewer = useRef<ViewerControls>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [expanded]);

  // Only rebuild the 3D scene when the plan itself changes, not on every poll.
  const parts = data?.configured ? data.parts : null;
  const partsKey = JSON.stringify(parts);
  const stableParts = useMemo(() => parts, [partsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page plan-page">
      <div className="page-head"><div><h1>House Plan</h1></div></div>
      {error && !data && <ErrorNote error={error} what="the house plan" />}
      {loading && <Loading rows={3} />}

      {data && !data.configured && (
        <Card>
          <Empty>
            <Box size={36} strokeWidth={1.4} />
            <p><strong>No house plan set up yet</strong></p>
            <p className="muted small">Set the house plan repository and a GitHub token on the add-on’s Configuration tab.</p>
          </Empty>
        </Card>
      )}

      {stableParts && (
        <div className={`plan-stage ${expanded ? 'expanded' : ''}`}>
          {stableParts.length === 0
            ? <div className="plan-overlay">The plan doesn’t have any parts yet.</div>
            : <PlanViewer parts={stableParts} onSelect={setSelected} onReady={() => viewer.current?.cutaway(cutaway)} controlsRef={viewer} />}
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
