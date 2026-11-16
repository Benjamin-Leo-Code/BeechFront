import { request } from '../http.js';

/**
 * Uses UniFi's official Network Integration API (Network 9+):
 * create a key under UniFi Network → Settings → Control Plane → Integrations.
 */
export function createUnifi(cfg) {
  const api = (path, opts = {}) =>
    request(`${cfg.url}${cfg.apiBase}${path}`, { headers: { 'x-api-key': cfg.apiKey }, insecure: cfg.insecure, ...opts });

  async function all(path) {
    const out = [];
    for (let offset = 0; offset < 2000;) {
      const page = await api(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=200`);
      const data = page?.data || [];
      out.push(...data);
      offset += data.length;
      if (!data.length || offset >= (page.totalCount ?? 0)) break;
    }
    return out;
  }

  let siteId = null;
  async function site() {
    if (siteId) return siteId;
    const sites = await all('/sites');
    const match = sites.find((s) => s.internalReference === cfg.site || s.name === cfg.site || s.id === cfg.site) || sites[0];
    if (!match) throw new Error('No UniFi sites found');
    siteId = match.id;
    return siteId;
  }

  return {
    async summary() {
      const id = await site();
      const [info, devices, clients] = await Promise.all([
        api('/info').catch(() => null),
        all(`/sites/${id}/devices`),
        all(`/sites/${id}/clients`),
      ]);
      const stats = await Promise.all(
        devices.map((d) => api(`/sites/${id}/devices/${d.id}/statistics/latest`).catch(() => null)),
      );
      const names = Object.fromEntries(devices.map((d) => [d.id, d.name]));
      return {
        version: info?.applicationVersion || null,
        devices: devices.map((d, i) => ({
          id: d.id,
          name: d.name || d.model,
          model: d.model,
          mac: d.macAddress,
          ip: d.ipAddress,
          state: d.state, // ONLINE | OFFLINE | PENDING_ADOPTION | UPDATING | ...
          features: d.features || [],
          uptime: stats[i]?.uptimeSec ?? null,
          cpu: stats[i]?.cpuUtilizationPct ?? null,
          memory: stats[i]?.memoryUtilizationPct ?? null,
          tx: stats[i]?.uplink?.txRateBps ?? null,
          rx: stats[i]?.uplink?.rxRateBps ?? null,
          firmware: d.firmwareVersion || null,
          firmwareUpdatable: d.firmwareUpdatable ?? null,
        })),
        clients: clients.map((c) => ({
          id: c.id,
          name: c.name || c.macAddress,
          type: c.type, // WIRED | WIRELESS | VPN | TELEPORT
          ip: c.ipAddress || null,
          mac: c.macAddress,
          connectedAt: c.connectedAt ? Date.parse(c.connectedAt) : null,
          uplink: names[c.uplinkDeviceId] || null,
          guest: c.access?.type === 'GUEST',
        })),
      };
    },
    async restartDevice(deviceId) {
      const id = await site();
      await api(`/sites/${id}/devices/${encodeURIComponent(deviceId)}/actions`, { method: 'POST', body: { action: 'RESTART' } });
      return { ok: true };
    },
  };
}
