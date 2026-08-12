/**
 * Registro predefinito: raccoglie tutti gli handler inclusi nella distribuzione.
 * Per aggiungere una nuova azione vedere docs/ADDING-ACTIONS.md.
 */

import { createRegistry } from '../registry.mjs';
import basic from './basic.mjs';
import input from './input.mjs';
import system from './system.mjs';
import net from './net.mjs';
import flow from './flow.mjs';

/** Tutti gli handler inclusi, in ordine di caricamento. */
export const builtinHandlers = [...basic, ...input, ...system, ...net, ...flow];

/**
 * Crea un registro popolato con gli handler predefiniti.
 * @param {{extra?: object[]}} [options] handler aggiuntivi (plugin)
 * @returns {import('../registry.mjs').ActionRegistry}
 */
export function createDefaultRegistry(options = {}) {
  const registry = createRegistry();
  for (const handler of builtinHandlers) registry.register(handler);
  for (const handler of options.extra ?? []) registry.register(handler, { override: true });
  return registry;
}

export { createRegistry };
