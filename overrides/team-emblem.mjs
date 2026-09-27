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
  const candidates = [];

  if (/^\d{1,12}$/.test(id)) {
    candidates.push('/api/media/team?id=' + encodeURIComponent(id) +
      '&name=' + encodeURIComponent(name) +
      '&category=' + encodeURIComponent(category));
  } else {
    const raw = String(team?.icon?.url || team?.iconUrl || '').trim();
    if (/^https?:\/\//i.test(raw)) candidates.push(raw);
  }

  return [...new Set(candidates)];
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

  const logoCache = globalThis.window?.__arenaLogoCache;
  const cachedSource = logoCache ? urls.find(url => logoCache.has(url)) : '';
  const ordered = cachedSource ? [cachedSource, ...urls.filter(url => url !== cachedSource)] : urls;
  const primarySource = ordered[0] || '';
  const fallbackSource = ordered[1] || '';
  const primary = globalThis.window?.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(primarySource) : primarySource;
  const fallback = globalThis.window?.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(fallbackSource) : fallbackSource;
  const image = primary
    ? `<img class="team-logo" src="${escape(primary)}" data-arena-source="${escape(primarySource)}" data-fallback-src="${escape(fallback)}" data-fallback-source="${escape(fallbackSource)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="window.__arenaNormalizeLogo&&window.__arenaNormalizeLogo(this)" onerror="const f=this.dataset.fallbackSrc;if(f&&this.src!==f){this.src=f;this.dataset.arenaSource=this.dataset.fallbackSource||f;this.dataset.fallbackSrc='';}else{this.hidden=true;this.nextElementSibling.hidden=false;}">`
    : '';

  return `<span class="team-emblem-picture">${image}<span class="team-emblem-fallback" ${primary ? 'hidden' : ''} title="${escape(team?.name)}">${escape(initials)}</span></span>`;
}
