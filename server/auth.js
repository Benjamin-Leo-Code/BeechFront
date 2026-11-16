import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const COOKIE = 'bf_session';

function loadSecret() {
  if (process.env.BEECHFRONT_SECRET) return process.env.BEECHFRONT_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export function registerAuth(app, config) {
  const enabled = Boolean(config.auth.password);
  const secret = enabled ? loadSecret() : '';
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  const isValid = (token) => {
    if (!enabled) return true;
    if (!token) return false;
    const [expiry, sig] = token.split('.');
    if (!expiry || !sig || Number(expiry) < Date.now()) return false;
    return safeEqual(sig, sign(expiry));
  };

  if (!enabled) {
    console.warn('[auth] BEECHFRONT_PASSWORD is not set – the console is open to anyone who can reach it.');
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/session') || req.url.startsWith('/api/login')) return;
    if (!isValid(req.cookies[COOKIE])) return reply.code(401).send({ error: 'Not signed in' });
  });

  app.get('/api/session', async (req) => ({ authRequired: enabled, authenticated: isValid(req.cookies[COOKIE]) }));

  app.post('/api/login', async (req, reply) => {
    if (!enabled) return { ok: true };
    if (!safeEqual(req.body?.password || '', config.auth.password)) {
      await new Promise((r) => setTimeout(r, 800));
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    const maxAge = config.auth.sessionDays * 86400;
    const expiry = String(Date.now() + maxAge * 1000);
    reply.setCookie(COOKIE, `${expiry}.${sign(expiry)}`, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge,
      secure: req.protocol === 'https',
    });
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
