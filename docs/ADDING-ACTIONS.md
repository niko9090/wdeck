# Aggiungere una nuova azione

Un'azione e' un oggetto JavaScript registrato nel **registro azioni**
([`src/host/actions/registry.mjs`](../src/host/actions/registry.mjs)).
Aggiungerne una non richiede di toccare il server, il protocollo o il client:
il client web scopre le azioni disponibili da `GET /api/actions` e la
validazione di `deck.json` usa automaticamente i tipi registrati.

## 1. Il contratto

```js
export const miaAzione = {
  // obbligatori
  type: 'obs-scene',              // slug minuscolo, usato in deck.json
  async run(params, ctx) {},      // esecuzione

  // consigliati
  title: 'Cambio scena OBS',
  description: 'Attiva una scena su OBS Studio tramite obs-websocket.',
  platforms: ['*'],               // oppure ['win32'], ['darwin'], ...
  paramsHelp: { scene: 'nome della scena' },
  stub: false,                    // true se non e' ancora implementata

  validate(params) {},            // lancia Error se i parametri sono sbagliati
  describe(params) {},            // stringa mostrata in dry-run, log e ack

  // opzionale: stato reale del controllo (vedi sezione 2-bis)
  async readState(params, ctx) {}
};
```

### Il contesto `ctx`

| campo | contenuto |
|---|---|
| `ctx.dryRun` | `true` se l'azione deve essere **simulata** |
| `ctx.security` | `settings.security` del deck (whitelist, limiti) |
| `ctx.baseDir` | directory di `deck.json`, per risolvere i percorsi relativi |
| `ctx.deck` | deck normalizzato corrente |
| `ctx.state` | stato host (`navigate`, `snapshot`, ...) |
| `ctx.logger` | logger dell'host |
| `ctx.source` | `rest`, `ws`, `lite-ws`, `lite-rest`, `internal` |
| `ctx.button` | bottone premuto (assente per i passi di una `sequence`) |
| `ctx.execute` | esegue un'altra azione (usato da `sequence`) |

### Il valore restituito

```js
return { ok: true, detail: 'testo breve per log e client', /* campi liberi */ };
```

`ok: false` (o un'eccezione) marca l'azione come fallita. Per gli errori di
sicurezza impostare `err.code = 'forbidden'` prima di lanciare: il dispatcher
lo traduce in HTTP `403`.

## 2. Le tre regole non negoziabili

1. **Rispettare `ctx.dryRun`.** In dry-run l'azione non deve produrre alcun
   effetto: deve solo restituire cosa *avrebbe* fatto.
   ```js
   if (ctx.dryRun) return { ok: true, simulated: true, detail: `attiverebbe ${params.scene}` };
   ```
2. **Validare prima di eseguire.** `validate()` viene chiamata anche in dry-run:
   e' li' che si intercettano i parametri sbagliati.
3. **Passare dalla whitelist** per qualunque cosa esegua codice o apra risorse
   locali (`checkExecutable`, `checkUrl` in
   [`src/host/security/allowlist.mjs`](../src/host/security/allowlist.mjs)).
   La verifica va fatta **prima** del controllo su `dryRun`, cosi' una
   configurazione vietata risulta bloccata anche in simulazione.

## 2-bis. Lo stato reale del controllo (`readState`)

Un'azione che accende, spegne o regola qualcosa puo' dire ai client **in che
stato si trova adesso**: e' cio' che rende il bottone del muto diverso da un
telecomando, perche' resta giusto anche se il volume viene cambiato altrove.

```js
async readState(params, ctx) {
  const audio = await ctx.cached('audio:speaker', () => leggiVolume());
  return {
    on: audio.muted,        // true | false | null (null = non e' un interruttore)
    level: audio.volume,    // 0..100, oppure null
    text: audio.muted ? 'muto' : null   // etichetta breve, oppure null
  };
}
```

Restituire `null` significa "non lo so": il client non mostra alcuna spia.

Regole:

| regola | perche' |
|---|---|
| **`readState` non deve modificare nulla.** | Viene chiamata da sola, ogni pochi secondi. |
| **Usare `ctx.cached(chiave, fn)`** per la parte costosa. | Dieci bottoni volume devono costare una lettura sola, non dieci processi PowerShell. |
| **Lanciare un errore se il servizio non risponde.** | L'host lo mostra come stato in errore e mette quella lettura in pausa per un minuto, invece di insistere. |
| **Non serve gestire `ctx.dryRun`.** | In dry-run l'host non chiama affatto `readState`. |

`ctx` e' lo stesso di `run()`, piu' `ctx.cached` e `ctx.reading === true`.
Chi non dichiara `readState` non viene mai interrogato: aggiungerla e' a costo
zero per tutte le altre azioni. `GET /api/actions` riporta `reportsState: true`
per le azioni che la dichiarano.

L'host interroga solo i controlli della pagina attiva, e solo mentre almeno un
client e' collegato. Un bottone con `"status": false` in `deck.json` viene
escluso.

## 3. Esempio completo

`src/host/actions/handlers/obs.mjs`:

```js
export const obsSceneAction = {
  type: 'obs-scene',
  title: 'Cambio scena OBS',
  description: 'Attiva una scena su OBS Studio via obs-websocket.',
  platforms: ['*'],
  paramsHelp: { scene: 'nome della scena', url: 'ws://127.0.0.1:4455' },

  validate(params) {
    if (typeof params?.scene !== 'string' || params.scene.trim() === '') {
      throw new Error('parametro "scene" mancante');
    }
  },

  describe: (params) => `attiva la scena OBS "${params.scene}"`,

  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `attiverebbe la scena "${params.scene}"` };
    }
    await inviaAObs(params.url ?? 'ws://127.0.0.1:4455', params.scene);
    return { ok: true, detail: `scena attivata: ${params.scene}` };
  }
};

export default [obsSceneAction];
```

Registrazione in [`src/host/actions/handlers/index.mjs`](../src/host/actions/handlers/index.mjs):

```js
import obs from './obs.mjs';
export const builtinHandlers = [...basic, ...input, ...system, ...net, ...flow, ...obs];
```

Uso in `deck.json`:

```json
{
  "id": "scena-gioco",
  "label": "Gioco",
  "row": 0, "col": 0,
  "icon": "camera",
  "action": { "type": "obs-scene", "params": { "scene": "Gameplay" } }
}
```

## 4. Registrazione senza modificare il repository

`createHost()` accetta handler aggiuntivi: utile per plugin esterni o per i test.

```js
import { createHost } from './src/host/index.mjs';
import { obsSceneAction } from './mio-plugin.mjs';

const host = createHost({ extraHandlers: [obsSceneAction] });
await host.start();
```

Gli handler passati in `extraHandlers` possono **sostituire** quelli predefiniti
(vengono registrati con `override: true`).

## 5. Test

Aggiungere il caso in `test/dispatcher.test.mjs` (la fixture e' in
[`tools/fixtures.mjs`](../tools/fixtures.mjs)):

```js
test('obs-scene: simulata in dry-run', async () => {
  const registry = createDefaultRegistry({ extra: [obsSceneAction] });
  const { dispatcher } = makeDispatcher({ registry });
  const result = await dispatcher.execute({ type: 'obs-scene', params: { scene: 'Gameplay' } });
  assert.equal(result.ok, true);
  assert.match(result.description, /Gameplay/);
});
```

Poi:

```bash
npm test
```

`test/registry.test.mjs` verifica anche che **ogni** azione registrata dichiari
`title`, `description` e `platforms`: una nuova azione senza metadati fa
fallire la suite.

## 6. Azioni incluse

Ogni handler dichiara anche una `category` (usata dall'editor per raggruppare le
azioni) e un `control`, che vale `button` salvo per le azioni pilotabili con un
cursore, dove vale `slider`.

Sanno dichiarare il proprio **stato reale** (`readState`): `volume`, `mic`,
`brightness`, `media` (con `key` `mute`, `volumeup`, `volumedown`), `obs` e
`hue`.

### Scrivere un'azione multipiattaforma

Un handler non deve contenere `if (process.platform === ...)`: quella scelta
sta in [`src/host/platform/input.mjs`](../src/host/platform/input.mjs), che
espone una coppia di funzioni per operazione - `plan*` descrive cosa verrebbe
fatto (serve al dry-run ed e' pura), `send*` lo fa. Gli adattatori veri sono
`windows.mjs`, `macos.mjs` e `linux.mjs`; le mappe dei tasti stanno in
`keymaps.mjs` e sono moduli puri, quindi verificabili anche dalla piattaforma
sbagliata. Per l'audio la facciata equivalente e' `platform/audio.mjs`.

Dichiarare `platforms` con l'elenco vero: fuori da quelle piattaforme il
dispatcher risponde `501` con un messaggio esplicito, che e' meglio di un
errore oscuro a ogni pressione.

### Media e audio

| tipo | piattaforme | descrizione |
|---|---|---|
| `volume` | win32, darwin, linux | volume di sistema assoluto 0..100, delta o muto (cursore) |
| `mic` | win32, darwin, linux | volume del microfono predefinito, e il muto dove il sistema lo espone (cursore) |

### Finestre e desktop

| tipo | piattaforme | descrizione |
|---|---|---|
| `focus` | win32 | porta in primo piano una finestra gia' aperta, per processo o titolo |
| `desktop` | win32 | passa a un desktop virtuale per numero, per nome o di uno a destra/sinistra |
| `window` | win32 | mostra il desktop, minimizza tutto, chiudi, affianca, massimizza, cambia finestra |

### Sistema e alimentazione

| tipo | piattaforme | descrizione |
|---|---|---|
| `brightness` | win32 | luminosita' 0..100 via WMI, DDC/CI o gamma ramp (cursore) |
| `power` | win32 | blocca, sospendi, iberna, spegni, riavvia, disconnetti, spegni lo schermo |

### Programmi, browser e desktop remoti

| tipo | piattaforme | descrizione |
|---|---|---|
| `game` | win32 | avvia un gioco via Steam, Epic, GOG, Xbox o percorso |
| `browser` | win32 | apre un indirizzo in un browser scelto, con profilo, anonima o chiosco |
| `rdp` | win32 | apre una connessione Desktop remoto (mstsc) |

### Produttivita'

| tipo | piattaforme | descrizione |
|---|---|---|
| `clipboard` | win32 | copia, incolla o svuota gli appunti |
| `folder` | win32 | apre una cartella in Esplora file |
| `screenshot` | win32 | cattura lo schermo in PNG o apre la cattura d'area |
| `notify` | win32 | mostra una notifica di Windows sull'host |

### Integrazioni

| tipo | piattaforme | descrizione |
|---|---|---|
| `obs` | tutte | OBS Studio via obs-websocket v5: scene, registrazione, diretta, muto |
| `homeassistant` | tutte | chiama un servizio di Home Assistant |
| `hue` | tutte | accende, spegne e regola luci e gruppi Philips Hue |

### Base

| tipo | piattaforme | descrizione |
|---|---|---|
| `media` | win32, darwin, linux | comandi multimediali (play/pausa, next, prev, volume, muto) |
| `hotkey` | win32, darwin, linux | combinazione di tasti, es. `ctrl+shift+m`, `win+l` |
| `text` | win32, darwin, linux | digita testo nella finestra attiva |
| `launch` | tutte | avvia un programma (whitelist) |
| `script` | tutte | esegue `.ps1`/`.bat`/`.cmd`/`.py`/`.mjs`/`.sh` (whitelist) |
| `url` | win32, darwin, linux | apre un URL con l'app predefinita |
| `http` | tutte | richiesta HTTP verso webhook/API |
| `sequence` | tutte | esegue in ordine piu' azioni |
| `delay` | tutte | attesa, da usare dentro `sequence` |
| `navigate` | tutte | cambia pagina o profilo attivo |
| `noop` | tutte | non fa nulla |
| `stub` | tutte | segnaposto dichiarato non implementato |
