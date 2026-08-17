/**
 * Composizione dell'host: dettagli che non richiedono un server vero.
 *
 * Il percorso del log di audit e' configurabile ma non deve poter uscire dalla
 * cartella dei dati: config e' localmente fidato, ma un ".." o un percorso
 * assoluto per errore scriverebbe il registro altrove sul disco.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveAuditFile } from '../src/host/index.mjs';

const base = path.resolve('C:\\dati\\wdeck');

test('audit: un percorso relativo resta dentro baseDir', () => {
  assert.equal(resolveAuditFile(base, 'log/audit.log'), path.join(base, 'log', 'audit.log'));
});

test('audit: senza percorso si usa il default dentro baseDir', () => {
  assert.equal(resolveAuditFile(base, undefined), path.join(base, 'wdeck-audit.log'));
});

test('audit: un percorso con ".." fuori da baseDir viene rifiutato', () => {
  assert.equal(resolveAuditFile(base, '..\\..\\altrove.log'), path.join(base, 'wdeck-audit.log'));
  assert.equal(resolveAuditFile(base, '../fuori.log'), path.join(base, 'wdeck-audit.log'));
});

test('audit: un percorso assoluto fuori da baseDir viene rifiutato', () => {
  assert.equal(resolveAuditFile(base, path.resolve('C:\\Windows\\System32\\x.log')), path.join(base, 'wdeck-audit.log'));
});
