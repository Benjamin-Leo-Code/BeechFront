import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface ViewerControls {
  reset(): void;
  top(): void;
  cutaway(on: boolean): void;
}

/** Height (m above the floor) the walls are cut at in cutaway view. */
const CUT_HEIGHT = 1.1;

export interface PlanSize { width: number; depth: number; height: number }

/**
 * Scanning apps don't always label their units correctly (one tested export
 * stores millimetres scaled by 1/10,000 but claims to be in metres), so pick
 * the power of ten that makes the plan a plausible size for a house or
 * garden: at least 1.5 m across, at most 1 km.
 */
function plausibleScale(size: THREE.Vector3): number {
  const largest = Math.max(size.x, size.y, size.z);
  if (!(largest > 0)) return 1;
  let scale = 1;
  while (largest * scale < 1.5) scale *= 10;
  while (largest * scale > 1000) scale /= 10;
  return scale;
}

/** Friendly names for what RoomPlan-style scans call things. */
const KINDS: [RegExp, string][] = [
  [/door/i, 'Door'], [/window/i, 'Window'], [/opening/i, 'Opening'], [/innerside|wall/i, 'Wall'], [/floor/i, 'Floor'],
  [/sofa/i, 'Sofa'], [/table/i, 'Table'], [/chair/i, 'Chair'], [/bed/i, 'Bed'], [/storage/i, 'Storage'],
  [/television|tv/i, 'Television'], [/fireplace/i, 'Fireplace'], [/stairs/i, 'Stairs'], [/refrigerator|fridge/i, 'Fridge'],
  [/oven|stove/i, 'Cooker'], [/sink/i, 'Sink'], [/toilet/i, 'Toilet'], [/bath/i, 'Bath'], [/washer|dryer/i, 'Washing machine'],
  [/dishwasher/i, 'Dishwasher'], [/appliance/i, 'Appliance'], [/furniture/i, 'Furniture'],
];
function kindOf(obj: THREE.Object3D): string {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    for (const [re, label] of KINDS) if (re.test(o.name)) return label;
  }
  return 'Object';
}

async function loadModel(url: string, format: string): Promise<{ model: THREE.Object3D; textures: Promise<void> }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the model (HTTP ${res.status})`);
  const buffer = await res.arrayBuffer();
  if (format === 'glb') {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    return { model: gltf.scene, textures: Promise.resolve() };
  }
  let done!: () => void;
  const textures = new Promise<void>((r) => (done = r));
  const model = new USDLoader().parse(buffer, '', () => done(), () => done());
  return { model, textures };
}

export function PlanViewer({ url, format, onSelect, onReady, controlsRef }: {
  url: string; format: string; onSelect: (label: string | null) => void; onReady?: (size: PlanSize) => void; controlsRef: Ref<ViewerControls>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<ViewerControls>({ reset() {}, top() {}, cutaway() {} });
  const [status, setStatus] = useState<'loading' | 'ready' | string>('loading');
  useImperativeHandle(controlsRef, () => ({ reset: () => api.current.reset(), top: () => api.current.top(), cutaway: (on) => api.current.cutaway(on) }), []);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    setStatus('loading');
    onSelect(null);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Soft sky light plus a key and fill light, so walls and furniture get some shape.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7a6c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 10, 7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-6, 4, -5);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // don't go under the floor
    controls.screenSpacePanning = true;

    let model: THREE.Object3D | null = null;
    let dirty = true;
    let userMoved = false;
    const invalidate = () => { dirty = true; };
    controls.addEventListener('change', invalidate);
    controls.addEventListener('start', () => { userMoved = true; });
    renderer.setAnimationLoop(() => {
      const moved = controls.update();
      if (moved || dirty) { renderer.render(scene, camera); dirty = false; }
    });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!userMoved && model) frame('reset'); // keep it nicely framed until the user takes over
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Framing: fit the model's bounding sphere to whichever of the
    // vertical/horizontal field of view is tighter (phones are tall and narrow).
    let radius = 5;
    let centreY = 1;
    const fitDistance = () => {
      const v = THREE.MathUtils.degToRad(camera.fov);
      const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
      return (radius / Math.sin(Math.min(v, h) / 2)) * 0.95;
    };
    const frame = (view: 'reset' | 'top') => {
      const target = new THREE.Vector3(0, view === 'top' ? 0 : centreY * 0.35, 0);
      // reset: looking down at ~50° from a front corner; top: straight down.
      const dir = new THREE.Vector3().setFromSphericalCoords(1, view === 'top' ? 0.0001 : THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(30));
      camera.position.copy(target).addScaledVector(dir, fitDistance());
      controls.target.copy(target);
      controls.update();
      invalidate();
    };
    // Cutaway: clip everything above waist height so you can see into the rooms.
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_HEIGHT);
    api.current = {
      reset: () => { userMoved = false; frame('reset'); },
      top: () => { userMoved = true; frame('top'); },
      cutaway: (on) => { renderer.clippingPlanes = on ? [cutPlane] : []; invalidate(); },
    };

    // Tap (not drag) to identify things.
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    let selected: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] } | null = null;
    const clearSelection = () => {
      if (selected) { selected.mesh.material = selected.material; selected = null; invalidate(); }
    };
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!downAt || !model || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(model, true).find((h) => (h.object as THREE.Mesh).isMesh);
      clearSelection();
      if (!hit) return onSelect(null);
      const mesh = hit.object as THREE.Mesh;
      selected = { mesh, material: mesh.material };
      mesh.material = new THREE.MeshStandardMaterial({ color: 0x9cc98e, emissive: 0x2f5d3a, emissiveIntensity: 0.2, side: THREE.DoubleSide });
      invalidate();
      onSelect(kindOf(mesh));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    loadModel(url, format)
      .then(({ model: m, textures }) => {
        if (disposed) return;
        model = m;
        // Work in real metres, then sit the model on the floor, centred on the origin.
        m.scale.multiplyScalar(plausibleScale(new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())));
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        m.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
        scene.add(m);
        radius = Math.max(size.length() / 2, 0.5);
        centreY = size.y;
        // A 50 cm grid for a sense of scale.
        const extent = Math.ceil(Math.max(size.x, size.z) + 2);
        const grid = new THREE.GridHelper(extent, extent * 2, 0x8a8f86, 0x8a8f86);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.25;
        grid.position.y = -0.002;
        scene.add(grid);
        frame('reset');
        resize();
        setStatus('ready');
        onReady?.({ width: size.x, depth: size.z, height: size.y });
        textures.then(invalidate);
      })
      .catch((err: Error) => !disposed && setStatus(err.message || 'Couldn’t open this model'));

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        for (const mat of ([] as THREE.Material[]).concat(mesh.material)) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, format]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="plan-canvas" ref={host}>
      {status === 'loading' && <div className="plan-overlay">Loading model…</div>}
      {status !== 'loading' && status !== 'ready' && <div className="plan-overlay error">{status}</div>}
    </div>
  );
}
