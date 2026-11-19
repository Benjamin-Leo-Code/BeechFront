import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Search, X, AlertTriangle } from 'lucide-react';

export type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'info';

export function Card({ title, icon, actions, children, className = '', pad = true }: {
  title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{icon}{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export const Dot = ({ tone, pulse }: { tone: Tone; pulse?: boolean }) => <span className={`dot dot-${tone} ${pulse ? 'pulse' : ''}`} aria-hidden />;

export const Badge = ({ tone = 'off', children }: { tone?: Tone; children: ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function Bar({ value, tone }: { value: number | null; tone?: Tone }) {
  const v = value ?? 0;
  const t = tone || (v >= 90 ? 'bad' : v >= 75 ? 'warn' : 'ok');
  return <div className="bar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}><span className={`bar-${t}`} style={{ width: `${Math.min(v, 100)}%` }} /></div>;
}

export function Button({ icon, children, onClick, variant = 'default', busy, title, href, disabled, small }: {
  icon?: ReactNode; children?: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost';
  busy?: boolean; title?: string; href?: string; disabled?: boolean; small?: boolean;
}) {
  const cls = `btn btn-${variant} ${children ? '' : 'btn-icon'} ${small ? 'btn-sm' : ''}`;
  const inner = <>{busy ? <Loader2 className="spin" size={16} /> : icon}{children && <span>{children}</span>}</>;
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer" title={title} aria-label={title}>{inner}</a>;
  return <button type="button" className={cls} onClick={onClick} disabled={busy || disabled} title={title} aria-label={title}>{inner}</button>;
}

export function Switch({ checked, onChange, busy, label }: { checked: boolean; onChange: () => void; busy?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''} ${busy ? 'busy' : ''}`} onClick={onChange} disabled={busy}>
      <span />
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Search size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
      {value && <button type="button" aria-label="Clear" onClick={() => onChange('')}><X size={14} /></button>}
    </label>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function ErrorNote({ error, what }: { error?: string; what?: string }) {
  if (!error) return null;
  return <div className="error-note"><AlertTriangle size={16} /><div><strong>{what ? `Couldn't load ${what}` : 'Something went wrong'}</strong><span>{error}</span></div></div>;
}

export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div className="skeleton">{Array.from({ length: rows }, (_, i) => <div key={i} />)}</div>
);

export function AppIcon({ src, name, size = 32 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    return <span className="app-icon letter" style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${hue} 30% 45%)` }}>{name.slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="app-icon" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}

export function Modal({ title, onClose, children, wide, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <header><h2>{title}</h2><div className="card-actions">{actions}<Button icon={<X size={18} />} variant="ghost" title="Close" onClick={onClose} /></div></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────
interface ToastMsg { id: number; text: string; tone: Tone }
const toastBus = new EventTarget();
let toastId = 0;
export function toast(text: string, tone: Tone = 'ok') {
  toastBus.dispatchEvent(new CustomEvent('toast', { detail: { id: ++toastId, text, tone } }));
}
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastMsg>).detail;
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'bad' ? 7000 : 3500);
    };
    toastBus.addEventListener('toast', on);
    return () => toastBus.removeEventListener('toast', on);
  }, []);
  return <div className="toaster" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}><Dot tone={t.tone} />{t.text}</div>)}</div>;
}

// ── Confirm dialog (promise-based) ──────────────────────────────────────────
interface ConfirmReq { title: string; body?: string; action: string; danger?: boolean; resolve: (ok: boolean) => void }
const confirmBus = new EventTarget();
export function confirm(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => confirmBus.dispatchEvent(new CustomEvent('confirm', { detail: { ...opts, resolve } })));
}
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<ConfirmReq>).detail);
    confirmBus.addEventListener('confirm', on);
    return () => confirmBus.removeEventListener('confirm', on);
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => { req.resolve(ok); setReq(null); };
  return (
    <Modal title={req.title} onClose={() => done(false)}>
      {req.body && <p className="muted">{req.body}</p>}
      <div className="modal-buttons">
        <Button variant="ghost" onClick={() => done(false)}>Cancel</Button>
        <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => done(true)}>{req.action}</Button>
      </div>
    </Modal>
  );
}

/** Run an async action with a busy flag; surfaces failures as toasts. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}
