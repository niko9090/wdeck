/**
 * Preset: bottoni pronti all'uso, pensati per chi parte da zero e non sa da
 * dove cominciare. Sceglierne uno riempie l'editor (etichetta, icona, azione e
 * parametri gia' a posto); da li' si puo' salvare com'e' o ritoccarlo.
 *
 * Ogni preset dichiara solo la "forma" del bottone. Il nome mostrato e quello
 * salvato arrivano da i18n (`preset.<id>`), cosi' la libreria parla la lingua
 * dell'interfaccia. Le azioni usano parametri validi per gli handler dell'host
 * (lo verifica test/presets.test.mjs). Le icone sono emoji: colorate e chiare.
 */

/** Categorie in cui la galleria raggruppa i preset (etichette da i18n). */
export const PRESET_CATEGORIES = [
  { id: 'audio', label: 'preset.cat.audio' },
  { id: 'sistema', label: 'preset.cat.sistema' },
  { id: 'finestre', label: 'preset.cat.finestre' },
  { id: 'modifica', label: 'preset.cat.modifica' },
  { id: 'web', label: 'preset.cat.web' }
];

export const PRESETS = [
  // --- audio e media ---
  { id: 'mute', category: 'audio', icon: 'emoji:🔇', action: { type: 'media', params: { key: 'mute' } } },
  { id: 'playpause', category: 'audio', icon: 'emoji:⏯️', action: { type: 'media', params: { key: 'playpause' } } },
  { id: 'next', category: 'audio', icon: 'emoji:⏭️', action: { type: 'media', params: { key: 'next' } } },
  { id: 'prev', category: 'audio', icon: 'emoji:⏮️', action: { type: 'media', params: { key: 'prev' } } },
  { id: 'stop', category: 'audio', icon: 'emoji:⏹️', action: { type: 'media', params: { key: 'stop' } } },
  { id: 'volup', category: 'audio', icon: 'emoji:🔊', action: { type: 'media', params: { key: 'volumeup' } } },
  { id: 'voldown', category: 'audio', icon: 'emoji:🔉', action: { type: 'media', params: { key: 'volumedown' } } },

  // --- sistema ---
  { id: 'lock', category: 'sistema', icon: 'emoji:🔒', action: { type: 'power', params: { command: 'lock' } } },
  { id: 'sleep', category: 'sistema', icon: 'emoji:🌙', action: { type: 'power', params: { command: 'sleep' } } },
  { id: 'screenshot', category: 'sistema', icon: 'emoji:📷', action: { type: 'screenshot', params: { mode: 'screen', clipboard: true } } },

  // --- finestre e desktop ---
  { id: 'showdesktop', category: 'finestre', icon: 'emoji:🖥️', action: { type: 'hotkey', params: { keys: 'win+d' } } },
  { id: 'switchapp', category: 'finestre', icon: 'emoji:🔀', action: { type: 'hotkey', params: { keys: 'alt+tab' } } },
  { id: 'taskview', category: 'finestre', icon: 'emoji:🗂️', action: { type: 'hotkey', params: { keys: 'win+tab' } } },
  { id: 'snapleft', category: 'finestre', icon: 'emoji:⬅️', action: { type: 'hotkey', params: { keys: 'win+left' } } },
  { id: 'snapright', category: 'finestre', icon: 'emoji:➡️', action: { type: 'hotkey', params: { keys: 'win+right' } } },

  // --- modifica (scorciatoie universali) ---
  { id: 'copy', category: 'modifica', icon: 'emoji:📋', action: { type: 'hotkey', params: { keys: 'ctrl+c' } } },
  { id: 'paste', category: 'modifica', icon: 'emoji:📥', action: { type: 'hotkey', params: { keys: 'ctrl+v' } } },
  { id: 'cut', category: 'modifica', icon: 'emoji:✂️', action: { type: 'hotkey', params: { keys: 'ctrl+x' } } },
  { id: 'undo', category: 'modifica', icon: 'emoji:↩️', action: { type: 'hotkey', params: { keys: 'ctrl+z' } } },
  { id: 'redo', category: 'modifica', icon: 'emoji:↪️', action: { type: 'hotkey', params: { keys: 'ctrl+y' } } },
  { id: 'save', category: 'modifica', icon: 'emoji:💾', action: { type: 'hotkey', params: { keys: 'ctrl+s' } } },
  { id: 'selectall', category: 'modifica', icon: 'emoji:🔲', action: { type: 'hotkey', params: { keys: 'ctrl+a' } } },
  { id: 'find', category: 'modifica', icon: 'emoji:🔍', action: { type: 'hotkey', params: { keys: 'ctrl+f' } } },

  // --- web ---
  { id: 'youtube', category: 'web', icon: 'emoji:📺', action: { type: 'url', params: { url: 'https://www.youtube.com' } } },
  { id: 'google', category: 'web', icon: 'emoji:🌐', action: { type: 'url', params: { url: 'https://www.google.com' } } },
  { id: 'gmail', category: 'web', icon: 'emoji:📧', action: { type: 'url', params: { url: 'https://mail.google.com' } } }
];
