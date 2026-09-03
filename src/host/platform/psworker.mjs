/**
 * Operaio PowerShell persistente.
 *
 * Avviare un PowerShell nuovo per ogni comando costa 300-700 ms solo di
 * partenza, e se lo script compila del C# con `Add-Type` (Core Audio, DDC/CI,
 * keybd_event) si sale a 2-7 secondi A PRESSIONE. Con una manopola che manda
 * dieci scatti in un secondo, i comandi si accodano e il PC risponde con un
 * minuto di ritardo: e' esattamente la lentezza che si sentiva su volume e
 * luminosita'.
 *
 * Qui il processo resta acceso: compila una volta sola all'avvio, poi legge
 * dallo stdin una riga per comando e risponde su una riga. Il protocollo e'
 * deciso da chi lo usa (key server, level server) e trasporta solo numeri e
 * parole chiave: nessuno script arbitrario passa di qui.
 *
 * E' un'ottimizzazione, non un obbligo: se il processo non parte, si blocca o
 * viene disattivato, chi lo usa ricade sul vecchio metodo a colpo singolo.
 * La correttezza non dipende mai da lui.
 *
 * Contratto con lo script di avvio (`bootstrap`):
 *  - stampa `READY` su stdout quando e' pronto;
 *  - per ogni riga `<id> <comando>` risponde `<id> OK[ <testo>]` oppure
 *    `<id> ERR <messaggio>`, sempre su una riga sola.
 */

import { spawn } from 'node:child_process';
import { encodePowerShell, powershellPath } from './windows.mjs';

export class PowerShellWorker {
  /**
   * @param {{name: string, bootstrap: string, readyMs?: number, jobMs?: number}} spec
   */
  constructor({ name, bootstrap, readyMs = 5000, jobMs = 5000 }) {
    this.name = name;
    this.bootstrap = bootstrap;
    this.readyMs = readyMs;
    this.jobMs = jobMs;
    this.proc = null;
    this.ready = null;
    this.onReady = null;
    this.onReadyFail = null;
    this.jobId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  start() {
    if (this.ready) return this.ready;
    let proc;
    try {
      proc = spawn(powershellPath(), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodePowerShell(this.bootstrap)
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return Promise.reject(err);
    }
    this.proc = proc;

    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`${this.name}: nessun READY entro il tempo`)), this.readyMs);
      this.onReady = () => { clearTimeout(timer); resolve(); };
      this.onReadyFail = (err) => { clearTimeout(timer); reject(err); };
    });
    // Un avvio fallito non deve restare una promise rifiutata senza nessuno in
    // ascolto (chi ha chiamato run() ha gia' ricevuto il suo errore).
    this.ready.catch(() => {});

    proc.stdout.on('data', (d) => this.onData(d.toString()));
    proc.stderr.on('data', () => { /* gli errori tornano come "<id> ERR" sullo stdout */ });
    proc.on('error', (err) => this.fail(err));
    proc.on('exit', () => this.fail(new Error(`${this.name}: processo terminato`)));
    return this.ready;
  }

  onData(text) {
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      if (line === 'READY') { this.onReady?.(); continue; }
      const sp = line.indexOf(' ');
      const id = sp >= 0 ? line.slice(0, sp) : line;
      const rest = sp >= 0 ? line.slice(sp + 1) : '';
      const job = this.pending.get(id);
      if (!job) continue;
      this.pending.delete(id);
      clearTimeout(job.timer);
      if (rest === 'OK' || rest.startsWith('OK ')) job.resolve(rest.slice(2).trim());
      else {
        // Il comando e' stato eseguito e ha fallito: non e' il processo a non
        // funzionare, e chi chiama non deve ripiegare sulla via lenta.
        const err = new Error(`${this.name}: ${rest.replace(/^ERR\s*/, '') || 'errore'}`);
        err.remote = true;
        job.reject(err);
      }
    }
  }

  /** Abbatte il processo e rifiuta tutto: la prossima chiamata lo riavvia. */
  fail(err) {
    this.onReadyFail?.(err);
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(err); }
    this.pending.clear();
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    this.onReady = null;
    this.onReadyFail = null;
    this.buffer = '';
    try { proc?.kill(); } catch { /* gia' uscito */ }
  }

  /**
   * Manda una riga di comando e attende la risposta.
   * @param {string} command
   * @returns {Promise<string>} il testo dopo `OK` (vuoto se non c'e')
   */
  async run(command) {
    await this.start();
    const id = String(++this.jobId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const job = this.pending.get(id);
        this.pending.delete(id);
        const err = new Error(`${this.name}: risposta non arrivata in tempo`);
        job?.reject(err);
        this.fail(err); // un job che non risponde = processo bloccato: si riparte
      }, this.jobMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(`${id} ${command}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); }
    this.pending.clear();
    try { proc?.stdin?.end(); } catch { /* */ }
    try { proc?.kill(); } catch { /* */ }
  }
}

/**
 * Coda di lettura standard per il ciclo dello script: legge una riga, la
 * spezza in `<id>` e resto, e lascia a `handler` (PowerShell) il compito di
 * produrre il testo della risposta. Serve a non riscrivere il ciclo in ogni
 * server.
 * @param {string} handler codice PowerShell che legge `$p` (parole della riga,
 *   `$p[0]` e' l'id) e mette la risposta in `$r`
 * @returns {string}
 */
export function workerLoop(handler) {
  return [
    '$out = [Console]::Out',
    '$out.WriteLine("READY"); $out.Flush()',
    'while ($true) {',
    '  $line = [Console]::In.ReadLine()',
    '  if ($null -eq $line) { break }',
    '  if ($line.Length -eq 0) { continue }',
    '  $p = $line.Split(" ")',
    '  $id = $p[0]',
    '  $r = ""',
    '  try {',
    handler,
    '    $out.WriteLine("$id OK $r"); $out.Flush()',
    '  } catch {',
    '    $out.WriteLine("$id ERR " + $_.Exception.Message); $out.Flush()',
    '  }',
    '}'
  ].join('\n');
}
