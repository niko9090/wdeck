/**
 * Registro predefinito: raccoglie tutti gli handler inclusi nella distribuzione.
 * Per aggiungere una nuova azione vedere docs/ADDING-ACTIONS.md.
 */

import { createRegistry } from '../registry.mjs';
import basic from './basic.mjs';
import input from './input.mjs';
import system from './system.mjs';
import sysinfo from './sysinfo.mjs';
import net from './net.mjs';
import flow from './flow.mjs';
import levels from './levels.mjs';
import windowHandlers from './window.mjs';
import power from './power.mjs';
import apps from './apps.mjs';
import productivity from './productivity.mjs';
import integrations from './integrations.mjs';
import services from './services.mjs';

/** Tutti gli handler inclusi, in ordine di caricamento. */
export const builtinHandlers = [
  ...basic,
  ...input,
  ...system,
  ...sysinfo,
  ...net,
  ...flow,
  ...levels,
  ...windowHandlers,
  ...power,
  ...apps,
  ...productivity,
  ...integrations,
  ...services
];

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
