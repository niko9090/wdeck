/**
 * Whitelist dei comandi eseguibili.
 *
 * Regola di base: se `allowExec` e' vuoto NON viene eseguito nulla.
 * I pattern supportano i glob `*` (un segmento) e `**` (piu' segmenti); i percorsi
 * relativi sono risolti rispetto alla root del progetto.
 */

import fs from 'node:fs';
import path from 'node:path';

const CASE_INSENSITIVE = process.platform === 'win32';

/** Normalizza un percorso per il confronto (separatori e maiuscole). */
export function normalizeForCompare(p) {
  const normalized = path.normalize(p).replace(/\\/g, '/');
  return CASE_INSENSITIVE ? normalized.toLowerCase() : normalized;
}

/**
 * Converte un pattern glob in espressione regolare ancorata.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const normalized = normalizeForCompare(pattern);
  let out = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (normalized[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Verifica se un eseguibile/script puo' essere lanciato.
 * @param {string} target percorso richiesto (assoluto o relativo alla root)
 * @param {{allowExec?: string[], allowedExtensions?: string[], baseDir?: string}} policy
 * @returns {{allowed: boolean, reason?: string, resolved: string}}
 */
export function checkExecutable(target, policy = {}) {
  const baseDir = policy.baseDir ?? process.cwd();
  const allowExec = policy.allowExec ?? [];
  const allowedExtensions = policy.allowedExtensions ?? [];

  if (typeof target !== 'string' || target.trim() === '') {
    return { allowed: false, reason: 'percorso mancante', resolved: '' };
  }

  const resolved = path.isAbsolute(target) ? path.normalize(target) : path.resolve(baseDir, target);

  const ext = path.extname(resolved).toLowerCase();
  if (allowedExtensions.length > 0) {
    const allowedExt = allowedExtensions.map((e) => e.toLowerCase());
    if (!allowedExt.includes(ext)) {
      return {
        allowed: false,
        reason: `estensione "${ext || '(nessuna)'}" non ammessa (ammesse: ${allowedExt.join(', ')})`,
        resolved
      };
    }
  }

  if (allowExec.length === 0) {
    return {
      allowed: false,
      reason: 'la whitelist settings.security.allowExec e\' vuota: nessun eseguibile e\' autorizzato',
      resolved
    };
  }

  // Il confronto va fatto sulla destinazione reale: un symlink (o una giunzione
  // su Windows) dentro una cartella consentita potrebbe puntare a un binario
  // vietato, e la sola normalizzazione della stringa non lo scoprirebbe. Se il
  // file non esiste ancora, `realpathSync` fallisce: si ripiega sul percorso
  // normalizzato.
  let realTarget = resolved;
  try {
    realTarget = fs.realpathSync(resolved);
  } catch {
    realTarget = resolved;
  }

  const candidate = normalizeForCompare(realTarget);
  for (const pattern of allowExec) {
    const absPattern = path.isAbsolute(pattern) ? pattern : path.resolve(baseDir, pattern);
    if (globToRegExp(absPattern).test(candidate)) {
      return { allowed: true, resolved };
    }
  }

  return {
    allowed: false,
    reason: `"${resolved}" non compare in settings.security.allowExec`,
    resolved
  };
}

/**
 * Verifica se un URL puo' essere aperto.
 * @param {string} url
 * @param {string[]} allowUrlSchemes
 * @returns {{allowed: boolean, reason?: string, scheme?: string}}
 */
export function checkUrl(url, allowUrlSchemes = []) {
  if (typeof url !== 'string' || url.trim() === '') {
    return { allowed: false, reason: 'url mancante' };
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  if (!match) return { allowed: false, reason: `url senza schema: "${url}"` };
  const scheme = match[1].toLowerCase();
  const allowed = allowUrlSchemes.map((s) => s.toLowerCase());
  if (!allowed.includes(scheme)) {
    return { allowed: false, reason: `schema "${scheme}" non ammesso (ammessi: ${allowed.join(', ') || 'nessuno'})`, scheme };
  }
  return { allowed: true, scheme };
}
