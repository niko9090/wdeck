/**
 * Operazioni di sicurezza eseguibili **senza avviare l'host**.
 *
 * Servono da riga di comando: se il token e' stato perso, o un telefono e'
 * stato rubato, l'host potrebbe non essere in esecuzione - e comunque non si
 * vorrebbe doverlo lasciare acceso e raggiungibile per poterlo mettere in
 * sicurezza. Qui si lavora direttamente sul file di configurazione, con la
 * stessa validazione e la stessa scrittura atomica dell'editor.
 */

import { formatErrors, validateDeck } from '../config/schema.mjs';
import { loadDeckFile } from '../config/loader.mjs';
import { writeAtomic } from '../config/writer.mjs';
import { generateToken, hashToken, isExpired, normalizeDevice } from './auth.mjs';

/**
 * Legge il file, applica una modifica al blocco sicurezza e riscrive.
 * @param {string} configFile
 * @param {(security: object, deck: object) => object|null} mutate
 *   restituisce il nuovo blocco security, oppure null per non scrivere nulla
 * @returns {{ok: boolean, message?: string, deck?: object}}
 */
function updateSecurity(configFile, mutate) {
  let raw;
  try {
    ({ raw } = loadDeckFile(configFile));
  } catch (err) {
    return { ok: false, message: err.message };
  }

  const security = { ...(raw.settings?.security ?? {}) };
  const next = mutate(security, raw);
  if (next === null) return { ok: true, deck: raw };

  const updated = { ...raw, settings: { ...(raw.settings ?? {}), security: next } };
  const validation = validateDeck(updated);
  if (!validation.valid) {
    return { ok: false, message: `configurazione non valida, nulla e' stato scritto:\n${formatErrors(validation.errors)}` };
  }

  writeAtomic(configFile, `${JSON.stringify(updated, null, 2)}\n`);
  return { ok: true, deck: updated };
}

/**
 * Rigenera il token principale scrivendolo nel file.
 * @param {string} configFile
 * @param {{revokeDevices?: boolean}} [options]
 * @returns {{ok: boolean, token?: string, message?: string, revokedDevices?: number}}
 */
export function rotateToken(configFile, { revokeDevices = false } = {}) {
  const token = generateToken();
  let revoked = 0;
  const result = updateSecurity(configFile, (security) => {
    revoked = Array.isArray(security.devices) ? security.devices.length : 0;
    return {
      ...security,
      token,
      ...(revokeDevices ? { devices: [] } : {})
    };
  });
  if (!result.ok) return result;
  return { ok: true, token, revokedDevices: revokeDevices ? revoked : 0 };
}

/**
 * Elenca i dispositivi accoppiati.
 * @param {string} configFile
 * @param {{now?: number}} [options]
 * @returns {{ok: boolean, devices?: object[], message?: string}}
 */
export function listDevices(configFile, { now = Date.now() } = {}) {
  let raw;
  try {
    ({ raw } = loadDeckFile(configFile));
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const devices = (raw.settings?.security?.devices ?? [])
    .map(normalizeDevice)
    .filter(Boolean)
    .map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
      expired: isExpired(d, now)
    }));
  return { ok: true, devices };
}

/**
 * Revoca un dispositivo per id.
 * @param {string} configFile
 * @param {string} id
 * @returns {{ok: boolean, revoked?: string, message?: string}}
 */
export function revokeDevice(configFile, id) {
  let trovato = false;
  const result = updateSecurity(configFile, (security) => {
    const devices = (security.devices ?? []).filter((d) => {
      const match = d?.id === id;
      if (match) trovato = true;
      return !match;
    });
    return { ...security, devices };
  });
  if (!result.ok) return result;
  if (!trovato) return { ok: false, message: `dispositivo sconosciuto: "${id}"` };
  return { ok: true, revoked: id };
}

/**
 * Crea un token per un dispositivo senza passare dal pairing.
 * Utile per un ESP32, che il PIN non sa digitarlo.
 * @param {string} configFile
 * @param {{name?: string, days?: number|null}} [spec]
 * @returns {{ok: boolean, device?: object, token?: string, message?: string}}
 */
export function addDevice(configFile, { name = 'dispositivo', days = null } = {}) {
  const token = generateToken();
  const at = Date.now();
  const device = {
    id: `d-${hashToken(token).slice(0, 10)}`,
    name: String(name).slice(0, 64),
    hash: hashToken(token),
    createdAt: at,
    ...(Number.isFinite(days) && days > 0 ? { expiresAt: at + days * 86400000 } : {})
  };

  const result = updateSecurity(configFile, (security) => ({
    ...security,
    devices: [...(security.devices ?? []), device]
  }));
  if (!result.ok) return result;
  return { ok: true, token, device: { id: device.id, name: device.name, expiresAt: device.expiresAt ?? null } };
}

/**
 * Toglie dal file i dispositivi scaduti.
 * @param {string} configFile
 * @param {{now?: number}} [options]
 * @returns {{ok: boolean, removed?: string[], message?: string}}
 */
export function pruneExpiredDevices(configFile, { now = Date.now() } = {}) {
  const removed = [];
  const result = updateSecurity(configFile, (security) => {
    const devices = (security.devices ?? []).filter((raw) => {
      const device = normalizeDevice(raw);
      if (device && isExpired(device, now)) {
        removed.push(device.id);
        return false;
      }
      return true;
    });
    return { ...security, devices };
  });
  if (!result.ok) return result;
  return { ok: true, removed };
}
