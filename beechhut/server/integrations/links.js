import { probe } from '../http.js';

const ICON_CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';

/** `icon: plex` → dashboard-icons CDN; a full URL is used as-is. */
export const iconUrl = (icon) => (!icon ? null : /^(https?:)?\/\//.test(icon) || icon.startsWith('/') ? icon : `${ICON_CDN}/${icon}.svg`);

export function createLinks(groups) {
  const normalised = groups.map((g) => ({
    name: g.name || g.group || 'Links',
    items: (g.items || g.links || []).map((l) => ({
      name: l.name,
      url: l.url,
      description: l.description || '',
      icon: iconUrl(l.icon),
      pinned: Boolean(l.pinned),
      check: l.check === false ? null : typeof l.check === 'string' ? l.check : l.url,
    })),
  }));

  return {
    async list() {
      const results = await Promise.all(
        normalised.flatMap((g) => g.items).map(async (l) => [l.url, l.check ? await probe(l.check) : null]),
      );
      const health = Object.fromEntries(results);
      return normalised.map((g) => ({
        name: g.name,
        items: g.items.map(({ check, ...l }) => ({ ...l, health: health[l.url] })),
      }));
    },
  };
}
