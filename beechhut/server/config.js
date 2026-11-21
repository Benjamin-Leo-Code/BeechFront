import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** Running as a Home Assistant add-on – the Supervisor injects this token. */
export const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);

const OPTIONS_PATH = process.env.BEECHHUT_OPTIONS || '/data/options.json';
// Optional advanced config: /addon_configs/<slug>/config.yaml on the HA host (mounted at /config).
const CONFIG_PATH = path.resolve(process.env.BEECHHUT_CONFIG || (ADDON ? '/config/config.yaml' : 'config.yaml'));
export const DATA_DIR = path.resolve(process.env.BEECHHUT_DATA || (ADDON ? '/data' : 'data'));

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

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
const readYaml = (p) => { try { return YAML.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; } };
const trimSlash = (u) => (u ? String(u).replace(/\/+$/, '') : u);
const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
/** First non-blank value. */
const pick = (...vals) => vals.find((v) => !blank(v));

/** Flat add-on `links` option (each with an optional group) → grouped links. */
function groupLinks(flat = []) {
  const groups = new Map();
  for (const { group, ...l } of flat) {
    const g = group || 'Links';
    groups.set(g, [...(groups.get(g) || []), l]);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}

export function loadConfig() {
  const o = readJson(OPTIONS_PATH);          // add-on options page
  const y = interpolate(readYaml(CONFIG_PATH)); // optional config.yaml
  const unraidUrl = trimSlash(pick(o.unraid_url, y.unraid?.url));
  const unifiUrl = trimSlash(pick(o.unifi_url, y.unifi?.url));

  // Inside HA we talk to Core through the Supervisor proxy with the injected token.
  const haUrl = ADDON ? 'http://supervisor/core' : trimSlash(y.homeassistant?.url);
  const haToken = ADDON ? process.env.SUPERVISOR_TOKEN : y.homeassistant?.token;

  return {
    addon: ADDON,
    title: pick(o.title, y.title) || 'BeechHut',
    subtitle: pick(o.subtitle, y.subtitle) || '',
    port: Number(process.env.PORT || (ADDON ? 8099 : 8484)),
    demo: process.env.BEECHHUT_DEMO === '1',
    unraid: unraidUrl ? {
      url: unraidUrl,
      webUrl: trimSlash(pick(o.unraid_web_url, y.unraid?.webUrl, unraidUrl)),
      apiKey: pick(o.unraid_api_key, y.unraid?.apiKey) || '',
      insecure: y.unraid?.insecure !== false,
      // Address used to turn Unraid "WebUI" templates into links
      hostAddress: pick(o.unraid_host_address, y.unraid?.hostAddress) || new URL(unraidUrl).hostname,
      favourites: pick(o.favourite_containers, y.unraid?.favourites) || [],
      hide: pick(o.hidden_containers, y.unraid?.hide) || [],
      urls: y.unraid?.urls || {},
    } : null,
    homeassistant: haUrl && haToken ? {
      url: haUrl,
      token: haToken,
      vmName: pick(o.ha_vm_name, y.homeassistant?.vmName) || 'Home Assistant',
      lowBattery: Number(pick(o.low_battery, y.homeassistant?.lowBattery) ?? 20),
      hide: pick(o.hidden_entities, y.homeassistant?.hide) || [],
      insecure: true,
    } : null,
    unifi: unifiUrl ? {
      url: unifiUrl,
      webUrl: trimSlash(pick(y.unifi?.webUrl, unifiUrl)),
      apiKey: pick(o.unifi_api_key, y.unifi?.apiKey) || '',
      site: pick(o.unifi_site, y.unifi?.site) || 'default',
      apiBase: trimSlash(pick(o.unifi_api_base, y.unifi?.apiBase) || '/proxy/network/integration/v1'),
      insecure: y.unifi?.insecure !== false,
    } : null,
    // The 3D house plan: a folder in a (private) GitHub repo, or a local folder when developing.
    housePlan: (() => {
      const localDir = process.env.BEECHHUT_HOUSE_PLAN_DIR || y.house_plan?.localDir;
      const repository = pick(o.house_plan_repository, y.house_plan?.repository);
      if (localDir) return { localDir: path.resolve(localDir) };
      if (!repository) return null;
      return {
        repository,
        branch: pick(o.house_plan_branch, y.house_plan?.branch) || 'house-plan',
        path: pick(o.house_plan_path, y.house_plan?.path) ?? 'house-plan',
        token: pick(o.github_token, y.house_plan?.token) || '',
      };
    })(),
    links: !blank(o.links) ? groupLinks(o.links) : Array.isArray(y.links) ? y.links : [],
  };
}
