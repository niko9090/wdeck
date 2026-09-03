/**
 * Azioni "a livello": volume master, volume microfono, luminosita' schermo.
 *
 * A differenza dei tasti media, queste azioni leggono e scrivono un valore
 * assoluto: sono quelle che alimentano gli slider del client. Ogni handler
 * dichiara `control: 'slider'` perche' l'editor sappia offrirle come cursore
 * invece che come pulsante, e restituisce sempre il livello risultante cosi'
 * che il client possa allineare la posizione del cursore alla realta'.
 */

import { readAudioLevel, readBrightnessLevel } from '../../platform/readers.mjs';
import { AUDIO_PLATFORMS, adjustVolume, readVolume, setMute, setVolume } from '../../platform/audio.mjs';
import {
  buildAdjustBrightnessScript,
  buildReadBrightnessScript,
  buildSetBrightnessScript,
  clampPercent,
  runLevelScript
} from '../../platform/levels.mjs';
import { withLevelServer } from '../../platform/levelserver.mjs';

/** Legge il modo in cui l'azione e' stata invocata: valore assoluto, delta o lettura. */
function resolveMode(params) {
  if (params?.value !== undefined) return { mode: 'set', amount: clampPercent(params.value) };
  if (params?.delta !== undefined) return { mode: 'adjust', amount: Number(params.delta) };
  if (params?.set !== undefined) return { mode: 'set', amount: clampPercent(params.set) };
  return { mode: 'read', amount: null };
}

function validateLevelParams(params) {
  if (params?.value !== undefined && !Number.isFinite(Number(params.value))) {
    throw new Error('parametro "value" non valido: atteso numero 0..100');
  }
  if (params?.set !== undefined && !Number.isFinite(Number(params.set))) {
    throw new Error('parametro "set" non valido: atteso numero 0..100');
  }
  if (params?.delta !== undefined) {
    const d = Number(params.delta);
    if (!Number.isFinite(d) || d < -100 || d > 100) {
      throw new Error('parametro "delta" non valido: atteso numero fra -100 e 100');
    }
  }
}

/**
 * Costruisce un handler volume per il canale indicato: la logica di altoparlanti
 * e microfono e' identica, cambia solo il dispositivo Core Audio interrogato.
 * @param {{type: string, target: 'speaker'|'mic', title: string, description: string, category: string}} spec
 */
function makeVolumeAction({ type, target, title, description, category }) {
  return {
    type,
    title,
    description,
    platforms: [...AUDIO_PLATFORMS],
    category,
    control: 'slider',
    paramsHelp: {
      value: 'livello assoluto 0..100 (inviato dallo slider)',
      set: 'livello assoluto 0..100 (alternativa a value, per un pulsante fisso)',
      delta: 'variazione relativa -100..100, es. -5 per abbassare',
      mute: 'true | false | "toggle"'
    },
    fields: [
      { key: 'value', label: 'Livello', type: 'number', help: 'livello assoluto 0..100 (inviato dallo slider)', min: 0, max: 100, step: 1, default: 50 },
      { key: 'set', label: 'Livello fisso', type: 'number', help: 'livello assoluto 0..100 (alternativa a value, per un pulsante fisso)', min: 0, max: 100, step: 1 },
      { key: 'delta', label: 'Variazione', type: 'number', help: 'variazione relativa -100..100, es. -5 per abbassare', min: -100, max: 100, step: 1 },
      {
        key: 'mute',
        label: 'Muto',
        type: 'select',
        help: 'accendi, spegni o alterna il muto',
        options: [
          { value: true, label: 'Accendi' },
          { value: false, label: 'Spegni' },
          { value: 'toggle', label: 'Alterna' }
        ]
      }
    ],
    validate(params) {
      validateLevelParams(params);
      if (params?.mute !== undefined && ![true, false, 'toggle'].includes(params.mute)) {
        throw new Error('parametro "mute" non valido: atteso true, false o "toggle"');
      }
    },
    describe(params) {
      if (params?.mute !== undefined) return `${title}: muto = ${params.mute}`;
      const { mode, amount } = resolveMode(params);
      if (mode === 'set') return `${title} al ${amount}%`;
      if (mode === 'adjust') return `${title} ${amount > 0 ? '+' : ''}${amount}%`;
      return `${title}: lettura`;
    },
    async run(params, ctx) {
      if (params?.mute !== undefined) {
        if (ctx.dryRun) return { ok: true, simulated: true, detail: `imposterebbe muto=${params.mute} su ${target}` };
        const out = await setMute(target, params.mute);
        return { ok: true, detail: `${title}: ${out.muted ? 'muto' : 'audio attivo'} (${out.volume}%)`, level: out.volume, muted: out.muted };
      }

      const { mode, amount } = resolveMode(params);
      if (ctx.dryRun) {
        const what = mode === 'read' ? 'leggerebbe il livello' : `porterebbe il livello a ${mode === 'set' ? `${amount}%` : `${amount > 0 ? '+' : ''}${amount}%`}`;
        return { ok: true, simulated: true, detail: `${title}: ${what}` };
      }

      let out;
      if (mode === 'set') out = await setVolume(target, amount);
      else if (mode === 'adjust') out = await adjustVolume(target, amount);
      else out = await readVolume(target);

      return {
        ok: true,
        detail: `${title}: ${out.volume}%${out.muted ? ' (muto)' : ''}`,
        level: out.volume,
        muted: out.muted
      };
    },

    /**
     * Stato reale del canale. Un bottone configurato con "mute" e' un
     * interruttore, e come tale riporta acceso/spento; gli altri (cursori,
     * +/-) riportano soltanto il livello.
     */
    async readState(params, ctx) {
      const out = await readAudioLevel(ctx, target);
      const isToggle = params?.mute !== undefined;
      return {
        on: isToggle ? out.muted === true : null,
        level: out.volume ?? null,
        text: isToggle && out.muted ? 'muto' : null
      };
    }
  };
}

export const volumeAction = makeVolumeAction({
  type: 'volume',
  target: 'speaker',
  title: 'Volume di sistema',
  description: 'Legge o imposta il volume master in percentuale. Usata dagli slider del client; '
    + 'con "delta" funziona anche come pulsante +/-, con "mute" come interruttore.',
  category: 'media'
});

export const micAction = makeVolumeAction({
  type: 'mic',
  target: 'mic',
  title: 'Microfono',
  description: 'Legge o imposta il volume del microfono predefinito, oppure lo silenzia. '
    + 'Il classico "push to mute" per riunioni e dirette.',
  category: 'media'
});

export const brightnessAction = {
  type: 'brightness',
  title: 'Luminosita\' schermo',
  description: 'Legge o imposta la luminosita\' in percentuale. Prova nell\'ordine WMI (pannelli dei '
    + 'portatili), DDC/CI (monitor esterni) e infine l\'attenuazione software via gamma ramp.',
  platforms: ['win32'],
  category: 'system',
  control: 'slider',
  paramsHelp: {
    value: 'livello assoluto 0..100 (inviato dallo slider)',
    set: 'livello assoluto 0..100',
    delta: 'variazione relativa -100..100'
  },
  fields: [
    { key: 'value', label: 'Livello', type: 'number', help: 'livello assoluto 0..100 (inviato dallo slider)', min: 0, max: 100, step: 1, default: 50 },
    { key: 'set', label: 'Livello fisso', type: 'number', help: 'livello assoluto 0..100', min: 0, max: 100, step: 1 },
    { key: 'delta', label: 'Variazione', type: 'number', help: 'variazione relativa -100..100', min: -100, max: 100, step: 1 }
  ],
  validate: validateLevelParams,
  describe(params) {
    const { mode, amount } = resolveMode(params);
    if (mode === 'set') return `luminosita' al ${amount}%`;
    if (mode === 'adjust') return `luminosita' ${amount > 0 ? '+' : ''}${amount}%`;
    return 'luminosita\': lettura';
  },
  async run(params, ctx) {
    const { mode, amount } = resolveMode(params);
    if (ctx.dryRun) {
      const what = mode === 'read' ? 'leggerebbe la luminosita\'' : `porterebbe la luminosita' a ${amount}%`;
      return { ok: true, simulated: true, detail: what };
    }

    let script;
    let comando;
    if (mode === 'set') { script = buildSetBrightnessScript(amount); comando = `BS ${amount}`; }
    else if (mode === 'adjust') { script = buildAdjustBrightnessScript(amount); comando = `BA ${amount}`; }
    else { script = buildReadBrightnessScript(); comando = 'BR'; }

    // Prima il processo persistente (millisecondi); se non c'e', lo script
    // singolo. La compilazione C# del primo avvio e' lenta: il timeout va oltre
    // i 12s di default, altrimenti la prima pressione fallisce sempre.
    let out;
    try {
      out = await withLevelServer(comando, () => runLevelScript(script, { what: 'luminosita\'', timeoutMs: 30000 }));
    } catch (err) {
      // Nessuno dei metodi (WMI, DDC/CI, gamma) ha funzionato: quasi sempre e'
      // uno schermo che non si regola via software (PC fisso senza DDC/CI) o
      // l'uso da Desktop Remoto, dove non c'e' un monitor fisico raggiungibile.
      if (/nessun metodo|luminosita' non riuscit/i.test(err.message)) {
        throw new Error('Questo schermo non consente di regolare la luminosita\' via software: '
          + 'capita sui PC fissi con monitor senza DDC/CI e quando si usa il PC da Desktop Remoto.');
      }
      throw err;
    }
    const via = out.mode === 'gamma' ? ' (attenuazione software)' : '';
    return { ok: true, detail: `luminosita': ${out.brightness}%${via}`, level: out.brightness, mode: out.mode };
  },

  /** La luminosita' non ha un acceso/spento: riporta solo il livello reale. */
  async readState(params, ctx) {
    const out = await readBrightnessLevel(ctx);
    return { on: null, level: out.brightness ?? null, text: null };
  }
};

export default [volumeAction, micAction, brightnessAction];
