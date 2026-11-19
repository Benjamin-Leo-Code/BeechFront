import { request } from '../http.js';

const VM_ACTIONS = { start: 'start', stop: 'stop', reboot: 'reboot', forceStop: 'forceStop', pause: 'pause', resume: 'resume' };

const CONTAINER_ACTIONS = new Set(['start', 'stop', 'restart']);

/**
 * Resolve Unraid's WebUI template, e.g. "http://[IP]:[PORT:8080]/web".
 * [IP] becomes the container's own IP (custom br0/macvlan networks) or the host address;
 * [PORT:x] becomes the published host port for container port x when bridged.
 */
function resolveWebUi(template, c, hostAddress) {
  if (!template) return null;
  const mode = c.hostConfig?.networkMode || 'bridge';
  const nets = Object.values(c.networkSettings?.Networks || c.networkSettings?.networks || {});
  const ownIp = !['bridge', 'host'].includes(mode) ? nets.find((n) => n.IPAddress)?.IPAddress : null;
  return template
    .replace(/\[IP\]/gi, ownIp || hostAddress)
    .replace(/\[PORT:(\d+)\]/gi, (_, port) => {
      if (ownIp || mode === 'host') return port;
      const mapped = (c.ports || []).find((p) => String(p.privatePort) === port && p.publicPort);
      return String(mapped?.publicPort || port);
    });
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Unraid 7.x ships an official GraphQL API (Settings → Management Access → API Keys).
 * The schema has shifted between releases, so each section is queried independently
 * and a failure in one doesn't take down the rest.
 */
export function createUnraid(cfg) {
  async function gql(query) {
    const res = await request(`${cfg.url}/graphql`, {
      method: 'POST',
      headers: { 'x-api-key': cfg.apiKey },
      body: { query },
      insecure: cfg.insecure,
      timeout: query.startsWith('mutation') ? 60000 : 10000,
    });
    if (res?.errors?.length && !res.data) throw new Error(res.errors.map((e) => e.message).join('; '));
    return res?.data || {};
  }
  async function firstOf(...queries) {
    let lastErr;
    for (const q of queries) {
      try { return await gql(q); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  const disk = (d) => ({
    name: d.name,
    size: num(d.size), // KiB
    temp: num(d.temp),
    status: d.status,
    fsSize: num(d.fsSize),
    fsUsed: num(d.fsUsed),
    fsFree: num(d.fsFree),
    errors: num(d.numErrors) || 0,
    spinning: d.isSpinning ?? null,
  });

  return {
    async system() {
      const [info, metrics] = await Promise.allSettled([
        firstOf(
          '{ info { os { hostname uptime release } cpu { brand cores threads } versions { core { unraid } } } }',
          '{ info { os { hostname uptime release } cpu { brand cores threads } } }',
        ),
        gql('{ metrics { cpu { percentTotal } memory { total used percentTotal } } }'),
      ]);
      if (info.status === 'rejected') throw info.reason;
      const i = info.value.info || {};
      const m = metrics.status === 'fulfilled' ? metrics.value.metrics : null;
      const up = i.os?.uptime;
      return {
        hostname: i.os?.hostname,
        version: i.versions?.core?.unraid || i.os?.release || null,
        cpu: i.cpu ? `${i.cpu.brand} (${i.cpu.cores}C/${i.cpu.threads}T)` : null,
        bootedAt: typeof up === 'string' && isNaN(Number(up)) ? Date.parse(up) : up ? Date.now() - Number(up) * 1000 : null,
        cpuPercent: num(m?.cpu?.percentTotal),
        memory: m?.memory ? { total: num(m.memory.total), used: num(m.memory.used), percent: num(m.memory.percentTotal) } : null,
      };
    },

    async array() {
      const d = await firstOf(
        '{ array { state capacity { kilobytes { free used total } } parities { name size temp status numErrors isSpinning } disks { name size temp status fsSize fsFree fsUsed numErrors isSpinning } caches { name size temp status fsSize fsFree fsUsed numErrors isSpinning } } }',
        '{ array { state capacity { kilobytes { free used total } } parities { name size temp status } disks { name size temp status fsSize fsFree fsUsed } caches { name size temp status fsSize fsFree fsUsed } } }',
      );
      const a = d.array || {};
      const kb = a.capacity?.kilobytes || {};
      return {
        state: a.state,
        capacity: { total: num(kb.total), used: num(kb.used), free: num(kb.free) },
        parities: (a.parities || []).map(disk),
        disks: (a.disks || []).map(disk),
        caches: (a.caches || []).map(disk),
      };
    },

    async vms() {
      const d = await firstOf('{ vms { domains { id uuid name state } } }', '{ vms { domain { uuid name state } } }');
      const list = d.vms?.domains || d.vms?.domain || [];
      return list.map((v) => ({ id: v.id || v.uuid, name: v.name, state: String(v.state || '').toLowerCase() }));
    },

    async vmAction(id, action) {
      const op = VM_ACTIONS[action];
      if (!op) throw Object.assign(new Error(`Unknown VM action ${action}`), { statusCode: 400 });
      await gql(`mutation { vm { ${op}(id: ${JSON.stringify(String(id))}) } }`);
      return { ok: true };
    },

    async notifications() {
      const d = await gql('{ notifications { overview { unread { info warning alert total } } } }');
      const u = d.notifications?.overview?.unread || {};
      return { info: u.info || 0, warning: u.warning || 0, alert: u.alert || 0, total: u.total || 0 };
    },

    async containers() {
      const d = await firstOf(
        '{ docker { containers { id names image state status created autoStart ports { privatePort publicPort type } labels hostConfig { networkMode } networkSettings } } }',
        '{ docker { containers { id names image state status autoStart ports { privatePort publicPort type } } } }',
      );
      return (d.docker?.containers || [])
        .map((c) => {
          const name = (c.names?.[0] || c.id).replace(/^\//, '');
          const labels = c.labels || {};
          const seen = new Set();
          return {
            id: c.id,
            name,
            image: c.image,
            state: String(c.state || '').toLowerCase(), // RUNNING | EXITED | PAUSED → lower case
            status: c.status || '',
            created: c.created ? c.created * 1000 : null,
            ports: (c.ports || [])
              .filter((p) => p.publicPort && !seen.has(p.publicPort) && seen.add(p.publicPort))
              .map((p) => ({ private: p.privatePort, public: p.publicPort, type: String(p.type || '').toLowerCase() })),
            network: c.hostConfig?.networkMode || null,
            icon: labels['net.unraid.docker.icon'] || null,
            url: cfg.urls[name] || resolveWebUi(labels['net.unraid.docker.webui'], c, cfg.hostAddress),
            favourite: cfg.favourites.includes(name),
            autoStart: c.autoStart ?? null,
          };
        })
        .filter((c) => !cfg.hide.includes(c.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async containerAction(id, action) {
      if (!CONTAINER_ACTIONS.has(action)) throw Object.assign(new Error(`Unknown action ${action}`), { statusCode: 400 });
      const run = (op) => firstOf(
        `mutation { docker { ${op}(id: ${JSON.stringify(String(id))}) { id state } } }`,
        `mutation { docker { ${op}(id: ${JSON.stringify(String(id))}) } }`,
      );
      // The Unraid API has start/stop but no restart.
      if (action === 'restart') { await run('stop'); await run('start'); } else await run(action);
      return { ok: true };
    },
  };
}
