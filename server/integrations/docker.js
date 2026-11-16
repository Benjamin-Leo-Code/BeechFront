import { Agent } from 'undici';
import { request } from '../http.js';

const ACTIONS = new Set(['start', 'stop', 'restart']);

/**
 * Resolve Unraid's WebUI template, e.g. "http://[IP]:[PORT:8080]/web".
 * [IP] becomes the container's own IP (custom br0/macvlan networks) or the host address;
 * [PORT:x] becomes the published host port for container port x when bridged.
 */
function resolveWebUi(template, c, hostAddress) {
  if (!template) return null;
  const nets = Object.values(c.NetworkSettings?.Networks || {});
  const mode = c.HostConfig?.NetworkMode || 'bridge';
  const ownIp = !['bridge', 'host'].includes(mode) ? nets.find((n) => n.IPAddress)?.IPAddress : null;
  const ip = ownIp || hostAddress;
  return template
    .replace(/\[IP\]/gi, ip)
    .replace(/\[PORT:(\d+)\]/gi, (_, port) => {
      if (ownIp || mode === 'host') return port;
      const mapped = (c.Ports || []).find((p) => String(p.PrivatePort) === port && p.PublicPort);
      return String(mapped?.PublicPort || port);
    });
}

function normalise(c, cfg) {
  const labels = c.Labels || {};
  const name = (c.Names?.[0] || c.Id).replace(/^\//, '');
  const seen = new Set();
  const ports = (c.Ports || [])
    .filter((p) => p.PublicPort)
    .filter((p) => { const k = `${p.PublicPort}/${p.Type}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((p) => ({ private: p.PrivatePort, public: p.PublicPort, type: p.Type }));
  return {
    id: c.Id,
    name,
    image: c.Image,
    state: c.State, // running | exited | paused | restarting | created | dead
    status: c.Status,
    created: c.Created * 1000,
    ports,
    network: c.HostConfig?.NetworkMode,
    icon: labels['net.unraid.docker.icon'] || null,
    url: cfg.urls[name] || resolveWebUi(labels['net.unraid.docker.webui'], c, cfg.hostAddress),
    favourite: cfg.favourites.includes(name),
    autoStart: null,
  };
}

/** Docker multiplexes stdout/stderr into 8-byte-header frames unless the container has a TTY. */
function demux(buf) {
  if (buf.length < 8 || ![0, 1, 2].includes(buf[0]) || buf[1] || buf[2] || buf[3]) return buf.toString('utf8');
  let out = '';
  for (let i = 0; i + 8 <= buf.length;) {
    const size = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  return out;
}

export function createDocker(cfg) {
  const dispatcher = new Agent({ connect: { socketPath: cfg.socket } });
  const base = 'http://docker';

  return {
    async list() {
      const raw = await request(`${base}/containers/json?all=true`, { dispatcher });
      return raw
        .map((c) => normalise(c, cfg))
        .filter((c) => !cfg.hide.includes(c.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async action(id, action) {
      if (!ACTIONS.has(action)) throw Object.assign(new Error(`Unknown action ${action}`), { statusCode: 400 });
      await request(`${base}/containers/${encodeURIComponent(id)}/${action}`, { method: 'POST', dispatcher, timeout: 60000 });
      return { ok: true };
    },
    async logs(id, tail = 200) {
      const n = Math.min(Math.max(Number(tail) || 200, 10), 2000);
      const buf = await request(`${base}/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${n}`, { dispatcher, raw: true });
      return { lines: demux(buf).split('\n').filter(Boolean) };
    },
  };
}
