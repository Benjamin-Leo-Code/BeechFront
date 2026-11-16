import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { loadConfig, DATA_DIR } from './config.js';
import { registerAuth } from './auth.js';
import { cached, HttpError } from './http.js';
import { createDocker } from './integrations/docker.js';
import { createUnraid } from './integrations/unraid.js';
import { createHomeAssistant } from './integrations/homeassistant.js';
import { createUnifi } from './integrations/unifi.js';
import { createLinks } from './integrations/links.js';
import { createNotes } from './integrations/notes.js';
import { demo, demoLinks } from './demo.js';
import { buildOverview } from './overview.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' }, trustProxy: true });

// ── Integrations ────────────────────────────────────────────────────────────
const i = config.demo
  ? { ...demo, links: config.links.length ? createLinks(config.links) : demoLinkStore() }
  : {
      docker: config.docker && fs.existsSync(config.docker.socket) ? createDocker(config.docker) : null,
      unraid: config.unraid?.apiKey ? createUnraid(config.unraid) : null,
      homeassistant: config.homeassistant?.token ? createHomeAssistant(config.homeassistant) : null,
      unifi: config.unifi?.apiKey ? createUnifi(config.unifi) : null,
      links: createLinks(config.links),
    };
const notes = createNotes(DATA_DIR);

function demoLinkStore() {
  const store = createLinks(demoLinks.map((g) => ({ ...g, items: g.items.map((l) => ({ ...l, check: false })) })));
  return {
    async list() {
      const groups = await store.list();
      for (const l of groups.flatMap((g) => g.items)) {
        l.health = l.name.startsWith('Router') ? { up: false, status: 0, ms: null, error: 'ETIMEDOUT' } : { up: true, status: 200, ms: 4 + Math.round(Math.random() * 30) };
      }
      return groups;
    },
  };
}

// Short caches keep things snappy with several devices open, without going stale.
const c = {
  containers: i.docker && cached(3000, async () => {
    const list = await i.docker.list();
    if (i.unraid) {
      const auto = await i.unraid.autostart().catch(() => null);
      if (auto) for (const ct of list) ct.autoStart = auto[ct.name] ?? ct.autoStart;
    }
    return list;
  }),
  system: i.unraid && cached(5000, () => i.unraid.system()),
  array: i.unraid && cached(15000, () => i.unraid.array()),
  vms: i.unraid && cached(3000, () => i.unraid.vms()),
  unraidNotifications: i.unraid && cached(30000, () => i.unraid.notifications()),
  haInfo: i.homeassistant && cached(60000, () => i.homeassistant.info()),
  haStates: i.homeassistant && cached(2000, () => i.homeassistant.states()),
  unifi: i.unifi && cached(10000, () => i.unifi.summary()),
  links: cached(30000, () => i.links.list()),
};

const need = (fn, name) => {
  if (!fn) throw Object.assign(new Error(`${name} is not configured`), { statusCode: 503 });
  return fn;
};

// ── Server setup ────────────────────────────────────────────────────────────
await app.register(fastifyCookie);
registerAuth(app, config);

app.setErrorHandler((err, _req, reply) => {
  // Our own errors (and Fastify's) carry statusCode. Anything from an upstream system is a 502/504 –
  // never pass an upstream 401 through, or the browser would think *we* signed it out.
  const status = err.statusCode ?? (err instanceof HttpError ? (err.status === 504 ? 504 : 502) : 500);
  app.log.warn(err);
  const message = err.message;
  reply.code(status).send({ error: message || 'Something went wrong' });
});

// ── API ─────────────────────────────────────────────────────────────────────
app.get('/api/meta', async () => ({
  title: config.title,
  subtitle: config.subtitle,
  demo: config.demo,
  authRequired: Boolean(config.auth.password),
  integrations: {
    docker: Boolean(i.docker), unraid: Boolean(i.unraid), homeassistant: Boolean(i.homeassistant), unifi: Boolean(i.unifi),
  },
  webUrls: {
    unraid: config.unraid?.webUrl || (config.demo ? 'http://192.168.1.10' : null),
    homeassistant: config.homeassistant?.webUrl || (config.demo ? 'http://192.168.1.11:8123' : null),
    unifi: config.unifi?.webUrl || (config.demo ? 'https://192.168.1.1' : null),
  },
  haVmName: config.homeassistant?.vmName || 'Home Assistant',
}));

app.get('/api/overview', async () => buildOverview({ c, config }));

// Docker
app.get('/api/docker/containers', async () => need(c.containers, 'Docker')());
app.post('/api/docker/containers/:id/:action', async (req) => {
  const r = await need(i.docker, 'Docker').action(req.params.id, req.params.action);
  c.containers.invalidate();
  return r;
});
app.get('/api/docker/containers/:id/logs', async (req) => need(i.docker, 'Docker').logs(req.params.id, req.query.tail));

// Unraid
app.get('/api/unraid/system', async () => need(c.system, 'Unraid')());
app.get('/api/unraid/array', async () => need(c.array, 'Unraid')());
app.get('/api/unraid/vms', async () => need(c.vms, 'Unraid')());
app.get('/api/unraid/notifications', async () => need(c.unraidNotifications, 'Unraid')());
app.post('/api/unraid/vms/:id/:action', async (req) => {
  const r = await need(i.unraid, 'Unraid').vmAction(req.params.id, req.params.action);
  c.vms.invalidate();
  return r;
});

// Home Assistant
app.get('/api/ha/info', async () => need(c.haInfo, 'Home Assistant')());
app.get('/api/ha/states', async () => need(c.haStates, 'Home Assistant')());
app.post('/api/ha/service', async (req) => {
  const { domain, service, data } = req.body || {};
  const r = await need(i.homeassistant, 'Home Assistant').callService(domain, service, data);
  c.haStates.invalidate();
  return r;
});
app.post('/api/ha/check-config', async () => need(i.homeassistant, 'Home Assistant').checkConfig());

// UniFi
app.get('/api/unifi', async () => need(c.unifi, 'UniFi')());
app.post('/api/unifi/devices/:id/restart', async (req) => need(i.unifi, 'UniFi').restartDevice(req.params.id));

// Links & notes
app.get('/api/links', async () => c.links());
app.get('/api/notes', async () => notes.list());
app.post('/api/notes', async (req) => notes.save(req.body || {}));
app.delete('/api/notes/:id', async (req) => notes.remove(req.params.id));

// ── Front end ───────────────────────────────────────────────────────────────
const dist = path.resolve(here, '../web/dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist,
    setHeaders: (reply, file) => {
      // Hashed build assets never change; everything else should revalidate.
      reply.header('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`BeechFront listening on :${config.port}${config.demo ? ' (demo mode)' : ''}`);
