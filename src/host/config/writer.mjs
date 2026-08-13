/**
 * Scrittura di deck.json dall'editor visuale.
 *
 * Il file di configurazione e' l'unica cosa che l'utente non puo' permettersi
 * di perdere: ogni salvataggio passa da una validazione completa, viene scritto
 * su un file temporaneo e poi rinominato (rename atomico), e la versione
 * precedente resta come backup. Un editor che rompe la configurazione mentre la
 * salva sarebbe peggio di nessun editor.
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatErrors, normalizeDeck, validateDeck } from './schema.mjs';

/** Quanti backup tenere prima di eliminare i piu' vecchi. */
const MAX_BACKUPS = 10;

/**
 * Fonde le modifiche in arrivo dall'editor con la configurazione su disco.
 *
 * L'editor non vede mai i segreti (token, PIN, allowExec): `publicDeck()` li
 * rimuove prima di spedire il deck al client. Se il salvataggio riscrivesse
 * l'oggetto per intero, il primo salvataggio cancellerebbe la sicurezza.
 * @param {object} current deck completo attualmente in uso
 * @param {object} incoming deck (o porzione) proveniente dall'editor
 * @returns {object} deck da validare e scrivere
 */
export function mergeDeckUpdate(current, incoming) {
  const merged = {
    ...current,
    ...incoming,
    settings: {
      ...current.settings,
      ...(incoming.settings ?? {}),
      // security non e' modificabile per questa via: ha endpoint dedicati.
      security: current.settings.security,
      ui: { ...current.settings.ui, ...(incoming.settings?.ui ?? {}) },
      integrations: { ...current.settings.integrations, ...(incoming.settings?.integrations ?? {}) }
    }
  };
  if (incoming.profiles) merged.profiles = incoming.profiles;
  return merged;
}

/**
 * Rimuove dal deck i campi che non appartengono al formato del file.
 * Il client rispedisce indietro l'oggetto normalizzato, che contiene valori
 * espansi dai default: riscriverli tutti gonfierebbe deck.json inutilmente.
 * @param {object} deck
 * @returns {object}
 */
export function compactDeck(deck) {
  return {
    version: deck.version,
    name: deck.name,
    defaultProfile: deck.defaultProfile,
    settings: deck.settings,
    profiles: deck.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      defaultPage: profile.defaultPage,
      pages: profile.pages.map((page) => ({
        id: page.id,
        name: page.name,
        rows: page.rows,
        cols: page.cols,
        buttons: page.buttons.map((button) => {
          const out = {
            id: button.id,
            label: button.label,
            row: button.row,
            col: button.col,
            action: button.action
          };
          if (button.kind && button.kind !== 'button') out.kind = button.kind;
          if (button.span && button.span !== 1) out.span = button.span;
          if (button.confirm) out.confirm = true;
          if (button.status === false) out.status = false;
          if (button.icon) out.icon = button.icon;
          if (button.color) out.color = button.color;
          if (button.textColor) out.textColor = button.textColor;
          if (button.holdAction) out.holdAction = button.holdAction;
          for (const key of ['min', 'max', 'step']) {
            if (button[key] !== undefined && button[key] !== null) out[key] = button[key];
          }
          return out;
        })
      }))
    }))
  };
}

/**
 * Salva il deck su disco dopo averlo validato.
 * @param {{configPath: string, current: object, incoming: object, actionTypes?: string[]}} spec
 * @returns {{ok: true, deck: object, backup: string|null} | {ok: false, errors: Array, message: string}}
 */
export function saveDeck({ configPath, current, incoming, actionTypes }) {
  const merged = compactDeck(mergeDeckUpdate(current, incoming));

  const validation = validateDeck(merged, actionTypes ? { actionTypes } : {});
  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors,
      message: `configurazione non valida, salvataggio annullato:\n${formatErrors(validation.errors)}`
    };
  }

  const backup = writeAtomic(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { ok: true, deck: normalizeDeck(merged), backup, warnings: validation.warnings };
}

/**
 * Scrive un file in modo atomico conservando una copia della versione attuale.
 * @param {string} filePath
 * @param {string} content
 * @returns {string|null} percorso del backup creato
 */
export function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  let backup = null;

  if (fs.existsSync(filePath)) {
    const backupDir = path.join(dir, '.wdeck-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(backupDir, `${path.basename(filePath)}.${stamp}.bak`);
    fs.copyFileSync(filePath, backup);
    pruneBackups(backupDir, path.basename(filePath));
  }

  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return backup;
}

/** Tiene solo gli ultimi MAX_BACKUPS backup di un file. */
function pruneBackups(backupDir, baseName) {
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(`${baseName}.`) && f.endsWith('.bak'))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(backupDir, stale));
    } catch {
      // un backup non eliminabile non deve far fallire un salvataggio riuscito
    }
  }
}
