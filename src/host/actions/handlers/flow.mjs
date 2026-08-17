/** Azione di controllo di flusso: sequenze multi-azione. */

export const sequenceAction = {
  type: 'sequence',
  title: 'Sequenza',
  description: 'Esegue in ordine una lista di azioni. Si ferma al primo errore, salvo continueOnError.',
  platforms: ['*'],
  category: 'deck',
  paramsHelp: {
    steps: 'array di azioni { type, params }',
    continueOnError: 'boolean (default false)'
  },
  advanced: true,
  fields: [],
  validate(params) {
    const steps = params?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('parametro "steps" non valido: atteso array non vuoto');
    }
    for (const [i, step] of steps.entries()) {
      if (typeof step !== 'object' || step === null || typeof step.type !== 'string') {
        throw new Error(`step[${i}] non valido: atteso oggetto con "type"`);
      }
      if (step.type === 'sequence') {
        throw new Error(`step[${i}]: le sequenze annidate non sono ammesse direttamente in una sequence`);
      }
    }
  },
  describe: (params) => `sequenza di ${params?.steps?.length ?? 0} passi: ${(params?.steps ?? []).map((s) => s.type).join(' -> ')}`,
  async run(params, ctx) {
    const max = ctx.security?.maxSequenceSteps ?? 32;
    const steps = params.steps;
    if (steps.length > max) {
      throw new Error(`sequenza troppo lunga: ${steps.length} passi (limite settings.security.maxSequenceSteps = ${max})`);
    }
    if (typeof ctx.execute !== 'function') {
      throw new Error('contesto incompleto: manca execute() per eseguire i passi della sequenza');
    }

    const results = [];
    for (const [i, step] of steps.entries()) {
      const result = await ctx.execute(step, ctx);
      results.push({ index: i, type: step.type, ...result });
      if (!result.ok && !params.continueOnError) {
        return {
          ok: false,
          detail: `sequenza interrotta al passo ${i} (${step.type})`,
          error: result.error,
          steps: results
        };
      }
    }
    return {
      ok: true,
      detail: `sequenza completata: ${results.length} passi`,
      steps: results
    };
  }
};

export default [sequenceAction];
