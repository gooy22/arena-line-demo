const origin='https://parik24.me';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emblemURL(team){
  const raw=String(team.icon?.url||'').trim();
  if(/^https:\/\/parik24\.me\/assets\/images\/[A-Za-z0-9._-]+$/i.test(raw))return raw;
  if(/^\/assets\/images\/[A-Za-z0-9._-]+$/i.test(raw))return origin+raw;
  return null;
}
export function teamEmblem(team){
  const url=emblemURL(team), initials=String(team.name||'').trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]||'').join('').toUpperCase()||'—';
  return '<span class="team-emblem-picture">'+(url?'<img class="team-logo" src="'+escape(url)+'" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false">':'')+'<span class="team-emblem-fallback" '+(url?'hidden':'')+' title="'+escape(team.name)+'">'+escape(initials)+'</span></span>';
}
