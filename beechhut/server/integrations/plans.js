import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 3D house plans (LiDAR scans etc.) kept in the add-on's own storage, so
 * they're included in Home Assistant backups. USDZ (what iPhone scanning
 * apps export) and GLB are both shown directly in the browser.
 */
const FORMATS = {
  usdz: { type: 'model/vnd.usdz+zip', magic: [0x50, 0x4b, 0x03, 0x04] }, // ZIP
  glb: { type: 'model/gltf-binary', magic: [0x67, 0x6c, 0x54, 0x46] },   // "glTF"
};

export const PLAN_FORMATS = Object.keys(FORMATS);

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function createPlans(dataDir) {
  const dir = path.join(dataDir, 'plans');
  const indexFile = path.join(dir, 'plans.json');
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  async function read() {
    try { return JSON.parse(await fs.readFile(indexFile, 'utf8')); } catch { return []; }
  }
  async function write(plans) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${indexFile}.tmp`, JSON.stringify(plans, null, 2));
    await fs.rename(`${indexFile}.tmp`, indexFile);
  }
  const fileOf = (p) => path.join(dir, `${p.id}.${p.format}`);

  return {
    list: () => read(),

    add({ name, filename, buffer }) {
      return serial(async () => {
        const format = String(filename || '').split('.').pop().toLowerCase();
        const spec = FORMATS[format];
        if (!spec) throw fail(`Use a .usdz or .glb file (got “${filename || 'unknown'}”)`);
        if (!buffer?.length || !spec.magic.every((b, i) => buffer[i] === b)) throw fail(`That doesn't look like a valid .${format} file`);
        const now = Date.now();
        const plan = {
          id: crypto.randomUUID(),
          name: String(name || filename.replace(/\.[^.]+$/, '')).slice(0, 100) || 'Plan',
          format,
          size: buffer.length,
          created: now,
          updated: now,
        };
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fileOf(plan), buffer);
        const plans = await read();
        plans.push(plan);
        await write(plans);
        return plan;
      });
    },

    rename(id, name) {
      return serial(async () => {
        const plans = await read();
        const plan = plans.find((p) => p.id === id);
        if (!plan) throw fail('No such plan', 404);
        plan.name = String(name || '').trim().slice(0, 100) || plan.name;
        plan.updated = Date.now();
        await write(plans);
        return plan;
      });
    },

    remove(id) {
      return serial(async () => {
        const plans = await read();
        const plan = plans.find((p) => p.id === id);
        if (!plan) throw fail('No such plan', 404);
        await fs.rm(fileOf(plan), { force: true });
        await write(plans.filter((p) => p.id !== id));
        return { ok: true };
      });
    },

    async model(id) {
      const plan = (await read()).find((p) => p.id === id);
      if (!plan) throw fail('No such plan', 404);
      return { plan, file: fileOf(plan), type: FORMATS[plan.format].type };
    },
  };
}
