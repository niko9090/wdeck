/**
 * Validazione e normalizzazione dello schema di deck.json.
 *
 * Implementazione a mano (nessuna dipendenza esterna): oltre ai controlli di tipo
 * esegue anche i controlli semantici che un JSON Schema puro non copre
 * (id univoci, celle non sovrapposte, target di navigazione esistenti).
 */

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PIN_RE = /^[0-9]{4,12}$/;

export const LIMITS = Object.freeze({
  maxRows: 8,
  maxCols: 12,
  maxLabel: 48,
  minTokenLength: 8,
  maxButtonsPerPage: 96
});

export const DEFAULT_SETTINGS = Object.freeze({
  server: { host: '0.0.0.0', port: 8899, publicName: 'Wdeck Host' },
  security: {
    requireToken: true,
    token: '',
    pin: '',
    dryRun: false,
    allowUrlSchemes: ['http', 'https'],
    allowedExtensions: ['.exe', '.bat', '.cmd', '.ps1', '.py'],
    allowExec: [],
    maxSequenceSteps: 32
  },
  ui: { theme: 'dark', accent: '#4c8dff', showLabels: true },
  tray: { enabled: true },
  updates: { check: true, repository: 'niko9090/wdeck' },
  integrations: {}
});

/** Tipi di controllo che un elemento della griglia puo' assumere. */
export const CONTROL_KINDS = ['button', 'slider'];

class Ctx {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  err(path, message) {
    this.errors.push({ path, message });
    return false;
  }

  warn(path, message) {
    this.warnings.push({ path, message });
  }
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkString(ctx, path, value, { required = false, max = 0, pattern = null, label = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) ctx.err(path, 'campo obbligatorio mancante');
    return false;
  }
  if (typeof value !== 'string') return ctx.err(path, `atteso string, ricevuto ${typeof value}`);
  if (max && value.length > max) return ctx.err(path, `stringa troppo lunga (max ${max})`);
  if (pattern && !pattern.test(value)) return ctx.err(path, `formato non valido${label ? ` (${label})` : ''}`);
  return true;
}

function checkInt(ctx, path, value, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null) {
    if (required) ctx.err(path, 'campo obbligatorio mancante');
    return false;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return ctx.err(path, `atteso intero, ricevuto ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  if (value < min || value > max) return ctx.err(path, `valore fuori intervallo [${min}, ${max}]`);
  return true;
}

function checkBool(ctx, path, value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') return ctx.err(path, `atteso boolean, ricevuto ${typeof value}`);
  return true;
}

function checkStringArray(ctx, path, value, { itemPattern = null } = {}) {
  if (value === undefined) return false;
  if (!Array.isArray(value)) return ctx.err(path, 'atteso array di stringhe');
  value.forEach((item, i) => {
    if (typeof item !== 'string') ctx.err(`${path}[${i}]`, 'atteso string');
    else if (itemPattern && !itemPattern.test(item)) ctx.err(`${path}[${i}]`, 'formato non valido');
  });
  return true;
}

function validateSettings(ctx, settings) {
  if (settings === undefined) return;
  if (!isPlainObject(settings)) {
    ctx.err('settings', 'atteso oggetto');
    return;
  }

  const { server, security, ui, tray, updates, integrations } = settings;

  if (tray !== undefined) {
    if (!isPlainObject(tray)) ctx.err('settings.tray', 'atteso oggetto');
    else checkBool(ctx, 'settings.tray.enabled', tray.enabled);
  }

  if (updates !== undefined) {
    if (!isPlainObject(updates)) ctx.err('settings.updates', 'atteso oggetto');
    else {
      checkBool(ctx, 'settings.updates.check', updates.check);
      if (updates.repository !== undefined) {
        checkString(ctx, 'settings.updates.repository', updates.repository, {
          pattern: /^[\w.-]+\/[\w.-]+$/,
          label: 'formato utente/repository'
        });
      }
    }
  }

  // Le integrazioni sono coppie nome -> configurazione libera: ogni handler
  // valida i propri campi, qui si controlla solo la forma generale.
  if (integrations !== undefined) {
    if (!isPlainObject(integrations)) ctx.err('settings.integrations', 'atteso oggetto');
    else {
      for (const [name, value] of Object.entries(integrations)) {
        if (!isPlainObject(value)) ctx.err(`settings.integrations.${name}`, 'atteso oggetto');
      }
    }
  }

  if (server !== undefined) {
    if (!isPlainObject(server)) ctx.err('settings.server', 'atteso oggetto');
    else {
      checkString(ctx, 'settings.server.host', server.host);
      if (server.port !== undefined) checkInt(ctx, 'settings.server.port', server.port, { min: 1, max: 65535 });
      checkString(ctx, 'settings.server.publicName', server.publicName, { max: 64 });
    }
  }

  if (security !== undefined) {
    if (!isPlainObject(security)) ctx.err('settings.security', 'atteso oggetto');
    else {
      checkBool(ctx, 'settings.security.requireToken', security.requireToken);
      checkBool(ctx, 'settings.security.dryRun', security.dryRun);
      if (security.token !== undefined) {
        if (checkString(ctx, 'settings.security.token', security.token) && security.token.length > 0
          && security.token.length < LIMITS.minTokenLength) {
          ctx.err('settings.security.token', `token troppo corto (min ${LIMITS.minTokenLength} caratteri)`);
        }
      }
      if (security.pin !== undefined && security.pin !== '') {
        checkString(ctx, 'settings.security.pin', security.pin, { pattern: PIN_RE, label: '4-12 cifre' });
      }
      checkStringArray(ctx, 'settings.security.allowUrlSchemes', security.allowUrlSchemes);
      checkStringArray(ctx, 'settings.security.allowedExtensions', security.allowedExtensions, { itemPattern: /^\.[a-z0-9]+$/i });
      checkStringArray(ctx, 'settings.security.allowExec', security.allowExec);
      if (security.maxSequenceSteps !== undefined) {
        checkInt(ctx, 'settings.security.maxSequenceSteps', security.maxSequenceSteps, { min: 1, max: 256 });
      }
      if (security.requireToken !== false && (security.token === undefined || security.token === '')) {
        ctx.warn('settings.security.token', "nessun token configurato: ne verra' generato uno automaticamente all'avvio");
      }
    }
  }

  if (ui !== undefined) {
    if (!isPlainObject(ui)) ctx.err('settings.ui', 'atteso oggetto');
    else {
      if (ui.theme !== undefined && !['dark', 'light', 'auto'].includes(ui.theme)) {
        ctx.err('settings.ui.theme', 'valore ammesso: dark | light | auto');
      }
      if (ui.accent !== undefined) checkString(ctx, 'settings.ui.accent', ui.accent, { pattern: HEX_COLOR_RE, label: 'colore hex' });
      checkBool(ctx, 'settings.ui.showLabels', ui.showLabels);
    }
  }
}

function validateAction(ctx, path, action, actionTypes, depth = 0) {
  if (!isPlainObject(action)) {
    ctx.err(path, 'atteso oggetto azione');
    return;
  }
  if (!checkString(ctx, `${path}.type`, action.type, { required: true, max: 32 })) return;
  if (actionTypes && actionTypes.length > 0 && !actionTypes.includes(action.type)) {
    ctx.err(`${path}.type`, `tipo azione sconosciuto: "${action.type}"`);
  }
  if (action.params !== undefined && !isPlainObject(action.params)) {
    ctx.err(`${path}.params`, 'atteso oggetto');
  }
  if (action.type === 'sequence') {
    const steps = action.params?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      ctx.err(`${path}.params.steps`, 'la sequenza richiede un array "steps" non vuoto');
    } else if (depth >= 3) {
      ctx.err(`${path}.params.steps`, 'annidamento di sequenze troppo profondo (max 3)');
    } else {
      steps.forEach((step, i) => validateAction(ctx, `${path}.params.steps[${i}]`, step, actionTypes, depth + 1));
    }
  }
}

function validateButton(ctx, path, button, page, seen, actionTypes) {
  if (!isPlainObject(button)) {
    ctx.err(path, 'atteso oggetto bottone');
    return;
  }
  checkString(ctx, `${path}.id`, button.id, { required: true, pattern: SLUG_RE, label: 'slug minuscolo' });
  checkString(ctx, `${path}.label`, button.label, { max: LIMITS.maxLabel });
  checkInt(ctx, `${path}.row`, button.row, { required: true, min: 0, max: LIMITS.maxRows - 1 });
  checkInt(ctx, `${path}.col`, button.col, { required: true, min: 0, max: LIMITS.maxCols - 1 });
  if (button.icon !== undefined) checkString(ctx, `${path}.icon`, button.icon, { pattern: /^[a-z0-9][a-z0-9-]{0,23}$/, label: 'nome icona' });

  if (button.kind !== undefined && !CONTROL_KINDS.includes(button.kind)) {
    ctx.err(`${path}.kind`, `valore ammesso: ${CONTROL_KINDS.join(' | ')}`);
  }
  checkBool(ctx, `${path}.confirm`, button.confirm);

  // Uno slider occupa piu' celle in orizzontale e ha un proprio intervallo.
  if (button.span !== undefined) checkInt(ctx, `${path}.span`, button.span, { min: 1, max: LIMITS.maxCols });
  for (const key of ['min', 'max', 'step']) {
    if (button[key] !== undefined) checkInt(ctx, `${path}.${key}`, button[key], { min: 0, max: 1000 });
  }
  if (button.kind === 'slider') {
    const min = button.min ?? 0;
    const max = button.max ?? 100;
    if (typeof min === 'number' && typeof max === 'number' && min >= max) {
      ctx.err(`${path}.max`, `"max" (${max}) deve essere maggiore di "min" (${min})`);
    }
  }
  if (button.color !== undefined) checkString(ctx, `${path}.color`, button.color, { pattern: HEX_COLOR_RE, label: 'colore hex' });
  if (button.textColor !== undefined) checkString(ctx, `${path}.textColor`, button.textColor, { pattern: HEX_COLOR_RE, label: 'colore hex' });

  if (typeof button.row === 'number' && typeof page.rows === 'number' && button.row >= page.rows) {
    ctx.err(`${path}.row`, `riga ${button.row} fuori dalla griglia (rows=${page.rows})`);
  }
  if (typeof button.col === 'number' && typeof page.cols === 'number' && button.col >= page.cols) {
    ctx.err(`${path}.col`, `colonna ${button.col} fuori dalla griglia (cols=${page.cols})`);
  }

  // Un controllo con span > 1 occupa piu' celle consecutive sulla stessa riga:
  // vanno marcate tutte, altrimenti un bottone potrebbe finirci sotto.
  const span = Number.isInteger(button.span) && button.span > 0 ? button.span : 1;
  if (typeof button.col === 'number' && typeof page.cols === 'number' && button.col + span > page.cols) {
    ctx.err(`${path}.span`, `il controllo largo ${span} celle da colonna ${button.col} esce dalla griglia (cols=${page.cols})`);
  }
  for (let offset = 0; offset < span; offset += 1) {
    const cell = `${button.row}:${button.col + offset}`;
    if (seen.cells.has(cell)) ctx.err(path, `cella ${cell} gia' occupata dal controllo "${seen.cells.get(cell)}"`);
    else seen.cells.set(cell, button.id);
  }

  if (typeof button.id === 'string') {
    if (seen.buttonIds.has(button.id)) ctx.err(`${path}.id`, `id bottone duplicato: "${button.id}" (gli id devono essere univoci nell'intero deck)`);
    else seen.buttonIds.add(button.id);
  }

  if (button.action === undefined) ctx.err(`${path}.action`, 'campo obbligatorio mancante');
  else validateAction(ctx, `${path}.action`, button.action, actionTypes);

  if (button.holdAction !== undefined) validateAction(ctx, `${path}.holdAction`, button.holdAction, actionTypes);
}

function validateNavigationTargets(ctx, deck) {
  const profileIds = new Set();
  const pagesByProfile = new Map();
  for (const profile of deck.profiles ?? []) {
    if (!isPlainObject(profile)) continue;
    profileIds.add(profile.id);
    pagesByProfile.set(profile.id, new Set((profile.pages ?? []).filter(isPlainObject).map((p) => p.id)));
  }

  if (deck.defaultProfile !== undefined && !profileIds.has(deck.defaultProfile)) {
    ctx.err('defaultProfile', `profilo "${deck.defaultProfile}" non definito`);
  }

  (deck.profiles ?? []).forEach((profile, pi) => {
    if (!isPlainObject(profile)) return;
    const pages = pagesByProfile.get(profile.id) ?? new Set();
    if (profile.defaultPage !== undefined && !pages.has(profile.defaultPage)) {
      ctx.err(`profiles[${pi}].defaultPage`, `pagina "${profile.defaultPage}" non definita nel profilo`);
    }
    (profile.pages ?? []).forEach((page, gi) => {
      if (!isPlainObject(page)) return;
      (page.buttons ?? []).forEach((button, bi) => {
        const action = isPlainObject(button) ? button.action : null;
        if (!isPlainObject(action) || action.type !== 'navigate') return;
        const path = `profiles[${pi}].pages[${gi}].buttons[${bi}].action.params`;
        const targetProfile = action.params?.profile ?? profile.id;
        if (!profileIds.has(targetProfile)) {
          ctx.err(`${path}.profile`, `profilo di destinazione "${targetProfile}" non definito`);
          return;
        }
        const targetPage = action.params?.page;
        if (targetPage !== undefined && !(pagesByProfile.get(targetProfile) ?? new Set()).has(targetPage)) {
          ctx.err(`${path}.page`, `pagina di destinazione "${targetPage}" non definita nel profilo "${targetProfile}"`);
        }
      });
    });
  });
}

/**
 * Valida un oggetto deck grezzo.
 * @param {unknown} raw
 * @param {{actionTypes?: string[]}} [options] elenco dei tipi azione registrati; se assente il controllo e' saltato.
 * @returns {{valid: boolean, errors: Array<{path:string,message:string}>, warnings: Array<{path:string,message:string}>}}
 */
export function validateDeck(raw, options = {}) {
  const ctx = new Ctx();
  const actionTypes = options.actionTypes ?? null;

  if (!isPlainObject(raw)) {
    ctx.err('', 'il deck deve essere un oggetto JSON');
    return { valid: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  checkInt(ctx, 'version', raw.version, { required: true, min: 1, max: 1 });
  checkString(ctx, 'name', raw.name, { max: 64 });
  if (raw.defaultProfile !== undefined) {
    checkString(ctx, 'defaultProfile', raw.defaultProfile, { pattern: SLUG_RE, label: 'slug minuscolo' });
  }

  validateSettings(ctx, raw.settings);

  if (!Array.isArray(raw.profiles)) {
    ctx.err('profiles', 'atteso array di profili');
  } else if (raw.profiles.length === 0) {
    ctx.err('profiles', 'e\' richiesto almeno un profilo');
  } else {
    const profileIds = new Set();
    const buttonIds = new Set();
    raw.profiles.forEach((profile, pi) => {
      const ppath = `profiles[${pi}]`;
      if (!isPlainObject(profile)) {
        ctx.err(ppath, 'atteso oggetto profilo');
        return;
      }
      checkString(ctx, `${ppath}.id`, profile.id, { required: true, pattern: SLUG_RE, label: 'slug minuscolo' });
      checkString(ctx, `${ppath}.name`, profile.name, { max: 64 });
      if (typeof profile.id === 'string') {
        if (profileIds.has(profile.id)) ctx.err(`${ppath}.id`, `id profilo duplicato: "${profile.id}"`);
        else profileIds.add(profile.id);
      }

      if (!Array.isArray(profile.pages) || profile.pages.length === 0) {
        ctx.err(`${ppath}.pages`, 'e\' richiesta almeno una pagina');
        return;
      }

      const pageIds = new Set();
      profile.pages.forEach((page, gi) => {
        const gpath = `${ppath}.pages[${gi}]`;
        if (!isPlainObject(page)) {
          ctx.err(gpath, 'atteso oggetto pagina');
          return;
        }
        checkString(ctx, `${gpath}.id`, page.id, { required: true, pattern: SLUG_RE, label: 'slug minuscolo' });
        checkString(ctx, `${gpath}.name`, page.name, { max: 64 });
        checkInt(ctx, `${gpath}.rows`, page.rows, { required: true, min: 1, max: LIMITS.maxRows });
        checkInt(ctx, `${gpath}.cols`, page.cols, { required: true, min: 1, max: LIMITS.maxCols });
        if (typeof page.id === 'string') {
          if (pageIds.has(page.id)) ctx.err(`${gpath}.id`, `id pagina duplicato nel profilo: "${page.id}"`);
          else pageIds.add(page.id);
        }

        if (page.buttons === undefined) {
          ctx.err(`${gpath}.buttons`, 'campo obbligatorio mancante (puo\' essere un array vuoto)');
          return;
        }
        if (!Array.isArray(page.buttons)) {
          ctx.err(`${gpath}.buttons`, 'atteso array di bottoni');
          return;
        }
        if (page.buttons.length > LIMITS.maxButtonsPerPage) {
          ctx.err(`${gpath}.buttons`, `troppi bottoni (max ${LIMITS.maxButtonsPerPage})`);
        }
        const seen = { cells: new Map(), buttonIds };
        page.buttons.forEach((button, bi) => {
          validateButton(ctx, `${gpath}.buttons[${bi}]`, button, page, seen, actionTypes);
        });
      });
    });

    validateNavigationTargets(ctx, raw);
  }

  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}

function deepMergeDefaults(target, defaults) {
  const out = { ...defaults, ...target };
  for (const key of Object.keys(defaults)) {
    if (isPlainObject(defaults[key])) {
      out[key] = deepMergeDefaults(isPlainObject(target?.[key]) ? target[key] : {}, defaults[key]);
    }
  }
  return out;
}

/**
 * Applica i valori di default e produce una copia normalizzata del deck.
 * Presuppone che `validateDeck` sia gia' passata.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeDeck(raw) {
  const settings = deepMergeDefaults(raw.settings ?? {}, DEFAULT_SETTINGS);
  const profiles = raw.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name ?? profile.id,
    defaultPage: profile.defaultPage ?? profile.pages[0].id,
    pages: profile.pages.map((page) => ({
      id: page.id,
      name: page.name ?? page.id,
      rows: page.rows,
      cols: page.cols,
      buttons: (page.buttons ?? []).map((button) => ({
        id: button.id,
        label: button.label ?? '',
        row: button.row,
        col: button.col,
        kind: button.kind ?? 'button',
        span: button.span ?? (button.kind === 'slider' ? 2 : 1),
        confirm: button.confirm === true,
        ...(button.kind === 'slider'
          ? { min: button.min ?? 0, max: button.max ?? 100, step: button.step ?? 1 }
          : {}),
        icon: button.icon ?? null,
        color: button.color ?? null,
        textColor: button.textColor ?? null,
        action: { type: button.action.type, params: button.action.params ?? {} },
        holdAction: button.holdAction
          ? { type: button.holdAction.type, params: button.holdAction.params ?? {} }
          : null
      }))
    }))
  }));

  return {
    version: raw.version,
    name: raw.name ?? 'Wdeck',
    defaultProfile: raw.defaultProfile ?? profiles[0].id,
    settings,
    profiles
  };
}

/**
 * Formatta gli errori di validazione in una stringa multi-riga leggibile.
 * @param {Array<{path:string,message:string}>} errors
 */
export function formatErrors(errors) {
  return errors.map((e) => `  - ${e.path || '<root>'}: ${e.message}`).join('\n');
}
