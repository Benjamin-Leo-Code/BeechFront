const KiB = 1024;

export function bytes(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || isNaN(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (Math.abs(n) >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}
/** Unraid reports sizes in KiB. */
export const kib = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '–' : bytes(n * KiB, d));

export function bitrate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '–';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let i = 0;
  while (bps >= 1000 && i < units.length - 1) { bps /= 1000; i++; }
  return `${bps.toFixed(bps < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '–';
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
export const since = (ms: number | null | undefined) => (ms ? duration((Date.now() - ms) / 1000) : '–');

const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
export function relative(time: string | number | null | undefined): string {
  if (!time) return '';
  const diff = (new Date(time).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return isoDate(time);
}

/** yyyy-mm-dd */
export const isoDate = (t: string | number | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isoDateTime = (t: string | number | Date) => {
  const d = new Date(t);
  return `${isoDate(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  part === null || part === undefined || !whole ? null : Math.round((part / whole) * 100);

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());

export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}
