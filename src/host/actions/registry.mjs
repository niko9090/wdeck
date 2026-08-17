/**
 * Registro degli action-handler.
 *
 * Un handler e' un oggetto con questa forma:
 * {
 *   type: 'media',                       // identificatore usato in deck.json
 *   title: 'Tasti multimediali',
 *   description: '...',
 *   platforms: ['win32'] | ['*'],        // piattaforme su cui l'esecuzione reale e' possibile
 *   paramsHelp: { key: 'playpause|next|...' },
 *   validate(params) {},                 // lancia Error se i parametri non sono validi
 *   describe(params) -> string,          // testo mostrato in dry-run e nei log
 *   async run(params, ctx) -> object     // esecuzione vera (o simulata se ctx.dryRun)
 * }
 *
 * Aggiungere un'azione = scrivere un file in actions/handlers/ e registrarlo:
 * vedi docs/ADDING-ACTIONS.md.
 */

const REQUIRED_KEYS = ['type', 'run'];

/**
 * Categorie mostrate dall'editor visuale, nell'ordine in cui compaiono.
 * Un handler dichiara `category: '<id>'`; se l'id non e' fra questi finisce
 * nel gruppo "Altro" invece di sparire dal menu.
 */
export const CATEGORIES = [
  { id: 'media', label: 'Media e audio', icon: 'play' },
  { id: 'input', label: 'Tastiera e testo', icon: 'keyboard' },
  { id: 'window', label: 'Finestre e desktop', icon: 'layers' },
  { id: 'system', label: 'Sistema e alimentazione', icon: 'power' },
  { id: 'app', label: 'Programmi e giochi', icon: 'rocket' },
  { id: 'browser', label: 'Browser e web', icon: 'globe' },
  { id: 'remote', label: 'Desktop remoti', icon: 'monitor' },
  { id: 'streaming', label: 'Streaming e OBS', icon: 'camera' },
  { id: 'smarthome', label: 'Casa intelligente', icon: 'bulb' },
  { id: 'productivity', label: 'Produttivita\'', icon: 'clock' },
  { id: 'script', label: 'Script personalizzati', icon: 'terminal' },
  { id: 'deck', label: 'Navigazione deck', icon: 'next' }
];

export class ActionRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.handlers = new Map();
  }

  /**
   * Registra un handler.
   * @param {object} handler
   * @param {{override?: boolean}} [options]
   * @returns {ActionRegistry} this (per il chaining)
   */
  register(handler, options = {}) {
    if (typeof handler !== 'object' || handler === null) {
      throw new TypeError('handler non valido: atteso oggetto');
    }
    for (const key of REQUIRED_KEYS) {
      if (handler[key] === undefined) throw new TypeError(`handler non valido: manca la proprieta' "${key}"`);
    }
    if (typeof handler.type !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(handler.type)) {
      throw new TypeError(`tipo azione non valido: "${handler.type}" (atteso slug minuscolo)`);
    }
    if (typeof handler.run !== 'function') {
      throw new TypeError(`handler "${handler.type}": run deve essere una funzione`);
    }
    if (this.handlers.has(handler.type) && !options.override) {
      throw new Error(`azione gia' registrata: "${handler.type}" (usare { override: true } per sostituirla)`);
    }

    this.handlers.set(handler.type, {
      platforms: ['*'],
      title: handler.type,
      description: '',
      category: 'altro',
      paramsHelp: {},
      validate: () => {},
      describe: () => handler.type,
      ...handler
    });
    return this;
  }

  /** Rimuove un handler. @returns {boolean} */
  unregister(type) {
    return this.handlers.delete(type);
  }

  /** @returns {boolean} */
  has(type) {
    return this.handlers.has(type);
  }

  /**
   * @param {string} type
   * @returns {object}
   * @throws {Error} se il tipo non e' registrato
   */
  get(type) {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`azione sconosciuta: "${type}" (registrate: ${this.types().join(', ')})`);
    }
    return handler;
  }

  /** @returns {string[]} elenco ordinato dei tipi registrati */
  types() {
    return [...this.handlers.keys()].sort();
  }

  /** Descrizione serializzabile del registro, esposta da GET /api/actions. */
  list() {
    return this.types().map((type) => {
      const h = this.handlers.get(type);
      return {
        type: h.type,
        title: h.title,
        description: h.description,
        category: h.category,
        control: h.control ?? 'button',
        platforms: h.platforms,
        paramsHelp: h.paramsHelp,
        // Schema dei parametri per il form guidato dell'editor: ogni voce e' un
        // campo (etichetta, tipo, opzioni, limiti). Vuoto = azione senza
        // parametri o solo avanzata.
        fields: Array.isArray(h.fields) ? h.fields : [],
        // Vero quando l'azione ha parametri che non stanno in un campo semplice
        // (oggetti annidati, liste): l'editor invita a usare la modalita' JSON.
        advanced: h.advanced === true,
        stub: h.stub === true,
        // L'editor lo usa per dire quali azioni sanno mostrare lo stato reale.
        reportsState: typeof h.readState === 'function'
      };
    });
  }

  /**
   * Azioni raggruppate per categoria, nell'ordine di CATEGORIES.
   * Usata dall'editor visuale per popolare il menu "scegli azione".
   * @returns {Array<{id: string, label: string, icon: string, actions: object[]}>}
   */
  byCategory() {
    const all = this.list();
    const groups = CATEGORIES.map((cat) => ({
      ...cat,
      actions: all.filter((a) => a.category === cat.id)
    }));
    const known = new Set(CATEGORIES.map((c) => c.id));
    const rest = all.filter((a) => !known.has(a.category));
    if (rest.length) groups.push({ id: 'altro', label: 'Altro', icon: 'gear', actions: rest });
    return groups.filter((g) => g.actions.length > 0);
  }

  get size() {
    return this.handlers.size;
  }

  /**
   * Verifica che un'azione sia eseguibile sulla piattaforma corrente.
   * @param {string} type
   * @param {string} [platform]
   */
  supportsPlatform(type, platform = process.platform) {
    const h = this.get(type);
    return h.platforms.includes('*') || h.platforms.includes(platform);
  }
}

/** Crea un registro vuoto. */
export function createRegistry() {
  return new ActionRegistry();
}
