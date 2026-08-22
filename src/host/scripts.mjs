/**
 * Cartella "scripts" di Wdeck: file che l'utente aggiunge (dal menu vicino
 * all'orologio) per poterli poi richiamare da un pulsante o uno slider. La
 * cartella sta accanto a deck.json (baseDir/scripts) e i suoi file sono
 * autorizzati d'ufficio dalla whitelist (vedi security/allowlist.mjs), quindi
 * questo modulo si limita a crearla ed elencarne il contenuto: nessuna
 * esecuzione avviene qui.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Estensioni mostrate come "script" nell'elenco (coerenti con l'allowlist). */
export const SCRIPT_EXTS = ['.ps1', '.bat', '.cmd', '.exe', '.lnk', '.vbs', '.py'];

/**
 * Crea la cartella degli script se manca e ne restituisce il percorso.
 * @param {string} baseDir cartella che contiene deck.json
 * @returns {string}
 */
export function ensureScriptsDir(baseDir) {
  const dir = path.join(baseDir, 'scripts');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* se non si puo' creare, listScripts restituira' semplicemente [] */
  }
  return dir;
}

/**
 * Elenca gli script presenti nella cartella, ordinati per nome.
 * @param {string} baseDir cartella che contiene deck.json
 * @returns {Array<{name: string, file: string, ext: string}>}
 */
export function listScripts(baseDir) {
  const dir = path.join(baseDir, 'scripts');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // cartella assente o non leggibile: nessuno script
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SCRIPT_EXTS.includes(ext)) continue;
    out.push({ name: entry.name, file: path.join(dir, entry.name), ext });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
