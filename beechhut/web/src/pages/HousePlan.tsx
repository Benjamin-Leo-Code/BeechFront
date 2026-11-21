import { useEffect, useRef, useState } from 'react';
import { Upload, RotateCcw, Square, Maximize2, Minimize2, Pencil, Trash2, Box, Scissors } from 'lucide-react';
import { api, refresh, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Loading, Modal, Segmented, confirm, useAction } from '../ui';
import { bytes, isoDate } from '../format';
import { PlanViewer, type PlanSize, type ViewerControls } from './PlanViewer';
import type { Meta, Plan } from '../types';

const KEY = '/plans';
const LAST = 'beechhut.plan';
const remember = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } };
const recall = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

export default function HousePlanPage(_: { meta: Meta }) {
  const { data: plans, error, loading } = useApi<Plan[]>(KEY);
  const [currentId, setCurrentId] = useState<string | null>(recall());
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [size, setSize] = useState<PlanSize | null>(null);
  const [renaming, setRenaming] = useState<Plan | null>(null);
  const viewer = useRef<ViewerControls>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  const current = plans?.find((p) => p.id === currentId) || plans?.[0] || null;
  useEffect(() => { if (current) remember(current.id); }, [current?.id]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [expanded]);

  async function upload(file: File) {
    await run('upload', async () => {
      const qs = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') });
      const res = await fetch(`api/plans?${qs}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`);
      await refresh(KEY);
      setCurrentId(body.id);
    }, `${file.name} uploaded`);
  }

  async function remove(plan: Plan) {
    if (!(await confirm({ title: `Delete “${plan.name}”?`, body: 'The model file will be removed from BeechHut. This can’t be undone.', action: 'Delete', danger: true }))) return;
    await run('delete', () => api(`${KEY}/${plan.id}`, { method: 'DELETE' }), 'Plan deleted');
    setCurrentId(null);
    refresh(KEY);
  }

  const picker = (
    <input ref={fileInput} type="file" accept=".usdz,.glb,model/vnd.usdz+zip,model/gltf-binary" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
  );

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>House Plan</h1><p className="muted">3D scans of the house and garden</p></div>
        <Button icon={<Upload size={16} />} variant={plans?.length ? 'default' : 'primary'} busy={busy === 'upload'} onClick={() => fileInput.current?.click()}>Upload scan</Button>
        {picker}
      </div>
      <ErrorNote error={error} what="plans" />
      {loading && <Loading rows={3} />}

      {plans && plans.length === 0 && (
        <Card>
          <Empty>
            <Box size={36} strokeWidth={1.4} />
            <p><strong>No plans yet</strong></p>
            <p className="muted small">Scan a room with your iPhone’s LiDAR (e.g. Polycam, 3D Scanner App or Magicplan), export it as <code>.usdz</code> or <code>.glb</code>, then upload it here.</p>
            <Button variant="primary" icon={<Upload size={16} />} busy={busy === 'upload'} onClick={() => fileInput.current?.click()}>Upload scan</Button>
          </Empty>
        </Card>
      )}

      {current && (
        <>
          {plans!.length > 1 && (
            <div className="toolbar">
              <Segmented value={current.id} onChange={setCurrentId} options={plans!.map((p) => ({ value: p.id, label: p.name }))} />
            </div>
          )}
          <div className={`plan-stage ${expanded ? 'expanded' : ''}`}>
            <PlanViewer key={current.id} onReady={(s) => { setSize(s); viewer.current?.cutaway(cutaway); }} url={`api/plans/${current.id}/model?v=${current.updated}`} format={current.format} onSelect={setSelected} controlsRef={viewer} />
            <div className="plan-tools">
              <Button icon={<RotateCcw size={16} />} title="Reset view" onClick={() => viewer.current?.reset()} />
              <Button icon={<Square size={15} />} title="View from above" onClick={() => viewer.current?.top()} />
              <Button icon={<Scissors size={16} />} title={cutaway ? 'Show full-height walls' : 'Cut walls down to see inside'} variant={cutaway ? 'primary' : 'default'}
                onClick={() => { viewer.current?.cutaway(!cutaway); setCutaway(!cutaway); }} />
              <Button icon={expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />} title={expanded ? 'Exit full screen' : 'Full screen'} onClick={() => setExpanded((x) => !x)} />
            </div>
            {selected && <div className="plan-label">{selected}</div>}
            <div className="plan-hint">Drag to rotate · scroll or pinch to zoom · right-drag or two fingers to move · tap something to identify it</div>
          </div>
          <Card pad={false}>
            <div className="row">
              <div className="row-main">
                <div className="row-title"><strong>{current.name}</strong><span className="badge">{current.format.toUpperCase()}</span></div>
                <div className="row-sub">{size && <span>About {size.width.toFixed(1)} × {size.depth.toFixed(1)} m, {size.height.toFixed(1)} m high</span>}<span>{bytes(current.size)}</span><span>Uploaded {isoDate(current.created)}</span></div>
              </div>
              <div className="row-actions">
                <Button icon={<Pencil size={15} />} title="Rename" onClick={() => setRenaming(current)} />
                <Button icon={<Trash2 size={15} />} title="Delete" busy={busy === 'delete'} onClick={() => remove(current)} />
              </div>
            </div>
          </Card>
        </>
      )}
      {renaming && <Rename plan={renaming} onClose={() => setRenaming(null)} />}
    </div>
  );
}

function Rename({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [name, setName] = useState(plan.name);
  const { busy, run } = useAction();
  const save = async () => {
    if (await run('save', () => api(`${KEY}/${plan.id}`, { method: 'PATCH', body: { name } }))) { refresh(KEY); onClose(); }
  };
  return (
    <Modal title="Rename plan" onClose={onClose}>
      <input className="text-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="modal-buttons">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy === 'save'} disabled={!name.trim()} onClick={save}>Save</Button>
      </div>
    </Modal>
  );
}

