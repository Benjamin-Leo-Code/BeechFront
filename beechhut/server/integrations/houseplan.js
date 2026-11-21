import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';

/**
 * The house plan: one plan.json describing every part of the house (scans of
 * rooms, floors, the garden) and where each sits. It's read from a folder in
 * a (private) GitHub repository, or from a local folder when developing.
 *
 * Model files are cached in the add-on's storage by their git blob SHA, so
 * each version is downloaded once and served to the browser as immutable.
 */

const FORMATS = { usdz: 'model/vnd.usdz+zip', glb: 'model/gltf-binary' };
const KEY = /^[0-9a-f]{40,64}$/;
const REFRESH_MS = 60_000;

const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

/** Join `base` and a manifest-relative path, refusing anything that escapes it. */
function inside(base, rel) {
  const joined = path.posix.normalize(path.posix.join(base || '.', String(rel || '')));
  const root = path.posix.normalize(base || '.');
  if (joined.startsWith('../') || joined === '..' || (root !== '.' && joined !== root && !joined.startsWith(`${root}/`))) {
    throw fail(`plan.json refers to a file outside the plan folder: ${rel}`, 500);
  }
  return joined === '.' ? '' : joined.replace(/^\.\//, '');
}

function readManifest(text, where) {
  let m;
  try { m = JSON.parse(text); } catch (e) { throw fail(`${where} isn't valid JSON: ${e.message}`, 500); }
  if (!Array.isArray(m?.parts)) throw fail(`${where} needs a "parts" list`, 500);
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    name: typeof m.name === 'string' ? m.name : 'House plan',
    parts: m.parts.map((p, i) => {
      const format = String(p.file || '').split('.').pop().toLowerCase();
      if (!FORMATS[format]) throw fail(`Part ${i + 1} in ${where} must point at a .usdz or .glb file`, 500);
      const pos = Array.isArray(p.position) ? p.position : [];
      return {
        id: String(p.id || p.file),
        name: String(p.name || p.id || p.file),
        level: p.level ? String(p.level) : null,
        file: String(p.file),
        format,
        position: [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)],
        rotation: num(p.rotation, 0),
        unitScale: num(p.unitScale, null) > 0 ? p.unitScale : null,
      };
    }),
  };
}

// ── GitHub ──────────────────────────────────────────────────────────────────
function githubSource(cfg, cacheDir) {
  const api = (process.env.BEECHHUT_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
  const repo = cfg.repository.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw fail('The house plan repository should look like owner/repository', 500);
  const folder = String(cfg.path || '').replace(/^\/+|\/+$/g, '');
  const where = `${folder ? `${folder}/` : ''}plan.json on the ${cfg.branch} branch`;

  async function gh(route, { accept = 'application/vnd.github+json', etag, timeout = 15000 } = {}) {
    let res;
    try {
      res = await fetch(`${api}${route}`, {
        headers: {
          accept,
          'user-agent': 'BeechHut',
          'x-github-api-version': '2022-11-28',
          ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
          ...(etag ? { 'if-none-match': etag } : {}),
        },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw fail(err.name === 'TimeoutError' ? 'GitHub took too long to answer' : `Can't reach GitHub (${err.cause?.code || err.message})`);
    }
    if (res.status === 304) return { notModified: true, res };
    if (res.ok) return { res };
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw fail('GitHub didn’t accept the token – check the GitHub token setting');
    if (res.status === 403 && /rate limit/i.test(body)) throw fail('GitHub’s rate limit was reached – it will retry shortly');
    if (res.status === 403) throw fail('The GitHub token can’t read that repository – it needs Contents: Read-only access to it');
    if (res.status === 404) throw fail(`Couldn’t find ${repo} (branch ${cfg.branch}) on GitHub – check the repository and branch settings, and that the token has access to it`);
    throw fail(`GitHub returned HTTP ${res.status}`);
  }

  let commit = { sha: null, etag: null };
  let files = new Map(); // path → { sha, size }
  let manifest = null;   // { sha, plan }
  let checkedAt = 0;
  let inflight = null;

  async function refresh() {
    // 1. Which commit is the branch on? (Cheap: a 304 when nothing changed.)
    const c = await gh(`/repos/${repo}/commits/${encodeURIComponent(cfg.branch)}`, { accept: 'application/vnd.github.sha', etag: commit.etag });
    if (!c.notModified) {
      const sha = (await c.res.text()).trim();
      if (sha !== commit.sha) {
        // 2. List the files on that commit.
        const t = await gh(`/repos/${repo}/git/trees/${sha}?recursive=1`);
        const tree = await t.res.json();
        files = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, { sha: e.sha, size: e.size }]));
      }
      commit = { sha, etag: c.res.headers.get('etag') };
    }
    // 3. Read plan.json (only when it changed).
    const entry = files.get(inside(folder, 'plan.json'));
    if (!entry) throw fail(`There’s no ${where} in ${repo}`, 404);
    if (manifest?.sha !== entry.sha) {
      const text = (await download(entry.sha)).toString('utf8');
      manifest = { sha: entry.sha, plan: readManifest(text, where) };
    }
    checkedAt = Date.now();
  }

  const downloads = new Map();
  /** A blob's bytes, from the cache or GitHub. */
  function download(sha) {
    if (!downloads.has(sha)) {
      const p = (async () => {
        const file = path.join(cacheDir, `${sha}.bin`);
        try { return await fs.readFile(file); } catch { /* not cached yet */ }
        const { res } = await gh(`/repos/${repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json', timeout: 120000 });
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(`${file}.tmp`, buf);
        await fs.rename(`${file}.tmp`, file);
        return buf;
      })().finally(() => downloads.delete(sha));
      downloads.set(sha, p);
    }
    return downloads.get(sha);
  }

  /** Drop cached blobs nothing refers to any more. */
  async function prune(keep) {
    const names = await fs.readdir(cacheDir).catch(() => []);
    await Promise.all(names.filter((n) => n.endsWith('.bin') && !keep.has(n.slice(0, -4))).map((n) => fs.rm(path.join(cacheDir, n), { force: true })));
  }

  return {
    async load() {
      if (Date.now() - checkedAt > REFRESH_MS || !manifest) {
        inflight ??= refresh().finally(() => { inflight = null; });
        try { await inflight; } catch (err) { if (!manifest) throw err; /* keep showing the last good plan */ }
      }
      const parts = manifest.plan.parts.map((p) => {
        const entry = files.get(inside(folder, p.file));
        if (!entry) throw fail(`plan.json lists ${p.file}, but it isn’t in ${folder || 'the repository'} on the ${cfg.branch} branch`, 404);
        return { ...p, key: entry.sha, size: entry.size };
      });
      prune(new Set([manifest.sha, ...parts.map((p) => p.key)])).catch(() => {});
      return { name: manifest.plan.name, parts, revision: commit.sha?.slice(0, 7) || null };
    },
    async file(key, parts) {
      const part = parts.find((p) => p.key === key);
      if (!part) throw fail('Not part of the current plan', 404);
      await download(key);
      return { path: path.join(cacheDir, `${key}.bin`), type: FORMATS[part.format], size: part.size };
    },
  };
}

// ── Local folder (development) ──────────────────────────────────────────────
function localSource(dir) {
  return {
    async load() {
      const text = await fs.readFile(path.join(dir, 'plan.json'), 'utf8').catch(() => { throw fail(`No plan.json in ${dir}`, 404); });
      const plan = readManifest(text, 'plan.json');
      const parts = await Promise.all(plan.parts.map(async (p) => {
        const file = path.join(dir, inside('', p.file));
        const stat = await fs.stat(file).catch(() => { throw fail(`plan.json lists ${p.file}, but it isn’t there`, 404); });
        const key = crypto.createHash('sha1').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex');
        return { ...p, key, size: stat.size, localPath: file };
      }));
      return { name: plan.name, parts, revision: null };
    },
    async file(key, parts) {
      const part = parts.find((p) => p.key === key);
      if (!part) throw fail('Not part of the current plan', 404);
      return { path: part.localPath, type: FORMATS[part.format], size: part.size };
    },
  };
}

export function createHousePlan(cfg, dataDir) {
  if (!cfg) return null;
  let source;
  try {
    source = cfg.localDir ? localSource(cfg.localDir) : githubSource(cfg, path.join(dataDir, 'house-plan-cache'));
  } catch (err) {
    // A settings mistake shows on the House Plan page rather than stopping the add-on.
    source = { load: async () => { throw err; }, file: async () => { throw err; } };
  }
  let lastParts = [];
  return {
    async plan() {
      const plan = await source.load();
      lastParts = plan.parts;
      return {
        name: plan.name,
        revision: plan.revision,
        parts: plan.parts.map(({ localPath, file, ...p }) => ({ ...p, url: `api/house-plan/files/${p.key}` })),
      };
    },
    async file(key) {
      if (!KEY.test(key)) throw fail('Not found', 404);
      if (!lastParts.some((p) => p.key === key)) await this.plan();
      return source.file(key, lastParts);
    },
  };
}
