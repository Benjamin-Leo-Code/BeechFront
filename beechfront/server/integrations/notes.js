import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Tiny JSON-file store for house notes (bin days, alarm codes hint, boiler service dates…). */
export function createNotes(dataDir) {
  const file = path.join(dataDir, 'notes.json');
  let queue = Promise.resolve();

  async function read() {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
  }
  async function write(notes) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(notes, null, 2));
    await fs.rename(tmp, file);
  }
  const serial = (fn) => (queue = queue.then(fn, fn));

  return {
    async list() {
      const notes = await read();
      return notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
    },
    save(note) {
      return serial(async () => {
        const notes = await read();
        const now = Date.now();
        const clean = { title: String(note.title || '').slice(0, 200), body: String(note.body || '').slice(0, 100000), pinned: Boolean(note.pinned) };
        const existing = note.id && notes.find((n) => n.id === note.id);
        if (existing) Object.assign(existing, clean, { updated: now });
        else notes.push({ id: crypto.randomUUID(), ...clean, created: now, updated: now });
        await write(notes);
        return existing || notes[notes.length - 1];
      });
    },
    remove(id) {
      return serial(async () => {
        const notes = await read();
        await write(notes.filter((n) => n.id !== id));
        return { ok: true };
      });
    },
  };
}
