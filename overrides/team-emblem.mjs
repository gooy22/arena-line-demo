const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

export function emblemCandidates(team) {
  const id = String(team?.id ?? '').trim();
  const name = String(team?.name || '').trim();
  const category = String(team?.categoryName || '').trim();
  const source = String(team?.icon?.url || team?.iconUrl || '').trim();
  const numericId=/^[0-9]{1,16}$/.test(id);
  if (!numericId && !name) return [];

  const base='/api/media/team?' +
    (numericId ? 'id=' + encodeURIComponent(id) + '&' : '') +
    'name=' + encodeURIComponent(name) +
    '&category=' + encodeURIComponent(category) +
    '&source=' + encodeURIComponent(source);
  const urls=numericId
    ? [base + '&prefer=parik',base + '&prefer=parik-alt',base + '&prefer=bo3']
    : [base + '&prefer=bo3'];
  const failed=globalThis.window?.__arenaFailedLogoSources;
  return urls.filter(url => !failed || !failed.has(url));
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

  const rawEntityKey=String(team?.id || (String(team?.categoryName || '') + ':' + String(team?.name || '')) || '');
  const entityKey='team:' + rawEntityKey;
  const entity=globalThis.window?.__arenaEntityLogoCache?.get(entityKey);
  const logoCache=globalThis.window?.__arenaLogoCache;
  const cachedSource = logoCache ? urls.find(url => logoCache.has(url)) : '';
  const ordered = cachedSource ? [cachedSource, ...urls.filter(url => url !== cachedSource)] : urls;
  const primarySource = entity?.source || ordered[0] || '';
  const fallbacks = ordered.filter(url => url && url !== primarySource);
  const primary = entity?.src ||
    (globalThis.window?.__arenaStableLogoSrc ? window.__arenaStableLogoSrc(primarySource) : primarySource);
  const sourceIsCached = !!(cachedSource && logoCache?.has(cachedSource));
  const logoState = entity?.src || sourceIsCached ? 'ready' : primary ? 'loading' : 'failed';
  const image = primary
    ? `<img class="team-logo" src="${escape(primary)}" data-arena-source="${escape(primarySource)}" data-entity-kind="team" data-entity-key="${escape(rawEntityKey)}" data-entity-name="${escape(String(team?.name || ''))}" data-category="${escape(String(team?.categoryName || ''))}" data-fallbacks="${escape(JSON.stringify(fallbacks))}" data-fallback-index="0" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="window.__arenaNormalizeLogo&&window.__arenaNormalizeLogo(this)" onerror="window.__arenaFailLogo?window.__arenaFailLogo(this):(this.hidden=true)">`
    : '';

  return `<span class="team-emblem-picture" data-logo-state="${logoState}">${image}<span class="team-emblem-fallback" title="${escape(team?.name)}">${escape(initials)}</span></span>`;
}
