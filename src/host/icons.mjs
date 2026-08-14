/**
 * Icone personalizzate caricate dall'utente.
 *
 * I file finiscono in `icons/` accanto a `deck.json` e vengono referenziati
 * come `"icon": "custom:nome"`. Non entrano dentro `deck.json`: una manciata
 * di PNG in base64 renderebbe il file di configurazione illeggibile e
 * impossibile da modificare a mano, che e' invece una delle cose che il
 * progetto promette.
 *
 * Sull'SVG serve prudenza: e' l'unico formato qui dentro che puo' contenere
 * codice. Viene accettato solo dopo essere passato da `sanitizeSvg()`, che
 * toglie script, gestori di eventi, riferimenti esterni e URL `javascript:`.
 * Se dopo la pulizia resta qualcosa di sospetto, il caricamento e' rifiutato:
 * meglio un'icona in meno che un'icona che esegue codice nel browser di chi
 * apre il deck.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Nome ammesso per un'icona personalizzata. */
export const ICON_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Prefisso usato nel campo `icon` di deck.json. */
export const CUSTOM_PREFIX = 'custom:';

/** Dimensione massima di una singola icona. */
export const MAX_ICON_BYTES = 192 * 1024;

/** Quante icone si possono tenere. */
export const MAX_ICONS = 64;

/** Formati accettati: estensione e tipo MIME. */
export const ICON_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
});

/**
 * Riconosce il formato dai byte iniziali, non dal nome del file.
 * Il tipo dichiarato dal client non fa testo: e' proprio cio' che un client
 * ostile mentirebbe.
 * @param {Buffer} buffer
 * @returns {'png'|'jpg'|'webp'|'gif'|'svg'|null}
 */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = buffer.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';

  // L'SVG e' testo: si riconosce dal primo tag utile, saltando BOM,
  // dichiarazione XML, commenti e DOCTYPE.
  const text = buffer.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^<(\?xml|!--|!DOCTYPE|svg)/i.test(text) && /<svg[\s>]/i.test(buffer.toString('utf8'))) return 'svg';
  return null;
}

/**
 * Ripulisce un SVG da tutto cio' che puo' eseguire codice o chiamare la rete.
 * @param {string} source
 * @returns {string}
 * @throws {Error} se il contenuto non e' recuperabile
 */
export function sanitizeSvg(source) {
  let svg = String(source);

  // 1. elementi che eseguono codice, caricano risorse o incorporano HTML
  svg = svg.replace(/<\s*(script|foreignObject|iframe|object|embed|animate|set|handler)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  svg = svg.replace(/<\s*(script|foreignObject|iframe|object|embed|animate|set|handler)\b[^>]*\/\s*>/gi, '');
  // 2. attributi gestore di evento (onload, onclick, ...)
  svg = svg.replace(/\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 3. URL che eseguono codice
  svg = svg.replace(/(?:javascript|vbscript)\s*:/gi, 'about:');
  // 4. riferimenti esterni: un'icona non deve chiamare la rete di nessuno
  svg = svg.replace(/\s(?:xlink:href|href|src)\s*=\s*(["'])\s*(?:https?:|\/\/)[^"']*\1/gi, '');
  // 5. entita' esterne (XXE)
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');

  if (!/<svg[\s>]/i.test(svg)) throw new Error('SVG non valido: manca l\'elemento <svg>');
  if (/<\s*script/i.test(svg) || /\son[a-z-]+\s*=/i.test(svg)) {
    throw new Error('SVG rifiutato: contiene codice che non e\' stato possibile rimuovere');
  }
  return svg;
}

/**
 * Estrae i byte da un data URL o da una stringa base64 grezza.
 * @param {string} value
 * @returns {Buffer}
 */
export function decodeImagePayload(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('contenuto dell\'icona mancante');
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  const base64 = match ? match[3] : value;
  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) throw new Error('contenuto dell\'icona illeggibile: base64 non valido');
  return buffer;
}

/**
 * Archivio delle icone personalizzate.
 * @param {{dir: string, logger?: object}} options
 */
export function createIconStore({ dir, logger = console }) {
  const root = path.resolve(dir);

  /** Elenco dei file di icona presenti, ordinato per nome. */
  function entries() {
    if (!fs.existsSync(root)) return [];
    const out = [];
    for (const file of fs.readdirSync(root)) {
      const ext = path.extname(file).slice(1).toLowerCase();
      const name = path.basename(file, path.extname(file));
      if (!Object.hasOwn(ICON_TYPES, ext) || !ICON_NAME_RE.test(name)) continue;
      let bytes = 0;
      try {
        bytes = fs.statSync(path.join(root, file)).size;
      } catch {
        continue;
      }
      out.push({ name, ext, contentType: ICON_TYPES[ext], bytes, ref: `${CUSTOM_PREFIX}${name}` });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Percorso del file di un'icona, o null se non esiste. */
  function resolve(name) {
    if (!ICON_NAME_RE.test(String(name ?? ''))) return null;
    for (const ext of Object.keys(ICON_TYPES)) {
      const file = path.join(root, `${name}.${ext}`);
      // Il nome e' gia' vincolato dalla regex: niente separatori, niente "..".
      if (fs.existsSync(file)) return { file, ext, contentType: ICON_TYPES[ext] };
    }
    return null;
  }

  return {
    dir: root,
    list: entries,
    resolve,

    /** Contenuto di un'icona, pronto per essere servito. */
    read(name) {
      const found = resolve(name);
      if (!found) return null;
      return { ...found, buffer: fs.readFileSync(found.file) };
    },

    /**
     * Salva un'icona caricata dall'utente.
     * @param {{name: string, content: string}} spec
     * @returns {{name: string, ext: string, bytes: number, ref: string}}
     */
    save({ name, content }) {
      const slug = String(name ?? '').trim().toLowerCase();
      if (!ICON_NAME_RE.test(slug)) {
        throw new Error('nome icona non valido: minuscole, cifre e trattini, massimo 32 caratteri');
      }

      const buffer = decodeImagePayload(content);
      if (buffer.length > MAX_ICON_BYTES) {
        throw new Error(`icona troppo grande: ${Math.round(buffer.length / 1024)} KB (massimo ${MAX_ICON_BYTES / 1024} KB)`);
      }

      const type = sniffImageType(buffer);
      if (!type) throw new Error(`formato non riconosciuto: sono ammessi ${Object.keys(ICON_TYPES).join(', ')}`);

      const existing = entries();
      if (!existing.some((e) => e.name === slug) && existing.length >= MAX_ICONS) {
        throw new Error(`troppe icone personalizzate (massimo ${MAX_ICONS}): eliminane qualcuna`);
      }

      const payload = type === 'svg' ? Buffer.from(sanitizeSvg(buffer.toString('utf8')), 'utf8') : buffer;

      fs.mkdirSync(root, { recursive: true });
      // Sostituire il formato di un'icona esistente lascerebbe due file con lo
      // stesso nome e estensioni diverse: il vecchio va tolto.
      const previous = resolve(slug);
      if (previous && previous.ext !== type) fs.rmSync(previous.file, { force: true });

      const file = path.join(root, `${slug}.${type}`);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, file);
      logger.info?.(`[wdeck] icona salvata: ${slug}.${type} (${payload.length} byte)`);

      return { name: slug, ext: type, bytes: payload.length, ref: `${CUSTOM_PREFIX}${slug}` };
    },

    /**
     * Elimina un'icona.
     * @param {string} name
     * @returns {boolean} true se esisteva
     */
    remove(name) {
      const found = resolve(name);
      if (!found) return false;
      fs.rmSync(found.file, { force: true });
      logger.info?.(`[wdeck] icona eliminata: ${name}`);
      return true;
    },

    /**
     * Controlli che usano un'icona: serve ad avvisare prima di eliminarla.
     * @param {object} deck
     * @param {string} name
     * @returns {string[]} id dei bottoni
     */
    usedBy(deck, name) {
      const ref = `${CUSTOM_PREFIX}${name}`;
      const out = [];
      for (const profile of deck?.profiles ?? []) {
        for (const page of profile.pages ?? []) {
          for (const button of page.buttons ?? []) {
            if (button.icon === ref) out.push(button.id);
          }
        }
      }
      return out;
    }
  };
}
