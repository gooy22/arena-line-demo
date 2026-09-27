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
  const path = normalizedPath(team);
  const id = String(team?.id ?? '').trim();
  const candidates = [];

  if (/^https?:\/\//i.test(String(team?.icon?.url || team?.iconUrl || ''))) {
    candidates.push(String(team.icon?.url || team.iconUrl));
  }

  if (/^(?:taxonomyicons\/competitors\/\d{1,12}-164w|assets\/images\/[A-Za-z0-9._/-]+)$/i.test(path)) {
    for (const origin of ORIGINS) candidates.push(`${origin}/${path}`);
  }

  if (/^\d{1,12}$/.test(id)) {
    for (const origin of ORIGINS) {
      candidates.push(`${origin}/taxonomyicons/competitors/${id}-164w`);
    }
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

  const primary = urls[0];
  const fallback = urls[1] || '';
  const image = primary
    ? `<img class="team-logo" src="${escape(primary)}" data-fallback-src="${escape(fallback)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="const f=this.dataset.fallbackSrc;if(f&&this.src!==f){this.src=f;this.dataset.fallbackSrc='';}else{this.hidden=true;this.nextElementSibling.hidden=false;}">`
    : '';

  return `<span class="team-emblem-picture">${image}<span class="team-emblem-fallback" ${primary ? 'hidden' : ''} title="${escape(team?.name)}">${escape(initials)}</span></span>`;
}
