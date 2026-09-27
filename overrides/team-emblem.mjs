const ORIGINS = ['https://parik24.pro','https://24parik-bet.org'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

function normalizedPath(team) {
  const raw = String(team?.icon?.url || team?.iconUrl || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, ORIGINS[0]);
    return url.pathname.replace(/^\//,'');
  } catch {
    return raw.replace(/^\//,'');
  }
}

export function emblemCandidates(team) {
  const id = String(team?.id ?? '').trim();
  const name = String(team?.name || '').trim();
  const category = String(team?.categoryName || '').trim();
  if (!/^\d{1,12}$/.test(id)) return [];

  const base='/api/media/team?id=' + encodeURIComponent(id) +
    '&name=' + encodeURIComponent(name) +
    '&category=' + encodeURIComponent(category);
  const urls=[base + '&prefer=parik', base + '&prefer=bo3'];

  const retry = globalThis.window?.__arenaLogoRetry;
  const now=Date.now();
  return urls.filter(url => !retry || Number(retry.get(url) || 0) <= now);
}

export function emblemURL(team) {
  return emblemCandidates(team)[0] || null;
}

export function teamEmblem(team) {
  const urls = emblemCandidates(team);
  const initials = String(team?.name || '')
    .trim()
    .split(/\s+/)
    .slice(0,2)
    .map(word => Array.from(word)[0] || '')
    .join('')
    .toUpperCase() || '—';

  globalThis.window && (window.__arenaLogoRetry = window.__arenaLogoRetry || new Map());
  const logoCache = globalThis.window?.__arenaLogoCache;
  const cachedSource = logoCache ? urls.find(url => logoCache.has(url)) : '';
  const ordered = cachedSource ? [cachedSource, ...urls.filter(url => url !== cachedSource)] : urls;
  const primarySource = ordered[0] || '';
  const fallbackSource = ordered[1] || '';
  const primary = globalThis.window?.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(primarySource) : primarySource;
  const fallbacks = fallbackSource ? [fallbackSource] : [];
  const image = primary
    ? `<img class="team-logo" src="${escape(primary)}" data-arena-source="${escape(primarySource)}" data-entity-kind="team" data-entity-key="${escape(String(team?.id || team?.name || ''))}" data-entity-name="${escape(String(team?.name || ''))}" data-category="${escape(String(team?.categoryName || ''))}" data-fallbacks="${escape(JSON.stringify(fallbacks))}" data-fallback-index="0" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="window.__arenaNormalizeLogo&&window.__arenaNormalizeLogo(this)" onerror="window.__arenaFailLogo?window.__arenaFailLogo(this):(this.hidden=true)">`
    : '';

  return `<span class="team-emblem-picture">${image}<span class="team-emblem-fallback" title="${escape(team?.name)}">${escape(initials)}</span></span>`;
}
