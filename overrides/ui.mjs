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

const ESPORTS_CONTROLLER_DATA='data:image/png;base64,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';

export const wordmark='<span class="wordmark brand-placeholder" aria-hidden="true"></span>';

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
    return `<img class="reference-graphic gamepad-graphic ${className}" src="${ESPORTS_CONTROLLER_DATA}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
  }
  const fallback=fallbackSvg(name);
  if (fallback) return fallback.replace('reference-graphic','reference-graphic '+className);
  return `<img class="reference-graphic ${className}" src="/assets/icons/${name}.png" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}
