// Stable same-origin/inline UI graphics for Safari/PWA.
const shapes = {
  'sports-score':'<rect x="3" y="4" width="18" height="16" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="15.2" text-anchor="middle" fill="currentColor" font-family="Roboto,sans-serif" font-size="9.2" font-weight="600">2:1</text>',
  'profile-solid':'<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 6Zm-5.5 12a6 6 0 0 1 11 0 8 8 0 0 1-11 0Z"/>',
  'casino-wheel':'<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="7"/><path d="m12 7 4.8 3.5-1.8 5.6H9l-1.8-5.6L12 7Zm0-5v5m9.5 1.9-4.7 1.6m1.1 9.6L15 16.1m-8.9 4L9 16.1M2.5 8.9l4.7 1.6"/></g>'
};

export function icon(name,className='') {
  return shapes[name]
    ? `<svg class="ui-icon ui-${name} ${className}" viewBox="0 0 24 24" aria-hidden="true">${shapes[name]}</svg>`
    : `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
}

export const wordmark='<img class="wordmark" src="/assets/wordmark.png" width="120" height="24" alt="Parik24">';

const fallbackSvg = name => {
  const label = {
    valorant:'V',
    'free-fire':'FF',
    'mobile-legends':'ML',
    pubg:'P',
    apex:'A',
    overwatch:'O',
    'rainbow-six':'R6',
    'rocket-league':'RL',
    'call-of-duty':'COD'
  }[name];
  if (!label) return '';
  return `<svg class="reference-graphic fallback-discipline" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#101010"/><text x="16" y="19.5" text-anchor="middle" fill="#f2f740" font-size="${label.length > 2 ? 7 : 10}" font-family="Arial,sans-serif" font-weight="700">${label}</text></svg>`;
};

export function graphic(name,className='') {
  if (name === 'esports') {
    return `<img class="reference-graphic gamepad-graphic ${className}" src="/assets/icons/esports-controller-clean-v78.png" alt="" aria-hidden="true" draggable="false" decoding="async">`;
  }
  const fallback=fallbackSvg(name);
  if (fallback) return fallback.replace('reference-graphic','reference-graphic '+className);
  return `<img class="reference-graphic ${className}" src="/assets/icons/${name}.png" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}
