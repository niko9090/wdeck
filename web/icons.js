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

/**
 * Restituisce il markup SVG completo di un'icona.
 * @param {string|null} name
 * @param {string} [actionType]
 */
export function iconSvg(name, actionType) {
  const key = (name && ICONS[name]) ? name : (ICON_BY_ACTION[actionType] ?? 'default');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] ?? ICONS.default}</svg>`;
}
