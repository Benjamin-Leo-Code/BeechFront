import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_PATH = path.resolve(process.env.BEECHFRONT_CONFIG || 'config/config.yaml');
export const DATA_DIR = path.resolve(process.env.BEECHFRONT_DATA || 'data');

/** Replace ${VAR} and ${VAR:-default} with environment values, recursively. */
function interpolate(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_, name, fallback) => process.env[name] ?? fallback ?? '');
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  }
  return value;
}

const trimSlash = (u) => (u ? String(u).replace(/\/+$/, '') : u);

export function loadConfig() {
  let raw = {};
  if (fs.existsSync(CONFIG_PATH)) {
    raw = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } else {
    console.warn(`[config] No config file at ${CONFIG_PATH} – running with defaults.`);
  }
  const cfg = interpolate(raw);

  return {
    title: cfg.title || 'BeechFront',
    subtitle: cfg.subtitle || '',
    port: Number(process.env.PORT || cfg.port || 8484),
    demo: process.env.BEECHFRONT_DEMO === '1' || cfg.demo === true,
    auth: {
      password: process.env.BEECHFRONT_PASSWORD || cfg.auth?.password || '',
      sessionDays: Number(cfg.auth?.sessionDays || 30),
    },
    unraid: cfg.unraid?.url ? {
      url: trimSlash(cfg.unraid.url),
      webUrl: trimSlash(cfg.unraid.webUrl || cfg.unraid.url),
      apiKey: cfg.unraid.apiKey || '',
      insecure: cfg.unraid.insecure !== false,
    } : null,
    docker: cfg.docker === false ? null : {
      socket: cfg.docker?.socket || '/var/run/docker.sock',
      // Address used to build container web UI links (usually your Unraid server's LAN IP or hostname)
      hostAddress: cfg.docker?.hostAddress || (cfg.unraid?.url ? new URL(cfg.unraid.url).hostname : 'localhost'),
      hide: cfg.docker?.hide || [],
      urls: cfg.docker?.urls || {},
      favourites: cfg.docker?.favourites || [],
    },
    homeassistant: cfg.homeassistant?.url ? {
      url: trimSlash(cfg.homeassistant.url),
      webUrl: trimSlash(cfg.homeassistant.webUrl || cfg.homeassistant.url),
      token: cfg.homeassistant.token || '',
      vmName: cfg.homeassistant.vmName || 'Home Assistant',
      lowBattery: Number(cfg.homeassistant.lowBattery ?? 20),
      hide: cfg.homeassistant.hide || [],
      insecure: cfg.homeassistant.insecure !== false,
    } : null,
    unifi: cfg.unifi?.url ? {
      url: trimSlash(cfg.unifi.url),
      webUrl: trimSlash(cfg.unifi.webUrl || cfg.unifi.url),
      apiKey: cfg.unifi.apiKey || '',
      site: cfg.unifi.site || 'default',
      apiBase: trimSlash(cfg.unifi.apiBase || '/proxy/network/integration/v1'),
      insecure: cfg.unifi.insecure !== false,
    } : null,
    links: Array.isArray(cfg.links) ? cfg.links : [],
  };
}
