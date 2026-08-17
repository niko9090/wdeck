/** Azioni di base: noop, delay, navigate, stub. */

export const noopAction = {
  type: 'noop',
  title: 'Nessuna azione',
  description: 'Non fa nulla. Utile come segnaposto o per bottoni puramente decorativi.',
  platforms: ['*'],
  category: 'deck',
  fields: [],
  describe: () => 'nessuna azione',
  async run() {
    return { ok: true, detail: 'noop' };
  }
};

export const delayAction = {
  type: 'delay',
  title: 'Attesa',
  description: 'Attende un numero di millisecondi. Pensata per essere usata dentro una sequence.',
  platforms: ['*'],
  category: 'deck',
  paramsHelp: { ms: 'intero 0..10000' },
  fields: [
    { key: 'ms', label: 'Millisecondi', type: 'number', help: 'intero 0..10000', min: 0, max: 10000, step: 1, required: true, default: 500 }
  ],
  validate(params) {
    const ms = Number(params?.ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > 10000) {
      throw new Error('parametro "ms" non valido: atteso intero fra 0 e 10000');
    }
  },
  describe: (params) => `attende ${Number(params?.ms) || 0} ms`,
  async run(params, ctx) {
    const ms = Number(params?.ms) || 0;
    if (ctx.dryRun) return { ok: true, simulated: true, detail: `attesa di ${ms} ms saltata (dry-run)` };
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { ok: true, detail: `atteso ${ms} ms` };
  }
};

export const navigateAction = {
  type: 'navigate',
  title: 'Cambio pagina/profilo',
  description: 'Cambia la pagina o il profilo attivo e notifica tutti i client collegati.',
  platforms: ['*'],
  category: 'deck',
  paramsHelp: { profile: 'id profilo (opzionale)', page: 'id pagina (opzionale)' },
  fields: [
    { key: 'profile', label: 'Profilo', type: 'profile', help: 'id profilo (opzionale)' },
    { key: 'page', label: 'Pagina', type: 'page', help: 'id pagina (opzionale)' }
  ],
  validate(params) {
    if (!params?.profile && !params?.page) {
      throw new Error('navigate richiede almeno uno fra "profile" e "page"');
    }
  },
  describe: (params) => `naviga a ${params?.profile ?? '(profilo corrente)'} / ${params?.page ?? '(pagina corrente)'}`,
  async run(params, ctx) {
    const target = {
      profileId: params?.profile ?? ctx.state?.activeProfileId,
      pageId: params?.page
    };
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `navigazione simulata verso ${target.profileId}/${target.pageId ?? '(default)'}`, target };
    }
    if (!ctx.state) throw new Error('stato host non disponibile per navigate');
    const applied = ctx.state.navigate(target.profileId, target.pageId);
    return { ok: true, detail: `pagina attiva: ${applied.profileId}/${applied.pageId}`, target: applied };
  }
};

export const stubAction = {
  type: 'stub',
  title: 'Segnaposto (non implementata)',
  description: 'Azione dichiaratamente non implementata: conferma la pressione ma non esegue nulla. '
    + 'Usata per marcare le integrazioni previste in roadmap (OBS, MQTT, Home Assistant...).',
  platforms: ['*'],
  category: 'deck',
  stub: true,
  paramsHelp: { note: 'testo libero mostrato nella risposta' },
  fields: [
    { key: 'note', label: 'Nota', type: 'text', help: 'testo libero mostrato nella risposta' }
  ],
  describe: (params) => `stub: ${params?.note ?? 'non implementata'}`,
  async run(params) {
    return {
      ok: true,
      stub: true,
      detail: params?.note ? String(params.note).slice(0, 200) : 'azione non ancora implementata'
    };
  }
};

export default [noopAction, delayAction, navigateAction, stubAction];
