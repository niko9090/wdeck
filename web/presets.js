/**
 * Preset: bottoni pronti all'uso, pensati per chi parte da zero e non sa da
 * dove cominciare. Sceglierne uno riempie l'editor (etichetta, icona, azione e
 * parametri gia' a posto); da li' si puo' salvare com'e' o ritoccarlo.
 *
 * Ogni preset dichiara solo la "forma" del bottone. Il nome mostrato e quello
 * salvato arrivano da i18n (`preset.<id>`), cosi' la libreria parla la lingua
 * dell'interfaccia. Le azioni usano parametri validi per gli handler dell'host.
 */

export const PRESETS = [
  { id: 'mute', icon: 'mute', action: { type: 'media', params: { key: 'mute' } } },
  { id: 'playpause', icon: 'play', action: { type: 'media', params: { key: 'playpause' } } },
  { id: 'next', icon: 'next', action: { type: 'media', params: { key: 'next' } } },
  { id: 'prev', icon: 'prev', action: { type: 'media', params: { key: 'prev' } } },
  { id: 'volup', icon: 'volume-up', action: { type: 'media', params: { key: 'volumeup' } } },
  { id: 'voldown', icon: 'volume-down', action: { type: 'media', params: { key: 'volumedown' } } },
  { id: 'screenshot', icon: 'camera', action: { type: 'screenshot', params: { mode: 'screen', clipboard: true } } },
  { id: 'lock', icon: 'power', action: { type: 'power', params: { command: 'lock' } } },
  { id: 'copy', icon: 'keyboard', action: { type: 'hotkey', params: { keys: 'ctrl+c' } } },
  { id: 'paste', icon: 'keyboard', action: { type: 'hotkey', params: { keys: 'ctrl+v' } } }
];
