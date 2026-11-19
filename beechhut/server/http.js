import { Agent, fetch } from 'undici';

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export class HttpError extends Error {
  constructor(message, status, data) { // status 0 = couldn't connect
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * JSON-first fetch wrapper with timeout. `insecure` allows self-signed certs
 * (UniFi gateways and Unraid ship with them).
 */
export async function request(url, { method = 'GET', headers = {}, body, timeout = 8000, insecure = false, dispatcher, raw = false } = {}) {
  const target = url.startsWith('http://docker/') ? 'the Docker socket' : new URL(url).host;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      dispatcher: dispatcher ?? (insecure ? insecureAgent : undefined),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new HttpError(`Timed out reaching ${target}`, 504);
    throw new HttpError(`Can't connect to ${target} (${err.cause?.code || err.cause?.message || err.message})`, 0);
  }
  if (raw) {
    if (!res.ok) throw new HttpError(`${target} returned HTTP ${res.status}`, res.status, await res.text());
    return Buffer.from(await res.arrayBuffer());
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'object' && data ? (data.message || data.error || '') : String(data || '').slice(0, 200);
    const hint = res.status === 401 || res.status === 403 ? ' – check the API key/token' : '';
    throw new HttpError(`${target} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}${hint}`, res.status, data);
  }
  return data;
}

/** Lightweight reachability probe used for link health checks. */
export async function probe(url, timeout = 4000) {
  const started = performance.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout), dispatcher: insecureAgent });
    res.body?.cancel().catch(() => {});
    return { up: res.status < 500, status: res.status, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { up: false, status: 0, ms: null, error: err.cause?.code || err.name };
  }
}

/** Small time-based cache so several open tabs don't hammer upstream APIs. */
export function cached(ttlMs, fn) {
  let value, expires = 0, inflight = null;
  const wrapped = async () => {
    if (Date.now() < expires) return value;
    if (inflight) return inflight;
    inflight = fn().then((v) => { value = v; expires = Date.now() + ttlMs; return v; }).finally(() => { inflight = null; });
    return inflight;
  };
  wrapped.invalidate = () => { expires = 0; };
  return wrapped;
}
