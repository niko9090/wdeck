/**
 * Set di icone vettoriali usate dai bottoni (nome icona -> contenuto SVG).
 * viewBox 24x24, stroke = currentColor. I nomi corrispondono al campo `icon`
 * di deck.json; il firmware ESP32 usa gli stessi nomi con glifi semplificati.
 */

export const ICONS = {
  play: '<polygon points="7,4 20,12 7,20" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  next: '<polygon points="5,4 15,12 5,20" fill="currentColor" stroke="none"/><rect x="16.5" y="4" width="2.5" height="16" fill="currentColor" stroke="none"/>',
  prev: '<polygon points="19,4 9,12 19,20" fill="currentColor" stroke="none"/><rect x="5" y="4" width="2.5" height="16" fill="currentColor" stroke="none"/>',
  'volume-up': '<polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  'volume-down': '<polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="currentColor" stroke="none"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.2 3 14.8 0 18c-3-3.2-3-14.8 0-18z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  rocket: '<path d="M14 4c3 1.5 6 4.5 6 9l-3 3c-4.5 0-7.5-3-9-6z"/><path d="M8.5 16.5L5 20"/><circle cx="15" cy="9" r="1.5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2L16.7 7.3M7.3 16.7L5.2 18.8"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M9 7l1.5-2h3L15 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  star: '<polygon points="12,3 14.6,9.1 21,9.7 16.2,14 17.6,20.3 12,17 6.4,20.3 7.8,14 3,9.7 9.4,9.1"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  layers: '<polygon points="12,3 21,8 12,13 3,8"/><path d="M3 13l9 5 9-5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  text: '<path d="M5 6h14"/><path d="M12 6v13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  // --- libreria allargata (0.11): casa, luci, media, sistema, lavoro, gioco ---
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8 13a5 5 0 1 1 8 0c-1 1-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  thermometer: '<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 2-6 4-6s3 2 1 4-3 2-5 2z"/><path d="M14 12c4 0 6 2 6 4s-2 3-4 1-2-3-2-5z"/><path d="M12 14c0 4-2 6-4 6s-3-2-1-4 3-2 5-2z"/><path d="M10 12c-4 0-6-2-6-4s2-3 4-1 2 3 2 5z"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  laptop: '<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M2 19h20"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="4" y="14" width="4" height="6" rx="1.5"/><rect x="16" y="14" width="4" height="6" rx="1.5"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="7.5" r="1"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M3 7h4l10 10h4"/><path d="M3 17h4l3-3"/><path d="M14 7h7"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chat: '<path d="M4 5h16v10H9l-5 4z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  save: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7V4"/><rect x="8" y="14" width="8" height="6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3v5h-5"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  bolt: '<polygon points="13,2 4,14 11,14 10,22 20,9 13,9" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  pin: '<path d="M12 21s6-6 6-11a6 6 0 0 0-12 0c0 5 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  gamepad: '<rect x="2" y="8" width="20" height="10" rx="5"/><path d="M7 11v4M5 13h4"/><circle cx="16" cy="12" r="1" fill="currentColor"/><circle cx="18.5" cy="14" r="1" fill="currentColor"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/>',
  coffee: '<path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M7 4v2M10 4v2M13 4v2"/>',
  car: '<path d="M4 16l1.5-6h13L20 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.5"/><circle cx="16.5" cy="20" r="1.5"/>',
  print: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="9" rx="2"/><rect x="7" y="14" width="10" height="7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M6 6.5h.01M9 6.5h.01"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  minimize: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  default: '<circle cx="12" cy="12" r="8"/>'
};

/** Icona predefinita associata a ciascun tipo di azione. */
export const ICON_BY_ACTION = {
  media: 'play',
  hotkey: 'keyboard',
  text: 'text',
  launch: 'rocket',
  script: 'terminal',
  url: 'globe',
  http: 'link',
  sequence: 'layers',
  navigate: 'next',
  delay: 'clock',
  noop: 'default',
  stub: 'gear'
};

/** Prefisso delle icone caricate dall'utente (vedi src/host/icons.mjs). */
export const CUSTOM_PREFIX = 'custom:';
export const EMOJI_PREFIX = 'emoji:';

/** true se il nome punta a un'icona caricata dall'utente. */
export const isCustomIcon = (name) => typeof name === 'string' && name.startsWith(CUSTOM_PREFIX);

/** true se il nome e' un'emoji ("emoji:🔊"). */
export const isEmojiIcon = (name) => typeof name === 'string' && name.startsWith(EMOJI_PREFIX);

/** Neutralizza i caratteri pericolosi per l'HTML in un'emoji. */
function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * Restituisce il markup SVG completo di un'icona inclusa.
 * @param {string|null} name
 * @param {string} [actionType]
 */
export function iconSvg(name, actionType) {
  const key = (name && ICONS[name]) ? name : (ICON_BY_ACTION[actionType] ?? 'default');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] ?? ICONS.default}</svg>`;
}

/**
 * Markup dell'icona di un controllo: glifo incluso oppure file caricato.
 * @param {string|null} name valore del campo `icon` di deck.json
 * @param {string} [actionType]
 * @param {(name: string) => string} [customUrl] risolve "custom:x" nel suo URL
 */
export function iconMarkup(name, actionType, customUrl) {
  if (isEmojiIcon(name)) {
    return `<span class="icon-emoji" aria-hidden="true">${escapeText(name.slice(EMOJI_PREFIX.length))}</span>`;
  }
  if (isCustomIcon(name) && typeof customUrl === 'function') {
    const src = customUrl(name.slice(CUSTOM_PREFIX.length));
    return `<img class="icon-img" src="${src}" alt="" aria-hidden="true" loading="lazy" />`;
  }
  return iconSvg(name, actionType);
}
