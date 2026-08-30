# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Il progetto segue il [versionamento semantico](https://semver.org/lang/it/).

## [Non rilasciato]

### Corretto

- **Il banner dell'aggiornamento restava dopo l'aggiornamento, e vicino al nome
  dell'app comparivano due versioni.** Erano lo stesso difetto: il distintivo
  mostra la versione PROPOSTA accanto a quella IN ESECUZIONE, e il client si
  teneva la risposta calcolata dall'host prima di aggiornarsi. Ora il client
  confronta da solo le due versioni (`compareVersions`, la stessa regola
  dell'host) e non propone mai una versione che sta gia' girando; la
  rivalutazione avviene appena si scopre la versione vera, senza aspettare un
  giro in rete.

## [0.10.0] - 2026-08-27

### Aggiunto

- **Vocabolario dei comandi: 16 tipi di controllo.** Un tasto ora ha un `kind`.
  Si premono `button` `folder` `macro` `timer` `pad` `selector`; si trascinano
  `slider` `xy` `color`; girano `encoder` `jog` `stepper`; leggono e basta
  `gauge` `meter` `chart` `display`. I tipi di sola lettura rifiutano le
  pressioni e non possono avere azioni di hold, di rilascio o conferma.
- **Due campi nuovi nel `press`** (REST e WebSocket): `delta` (scarto relativo,
  anche negativo o decimale) e la coppia `x`/`y`, che viaggia sempre intera —
  mezza coppia e' `bad_request`. Finiscono in `action.params`.
- **Gli handler li usano davvero.** `volume`/`mic`/`brightness` seguono lo
  scatto della manopola; `mouse` scorre la rotellina con `delta` (il segno da'
  il verso, tetto 30 scatti) e con `x`/`y` porta il puntatore in quel punto
  dello schermo principale; `hotkey` manda la combinazione una volta per scatto
  e, con il nuovo `keysBack`, manda una combinazione diversa girando
  all'indietro (zoom avanti/indietro con una sola manopola).
- **Cursori verticali e centrati.** `orientation: "h" | "v"` e `center: true`.
  Il verticale si comanda dal basso verso l'alto come un fader e vale una cella
  sola; il centrato parte dalla meta' e cresce nei due versi, con una tacca
  sullo zero.
- **Sette stili per il deck** (`settings.ui.style`): default, keycap, ceramica,
  console, quaderno, strumento, oscura. Sono una cosa diversa da `ui.theme`:
  il tema e' la luce (chiaro/scuro/auto), lo stile e' la forma (superfici,
  raggi, ombre, carattere). Si combinano, e uno stile ridefinisce solo i token
  del CSS: non tocca il markup, quindi non puo' rompere una funzione.
- **`min`/`max`/`step` sono numeri veri** (±1e6, decimali e negativi), non piu'
  interi 0..1000: si puo' fare un termostato 15→30 a scatti di 0.5 o
  l'esposizione di una foto da -5 a +5 EV.

### Corretto

- **Le scorciatoie con la punteggiatura non funzionavano.** La cattura dei tasti
  nel client compone `ctrl+-` o `ctrl++`, ma l'host non aveva in tabella nessun
  tasto di punteggiatura e li rifiutava con "tasto sconosciuto"; il `+` finale
  spariva perfino fra i separatori. Aggiunti i tasti `VK_OEM_*` (piu', meno,
  virgola, punto, barra, parentesi, apice, punto e virgola, accento) e tutto il
  tastierino numerico, con gli alias sui caratteri veri. Era anche l'unica cosa
  che impediva di legare lo zoom a una manopola.
- **Un cursore verticale intrappolava il dito.** Lo swipe fra pagine iniziato
  sopra di lui non cambiava pagina: il gesto del cursore si prendeva tutto,
  anche i trascinamenti orizzontali, che per un fader verticale non vogliono
  dire niente. Ora oltre i 12 px di lato il gesto torna a essere uno swipe e il
  cursore riprende il valore che aveva. Il cursore ORIZZONTALE continua a
  tenerseli: li' trascinare di lato e' la sua regolazione, non c'e' modo di
  distinguere i due gesti.
- **Il cursore era lento e non stava dietro al dito.** Il riempimento aveva una
  transizione di 90 ms su ogni movimento: in un trascinamento veloce inseguiva
  la mano senza mai raggiungerla. Ora la transizione c'e' solo quando il valore
  arriva dall'host; sotto al dito e' tolta.
- **Il cursore tornava indietro da solo dopo averlo mollato** (da 100 a 80, e
  via da capo). L'host rilegge il livello vero del PC a intervalli: la lettura
  partita PRIMA del cambiamento arrivava dopo il rilascio e vinceva. Per un
  secondo e mezzo dopo che si toglie il dito comanda quello che ha chiesto
  l'utente, poi si torna ad ascoltare il PC.
- **Il valore del cursore non parte piu' al primo tocco** ma al primo movimento
  vero (o al rilascio, se e' stato solo un tocco): appoggiare il dito su un
  cursore per sfogliare le pagine non deve cambiare il volume del PC.

### Note

- I comandi nuovi sono stati verificati dal vivo lato host (protocollo, gesti,
  rifiuti) e con la suite di test; l'aspetto nel browser va guardato sul proprio
  telefono dopo l'aggiornamento.

## [0.9.0] - 2026-08-22

### Aggiunto

- **Pagine dinamiche.** Una pagina può ora essere di un "tipo" che si riempie da
  solo (dal menu della pagina → "Tipo di pagina"):
  - **Finestre aperte** — mostra le finestre del PC come tile; toccane una per
    portarla in primo piano (un task-switcher dal telefono/tablet). Si aggiorna
    da sola.
  - **App installate** — le scorciatoie del menu Start come tile; toccane una per
    avviarla.
  - **Widget** — orologio dal vivo e stato del PC (CPU, memoria, tempo di
    accensione).
- **Script dal menu vicino all'orologio.** Dalla tray "Aggiungi uno script…"
  copia un tuo `.ps1/.bat/.exe…` nella cartella di Wdeck; da lì l'host lo propone
  come **suggerimento** nell'editor (azioni Avvia/Script) da applicare a un
  pulsante o a uno slider. C'è anche "Apri la cartella degli script". I file di
  quella cartella sono autorizzati automaticamente, senza doverli aggiungere alla
  whitelist a mano.

### Note

- Le pagine dinamiche (finestre/app) funzionano quando l'host gira su Windows;
  altrove la pagina resta vuota con un avviso.

## [0.8.21] - 2026-08-22

### Aggiunto

- **Gruppi di tasti con label e colore.** Ora puoi raggruppare più tasti sotto
  un nome e un colore comuni, per riconoscere a colpo d'occhio a cosa
  appartengono. I gruppi si creano dalla pagina (tocca il nome della pagina in
  alto → sezione "Gruppi"), poi assegni ogni tasto al suo gruppo dall'editor del
  tasto. Ogni tasto del gruppo mostra una barretta del colore sul lato sinistro e
  sotto le pagine compare una legenda con i nomi dei gruppi.

## [0.8.20] - 2026-08-22

### Aggiunto

- **Swipe fra le pagine sugli schermi touch.** Scorrendo il dito in orizzontale
  (anche sopra i pulsanti) si passa alla pagina successiva o precedente, come
  sfogliare. Per permetterlo, i pulsanti senza azione di "tieni premuto" ora
  scattano al rilascio del dito invece che alla pressione: il pulsante si
  "abbassa" comunque subito, quindi la reattività resta buona.
- **Versione in esecuzione mostrata nella barra in alto**, accanto al nome del
  deck, così si sa sempre quale versione di Wdeck sta girando sull'host.
- **Eliminare un tile ha ora un comando suo:** in modifica, ogni pulsante mostra
  una "×" in alto a destra che lo elimina (con conferma). Aggiungere resta il "+"
  sulle caselle vuote. Aggiungere ed eliminare sono così separati dalla modifica
  dell'azione.

### Corretto

- **Ora si possono riordinare i pulsanti anche su una pagina piena.** Trascinando
  un tile sopra un altro i due si scambiano di posto (prima si poteva spostare
  solo verso le caselle vuote, quindi su una pagina piena sembrava non funzionare
  nulla).
- **Tolta l'eliminazione dall'editor del tile:** la finestra di modifica ora
  riguarda solo cosa fa il pulsante; per eliminarlo si usa la "×" sul tile.
- **La cattura delle scorciatoie ora aspetta l'intera combinazione.** Prima
  registrava al primo tasto premuto, quindi combinazioni come `ctrl+shift+s`
  venivano troncate. Ora si tiene premuta tutta la combinazione: il campo mostra
  dal vivo cosa stai componendo e registra il risultato quando lasci i tasti.
- **Il banner "nuova versione" sparisce in modo più affidabile dopo
  l'aggiornamento.** Il controllo che lo azzera al riconnettersi ora parte sempre
  quando la versione dell'host è cambiata, anche se la pagina non si ricarica.

## [0.8.19] - 2026-08-22

### Migliorato

- **Le finestre dei programmi avviati vengono portate davanti in modo più
  affidabile** anche quando il pulsante è premuto da un altro dispositivo (il
  telefono) o via Desktop Remoto. In quei casi Windows nega il primo piano
  perché sul PC non c'è stato input di recente; ora si usa "minimizza e
  ripristina", che riporta sempre la finestra in primo piano. Può causare un
  breve sfarfallio.

## [0.8.18] - 2026-08-22

### Corretto

- **Il banner "nuova versione disponibile" sparisce dopo un aggiornamento
  riuscito.** Prima poteva restare visibile (fino all'uscita di un'altra
  versione), perché al riconnettersi il controllo automatico è limitato a uno
  ogni 10 minuti. Ora, se al riconnettersi la versione dell'host è cambiata (ci
  si è appena aggiornati), si forza un controllo fresco che azzera il banner.
- **Ripristinato l'avvio dei programmi in primo piano.** Il "tap ALT" introdotto
  in 0.8.17 per forzare il primo piano poteva far comparire la finestra dietro e
  chiuderla: rimosso, si torna al comportamento precedente.

## [0.8.17] - 2026-08-21

### Migliorato

- **Avvio programma: la finestra va davanti anche dalla seconda pressione in
  poi.** Windows concede il primo piano solo a chi ha ricevuto un input di
  recente, quindi dal secondo avvio (o premendo da un altro dispositivo) la
  finestra restava dietro. Ora un breve tap ALT sintetico sblocca il vincolo
  appena prima di alzare la finestra.

## [0.8.16] - 2026-08-21

### Migliorato

- **Avvio programma: la finestra viene portata davvero in primo piano.** Prima,
  soprattutto via Desktop Remoto, l'app poteva aprirsi dietro le altre finestre
  anche quando il sistema riportava "successo" (blocco del foreground di
  Windows). Ora la finestra viene forzata in cima allo Z-order per un istante,
  così compare davanti senza restare sempre-in-primo-piano.

## [0.8.15] - 2026-08-21

### Corretto

- **L'azione HTTP (webhook) può contattare indirizzi locali/privati** (127.0.0.1,
  la rete di casa). Prima erano bloccati dalla protezione anti-SSRF, anche se
  colpire i propri servizi locali (Home Assistant, webhook interni) è un uso
  tipico di un deck. La protezione resta disponibile: basta mettere
  `settings.security.allowPrivateHttp` a `false`.

### Migliorato

- **Aggiornando dal menu della tray si apre il deck con la barra di avanzamento**
  (download, verifica, installazione, riavvio), invece di un'attesa muta: si vede
  che sta procedendo e non è bloccato.

## [0.8.14] - 2026-08-21

### Aggiunto

- **Azione "Riproduci suono" (soundboard).** Un pulsante può far partire un file
  audio (wav, mp3, m4a, aac, ogg, flac, wma) a volume regolabile. Il suono parte
  e il pulsante resta subito libero, così più suoni possono sovrapporsi — utile
  per effetti sonori in diretta o promemoria. (Solo Windows.)

## [0.8.13] - 2026-08-21

### Corretto

- **Avvio programma per nome.** Scrivere solo `explorer.exe`, `notepad.exe`,
  `calc.exe` o `mstsc.exe` (senza percorso) ora funziona come nella finestra
  Esegui di Windows: il nome viene risolto sull'eseguibile già autorizzato nella
  whitelist. Prima veniva cercato nella cartella del deck e non partiva. Risolve
  anche "aprire Esplora file non fa nulla" (azione *Avvia programma* →
  `explorer.exe`).

## [0.8.12] - 2026-08-21

### Corretto

- **Su touch, un messaggio di conferma non si chiude più da solo al rilascio del
  dito.** La pressione apriva il pannello sotto al dito, e il "click" del rilascio
  cadeva sullo sfondo chiudendolo. Ora lo sfondo chiude solo se la pressione
  inizia e finisce su di esso (era il caso "la conferma non resta visibile se non
  tengo premuto").
- **Luminosità: messaggio chiaro quando lo schermo non è regolabile via
  software.** Prima l'errore era output grezzo di PowerShell ("Preparazione dei
  moduli…"); ora dice che lo schermo non supporta la regolazione via software,
  cosa comune sui PC fissi senza DDC/CI e quando si usa il PC da Desktop Remoto.

## [0.8.11] - 2026-08-21

Il menu della tray ora aggiorna davvero.

### Corretto

- **Dal menu vicino all'orologio, "Controlla aggiornamenti" e "Scarica e
  installa" ora funzionano.** Costruivano gli indirizzi come `.../` + `/api/...`,
  ottenendo un **doppio slash** (`//api/...`) che il server non riconosce: il
  controllo riceveva una pagina vuota (per questo la versione non compariva) e
  l'installazione falliva con un **404 "risorsa non trovata"**. Ora tutte le
  chiamate usano una base corretta. Il menu apre anche il deck già autenticato
  (con il token), così non chiede l'accesso ogni volta.

## [0.8.10] - 2026-08-21

Editor più stabile su touch e menu della tray più utile.

### Corretto

- **Su touch, aprendo l'editor di un pulsante la tastiera non compare (né
  lampeggia) più da sola.** Il pannello prendeva il focus su un campo di testo,
  facendo spuntare la tastiera a schermo prima ancora di volerci scrivere. Ora
  il focus va sul pannello e la tastiera appare solo quando tocchi un campo.
- **Menu della tray: "Controlla aggiornamenti" mostra l'esito in una finestra
  visibile.** Prima usava un fumetto di notifica che, con le notifiche o
  l'Assistente notifiche spenti, non compariva: sembrava che non funzionasse.

### Aggiunto

- **Menu della tray: "Apri le impostazioni"** apre il deck nel browser
  direttamente sul pannello delle impostazioni.

## [0.8.9] - 2026-08-21

### Corretto

- **Il pulsante "Scarica e installa" compare subito dopo "Controlla ora".**
  Prima la sezione Aggiornamenti veniva disegnata una volta sola all'apertura
  delle impostazioni: se il controllo trovava una versione nuova mentre il
  pannello era già aperto, il pulsante per installarla non appariva finché non
  si richiudeva e riapriva le impostazioni. Ora la sezione si ridisegna da sola
  appena il controllo finisce.

## [0.8.8] - 2026-08-21

Gli aggiornamenti si fanno notare da soli.

### Corretto

- **All'apertura l'app controlla subito, e per davvero, se c'è una versione
  nuova.** Prima all'avvio mostrava lo stato dell'ultimo controllo periodico
  (che si aggiorna solo ogni 6 ore): capitava di vedere "nessun aggiornamento"
  anche quando ce n'era uno, a meno di premere "Controlla ora". Ora al
  collegamento fa una verifica fresca (silenziosa, al massimo una ogni 10
  minuti) e, se c'è una versione nuova, mostra il banner da solo.

## [0.8.7] - 2026-08-21

Una nuova azione e più controllo sull'aspetto dei pulsanti.

### Aggiunto

- **Azione "Mouse".** Un pulsante può ora fare un clic (sinistro, destro,
  centrale), un doppio clic o scorrere la rotellina (su/giù) alla posizione del
  cursore. Passa dallo stesso canale veloce dei tasti, quindi è immediata.
  (Solo Windows.)
- **Colore del testo del pulsante.** Nell'editor, accanto al colore di sfondo,
  ora si sceglie anche il colore dell'etichetta.

## [0.8.6] - 2026-08-20

Molta più scelta per personalizzare i pulsanti.

### Aggiunto

- **Emoji come icona dei pulsanti.** Nell'editor c'è una tavolozza di emoji e un
  campo dove scriverne o incollarne una qualsiasi: icone colorate e infinite,
  senza dover caricare immagini.
- **Libreria di preset molto più ampia e divisa in categorie** — audio e media,
  sistema, finestre e desktop, modifica, web: da *Muto*, *Play/Pausa* e
  *Screenshot* a *Copia/Incolla/Annulla/Salva*, *Mostra desktop*, *Aggancia
  finestra*, fino a scorciatoie per *YouTube*, *Google* e *Gmail*. Circa 26
  pulsanti pronti da cui partire, poi personalizzabili.

## [0.8.5] - 2026-08-20

Wdeck è molto più reattivo: i tasti rispondono all'istante.

### Corretto

- **Latenza dei tasti media e delle hotkey praticamente azzerata.** Ogni
  pressione avviava un nuovo processo PowerShell che ricompilava a ogni colpo il
  ponte verso il sistema: su alcune macchine erano quasi **900 ms di ritardo per
  pressione**. Ora un processo resta pronto in sottofondo e prepara quel ponte
  **una volta sola**: dalla seconda pressione in poi la risposta è nell'ordine
  del **millesimo di secondo**. Se quel processo non è disponibile si torna,
  senza errori, al metodo di prima. (Disattivabile con `WDECK_KEYSERVER=0`.)

## [0.8.4] - 2026-08-20

Aggiornamenti più chiari e un fastidio in meno tenendo premuto un pulsante.

### Aggiunto

- **Banner di nuova versione** in cima all'app: avvisa quando c'è un
  aggiornamento, mostra le **novità** con un clic, aggiorna, o si chiude con la
  X. Chiuso, resta chiuso finché non riapri l'app (o finché non arriva una
  versione ancora più nuova).
- **Schermata "Novità" dopo l'aggiornamento**: alla prima apertura sulla nuova
  versione, un riepilogo di cosa è cambiato, pensato per chi usa Wdeck.

### Corretto

- **Tenendo premuto un pulsante non compare più il menu del sistema.** Su
  touch (telefono o schermo tattile) il menu contestuale del sistema appariva e
  spariva al rilascio, facendo sembrare rotta la pressione. Ora è disattivato
  sui controlli del deck.
- Il controllo aggiornamenti apre le note della versione invece di una pagina
  esterna.

## [0.8.3] - 2026-08-19

Il client si aggiorna da solo quando è rimasto indietro: niente più pagina
vecchia servita all'infinito dalla cache.

### Corretto

- **Il client stantìo non resta più bloccato su una versione vecchia.** Il
  service worker della PWA serve l'app anche dopo un aggiornamento dell'host, e
  un normale ricaricamento non basta a sostituirlo: la pagina poteva mostrare
  all'infinito una versione vecchia (versione "vuota", "nessun aggiornamento",
  *"esattamente come prima"*). Ora all'avvio il client confronta la propria
  impronta di build con quella dell'host (`/api/health` → `buildId`, che il
  service worker non intercetta): se è più vecchio, **pulisce la cache e si
  ricarica da solo, una volta sola**.
- Il messaggio del controllo aggiornamenti non lascia più la versione in bianco
  quando manca (ricade sul trattino).

### Aggiunto

- `GET /api/health` riporta ora `buildId`, l'impronta della build del client web
  (la stessa del `<meta name="wdeck-build">`).

## [0.8.2] - 2026-08-18

Il controllo aggiornamenti diceva "sei aggiornato" anche quando falliva, e non
diceva mai a che versione fossi.

### Corretto

- **"Controlla ora" non spaccia più un errore per "sei aggiornato".** Se il
  controllo falliva (GitHub irraggiungibile o a corto di richieste), l'host
  segnalava l'errore ma il client mostrava comunque "Nessun aggiornamento
  disponibile". Ora i tre casi sono distinti: controllo **non riuscito** (con il
  motivo), aggiornamento **disponibile**, oppure **già all'ultima versione**.
- **Il messaggio ora mostra la versione.** "Controlla ora" dice a chiare lettere
  a quale versione sei (*"Sei già alla versione più recente (0.8.2)"*) e, quando
  c'è un aggiornamento, quale versione è disponibile.

## [0.8.1] - 2026-08-18

Affidabilità: una sequenza con `continueOnError` non finge più il successo.

### Corretto

- **Le sequenze non nascondono più i passi falliti.** Con `continueOnError` una
  sequenza arriva in fondo anche se dei passi vanno storti, ma prima riferiva
  comunque "sequenza completata": chi guardava il bottone o il log non si
  accorgeva dell'errore. Ora il riepilogo dichiara quanti passi sono falliti
  (es. *"completata con 2 errori su 3 passi"*) e la risposta porta `failed` e
  `failedSteps`. L'esito resta `ok` — la sequenza ha fatto ciò che le era stato
  chiesto — ma non mente più su cosa è successo.

## [0.8.0] - 2026-08-18

Tre cose per rendere l'editor **adatto a tutti**: bottoni pronti da cui partire,
un benvenuto al primo avvio, e un pulsante "Prova" per vedere cosa fa un'azione
prima di salvarla.

### Aggiunto

- **Libreria di preset.** Aggiungendo un pulsante nuovo compare una galleria di
  modelli pronti — Muto, Play/Pausa, Successivo/Precedente, Volume su/giù,
  Screenshot, Blocca PC, Copia, Incolla — con icona e azione già configurate:
  si sceglie, si personalizza se serve, si salva. Resta l'opzione "bottone
  vuoto" per chi vuole partire da zero.
- **Benvenuto al primo avvio.** Con un deck ancora vuoto, un breve messaggio
  offre di creare il primo pulsante (che apre la libreria dei preset), invece
  di lasciare l'utente davanti a una griglia muta. Appare una volta sola.
- **Pulsante "Prova" nell'editor.** Esegue l'azione in **dry-run** e mostra cosa
  farebbe, senza salvarla né toccare il sistema. Nuovo endpoint
  `POST /api/action/test` (dry-run sempre forzato).

### Note

I preset sono pensati per Windows; le azioni non disponibili sulla piattaforma
restano comunque "provabili" in dry-run.

## [0.7.3] - 2026-08-17

Editor dei pulsanti **guidato**: niente più JSON scritto a mano per i casi
normali. Ogni azione dichiara i propri campi e l'editor mostra menù, cursori e
interruttori adatti; il JSON resta a disposizione sotto un interruttore
"Avanzato", per chi vuole metterci mano.

### Aggiunto

- **Form guidato per i parametri delle azioni.** Ogni azione espone uno schema
  di campi (`fields`: etichetta, tipo, opzioni, limiti, default). L'editor lo
  traduce in controlli veri: menù a tendina per le scelte (es. il tasto media),
  campi numerici con minimo/massimo (volume, luminosità), interruttori per gli
  on/off, cattura della combinazione per le hotkey, elenco di profili e pagine
  per la navigazione. Vale sia per la pressione normale sia per quella prolungata.
- **Modalità "Avanzato (JSON)".** Un interruttore rivela il JSON grezzo dei
  parametri, sincronizzato con il form: per i parametri complessi (sequenze,
  intestazioni HTTP) l'editor lo segnala e rimanda qui.

### Corretto

- I valori delle opzioni tipati (booleani, numeri: `mute`, `qos`...) ora
  vengono salvati con il tipo giusto e non come stringa, così l'host non li
  rifiuta.

### Note

Le azioni con parametri a lista o a oggetto (`sequence`, gli header di `http`)
restano configurabili solo dalla modalità JSON, che l'editor indica quando serve.

## [0.7.2] - 2026-08-17

Aggiornamento con **finestra di avanzamento**: cliccando "Scarica e installa"
compare un pannello in stile con una barra che avanza fase per fase, invece
dell'avviso grezzo del browser e di un'attesa muta.

### Aggiunto

- **Barra di avanzamento dell'aggiornamento.** La conferma non e' piu' l'`alert`
  del browser ma un pannello dell'app; una volta accettato, diventa una finestra
  di caricamento che mostra le fasi reali - scaricamento (con i MB), verifica
  dell'impronta, verifica della firma, installazione, riavvio. L'host trasmette
  ogni fase via WebSocket (`event: "update-progress"`), il client la disegna.

### Note

L'installazione resta **per-utente** (in `%LOCALAPPDATA%\Programs\Wdeck`), come
fanno Chrome, VS Code e Discord: nessun UAC, l'aggiornamento si applica da solo
e riparte. E' la scelta che tiene l'auto-update senza chiedere i diritti di
amministratore a ogni versione.

## [0.7.1] - 2026-08-17

Correzione del riavvio dopo l'aggiornamento e firma delle release con
verifica "a pin", cosi' l'aggiornamento automatico funziona anche senza un
certificato comprato.

### Corretto

- **Dopo l'aggiornamento l'app si apriva e si richiudeva da sola**, e bisognava
  riaprirla a mano. Il riavvio lanciava il nuovo processo senza aspettare che
  il vecchio avesse chiuso: per un istante la porta restava occupata, il nuovo
  la trovava presa (`EADDRINUSE`) e usciva subito. Ora il riavvio **attende** la
  chiusura prima di ripartire, e l'avvio **ritenta** il bind per qualche secondo
  se la porta e' ancora occupata (vale anche se per sbaglio partono due istanze).

### Sicurezza

- **Firma delle release con verifica "a pin".** Dalla 0.7.0 l'aggiornamento
  automatico pretendeva una firma Authenticode pienamente fidata dal sistema:
  giusto in teoria, ma senza un certificato comprato (con verifica d'identita')
  nessun binario la superava, e l'auto-update restava di fatto bloccato. Ora la
  verifica confronta l'**impronta del certificato** con quella del progetto
  (*certificate pinning*): un certificato self-signed, che nessun PC conosce,
  va bene lo stesso - purche' sia **quello giusto** e la firma sia integra.
  Un file manomesso (`HashMismatch`) o firmato da chiunque altro resta rifiutato,
  senza dover installare nulla come radice fidata su ogni macchina.
- `npm run installer` ora **firma anche l'installer**, non solo l'eseguibile che
  contiene: e' il file che l'utente scarica ed esegue per primo.

### Note

Il pinning ha un prezzo: se un giorno il certificato cambia, le versioni
pubblicate con quello nuovo non saranno aggiornabili in automatico da chi sta
su una versione vecchia, che andra' reinstallata a mano una volta. E' il
compromesso che rende sicura la fiducia in un certificato che il sistema non
conosce.

L'exe di questa release **non** e' fidato da SmartScreen: un certificato
self-signed cifra e identifica l'editore verso l'auto-update, ma non porta la
reputazione che solo un certificato OV/EV di una CA puo' dare. Al primo avvio
Windows puo' ancora avvisare; l'aggiornamento automatico, invece, ora funziona.

## [0.7.0] - 2026-08-17

Revisione di sicurezza e robustezza a tappeto: otto sottosistemi riletti uno
per uno (sicurezza, server/WebSocket, azioni, adattatori di piattaforma,
configurazione e aggiornamento, integrazioni, client web, firmware). Nessuna
funzione nuova per l'utente; tutto quello che segue chiude un difetto che i
test del percorso felice non vedevano, e ognuno arriva con la sua verifica. La
suite passa da 465 a 526 controlli.

### Sicurezza

- **L'editor non puo' piu' toccare la sicurezza, mai.** La fusione delle
  modifiche in arrivo dall'editor riportava il blocco `settings.security` dal
  disco **solo se gia' presente**: un `deck.json` minimale, senza quel blocco,
  lasciava passare un `security` inviato dal client (per esempio
  `requireToken:false`, un token, o una `allowExec` piu' larga). Ora il blocco
  in arrivo viene **scartato incondizionatamente** prima della fusione, che ci
  sia o no un blocco su disco.
- **L'aggiornamento automatico verifica la firma Authenticode.** Fino alla 0.6.0
  l'exe scaricato era controllato solo contro `SHA256SUMS.txt`, preso dalla
  stessa origine del binario: integrita' nel trasporto, ma nessuna prova di chi
  l'ha prodotto. Su Windows ora si verifica la **firma del codice** dell'exe
  (`Get-AuthenticodeSignature`, esito `Valid`) **prima** di sostituire il
  binario in uso, e ci si ferma se manca. Il controllo SHA-256 resta come
  seconda barriera. *Conseguenza da conoscere: un binario di release **non
  firmato** viene rifiutato dall'aggiornamento automatico (scelta prudente, a
  prova di errore).* Il download segue i redirect solo se restano `https:` e si
  interrompe se il corpo supera la dimensione dichiarata dalla release.
- **Il PIN di pairing non si forza piu' ruotando gli indirizzi.** Il limite sui
  tentativi di accesso era solo per indirizzo: con IPv6 si cambia indirizzo a
  costo zero e si percorreva l'intero spazio del PIN. Ora gli indirizzi IPv6
  contano **per prefisso /64** e c'e' un **tetto complessivo** ai tentativi di
  accesso, indipendente dall'indirizzo.
- **I segreti non filtrano piu' nel registro di audit.** La redazione agiva solo
  sui campi con nomi noti; un token dentro un valore - `?token=...`,
  `Authorization: Bearer ...` - finiva in chiaro. Ora si ripuliscono anche i
  **valori** delle stringhe.
- **La whitelist degli eseguibili risolve i collegamenti.** `checkExecutable`
  confrontava il percorso normalizzato ma non seguiva i symlink: un collegamento
  dentro una cartella ammessa, puntato a un binario vietato, passava. Ora si
  risolve il percorso reale (`realpath`) prima del confronto.
- **L'azione `http` non raggiunge piu' la rete interna.** Mancava qualunque
  limite sulla destinazione: un bottone poteva puntare a `169.254.169.254` o a
  `127.0.0.1:<porta>` e parlare con servizi interni (SSRF). Ora loopback,
  link-local e reti private sono **bloccati per definizione**, e la
  destinazione e' ricontrollata a ogni redirect.
- **Gli argomenti dei `.bat`/`.cmd` non passano piu' inosservati a `cmd.exe`.**
  Erano riparsati dalla shell dei comandi, quindi un `&`, un `|` o un `%`
  diventavano un secondo comando. Ora un argomento con metacaratteri viene
  rifiutato con un errore chiaro.
- Certificato autofirmato: gli indirizzi **IPv6** finiscono come `iPAddress`
  nel SAN (prima erano scritti come nomi DNS, e il certificato non valeva per
  chi si collegava a un indirizzo IPv6); la chiave privata riottiene i permessi
  `0600` anche quando viene rigenerata sopra una precedente.

### Corretto

- **Un'azione che falliva sul WebSocket poteva spegnere l'host.** Il ramo
  `press` eseguiva l'azione senza rete di protezione (a differenza di
  `navigate`): un rifiuto diventava una promessa non gestita, e in Node questo
  puo' terminare il processo. Ora l'errore torna al client come messaggio.
- **Un client lento poteva esaurire la memoria dell'host.** Le scritture sul
  socket ignoravano la contropressione: un lettore fermo faceva crescere il
  buffer di uscita senza limite. Ora oltre un tetto la connessione viene chiusa.
- **Il canale MQTT poteva restare appeso per sempre.** Se il broker accettava la
  connessione TCP e poi la chiudeva prima della conferma, l'attesa non si
  risolveva mai. Ora quella chiusura fa fallire la connessione con un errore.
- **La stretta di mano di chiusura WebSocket veniva troncata**, e i frame di
  testo con byte UTF-8 non validi erano accettati con caratteri sostitutivi
  invece di chiudere con il codice 1007, come vuole la norma.
- **Un `deck.json` malformato dall'editor restituiva un 500** invece di un
  errore di validazione ordinato: la compattazione girava prima della
  validazione e dava per scontate strutture che potevano mancare.
- **Il refresh del token Spotify partiva piu' volte in parallelo** sotto una
  raffica di pressioni; il socket di Discord restava aperto se
  l'autenticazione veniva rifiutata; un cursore senza `span` esplicito passava
  la validazione come largo una cella e ne occupava due a video.
- Confusione fra opzioni e argomenti in `open`/`xdg-open` e in `ydotool` per
  testi che iniziano con `-`; testo su piu' righe non digitabile su macOS;
  processi che ignoravano il segnale di chiusura al timeout ora ricevono un
  `SIGKILL` dopo una breve tregua.

### Client web

- L'app segnala quando l'host non e' raggiungibile invece di fallire in
  silenzio: "Salva" avvisa, l'editor non apre un pannello vuoto.
- I cursori si regolano da **tastiera** (frecce, Home/Fine) e non rubano piu'
  le frecce alla navigazione fra pagine; le finestre modali trattengono il
  fuoco e lo restituiscono alla chiusura; i toast di errore sono annunciati.
- Il service worker non attiva piu' una shell incompleta e avvisa quando una
  nuova versione e' pronta al ricaricamento.

### Firmware ESP32

- **La riconnessione al Wi-Fi non blocca piu' il resto.** L'attesa poteva
  fermare per venti secondi il ciclo principale, e con esso il WebSocket, i
  ping e il tocco. Ora si riprova senza bloccare, e nel frattempo tutto il
  resto continua a girare.
- Le richieste HTTP hanno un **timeout** e non partono piu' da dentro la
  callback del WebSocket; il documento JSON in arrivo e' limitato
  (`WDECK_JSON_CAPACITY` ora e' davvero applicato); riga e colonna di un
  bottone vengono validate contro la griglia.

### Note

Come sempre, compilare non e' collaudare: le correzioni al firmware sono
verificate dal test di conformita' che rilegge il sorgente, non da una scheda
accesa. Timeout, riconnessione non bloccante e lettura del corpo HTTP a
dimensione limitata restano da provare su hardware vero.

La verifica Authenticode presuppone che i binari di release siano firmati. Chi
distribuisce build non firmate deve saperlo: l'aggiornamento automatico le
rifiuta di proposito, perche' un exe non firmato e uno manomesso, da fuori, si
somigliano troppo. Per questo `npm run exe` ora **firma da solo** quando trova
un certificato (`WDECK_SIGN_PFX`/`WDECK_SIGN_PASSWORD` o `WDECK_SIGN_THUMBPRINT`)
e avverte quando non c'e'; i dettagli sono nel README, sezione *Firma del
codice*.

## [0.6.0] - 2026-08-14

### Aggiunto

- **`WdeckSetup.exe`: un'installazione normale.** Procedura guidata in italiano
  e inglese, icona sul desktop e nel menu Start, avvio automatico facoltativo,
  disinstallazione registrata in *App e funzionalita'*. Si installa per utente
  in `%LOCALAPPDATA%\Programs\Wdeck`, quindi **non chiede l'UAC**.
  Disinstallando restano `deck.json` e le icone caricate dall'utente: sono
  lavoro suo, non file di programma.
- **Icona vera** (`installer/wdeck.ico`), costruita dalle stesse forme
  dell'icona della PWA in otto misure, da 16 a 256 pixel. Da Vista in poi un
  `.ico` puo' contenere PNG, quindi si riusa l'encoder che il progetto ha gia':
  nessun convertitore esterno.
- `npm run installer` e `node scripts/gen-ico.mjs`.

### Corretto

- **`wdeck.exe` apriva una finestra del terminale e la lasciava aperta.**
  `node.exe` e' compilato come applicazione a console: un eseguibile costruito
  con SEA eredita quella natura, e chi lo lanciava con un doppio clic si
  ritrovava una finestra nera al posto di un programma. Nell'intestazione PE un
  campo di due byte distingue le due cose: ora la build lo porta da 3 (console)
  a 2 (grafico). Cambiano due byte e nient'altro - il codice eseguito e'
  identico.

  Senza terminale, pero', un errore all'avvio non lo vedrebbe piu' nessuno:
  quando non c'e' una console il diario finisce in
  `%LOCALAPPDATA%\Wdeck\wdeck.log`, ruotato a 1 MB.

### Note

Da qui viene anche l'unico effetto collaterale: i comandi da riga di comando
dell'eseguibile (`--list-devices`, `--help`) non hanno piu' un terminale su cui
scrivere e finiscono nel diario. Dai sorgenti la CLI resta quella di sempre.

## [0.5.0] - 2026-08-14

### Aggiunto

- **`wdeck.exe` si aggiorna da solo**, su richiesta: scarica l'ultima release,
  **ne verifica lo SHA-256** e si sostituisce, poi riavvia. Dal client
  (*Impostazioni -> Aggiornamenti*), dalla tray o da `POST /api/update/apply`.
  Fino alla 0.4.0 l'host sapeva solo dire che una versione nuova esisteva, e
  scaricarla restava un lavoro a mano.

  Tre cautele, perche' qui si sovrascrive un binario sul PC di qualcun altro:

  1. **Non parte mai da solo.** Il controllo periodico segnala e basta; si
     scarica solo quando qualcuno lo chiede. Non esiste un aggiornamento
     silenzioso in sottofondo, e non e' previsto.
  2. **Impronta verificata** contro `SHA256SUMS.txt` pubblicato accanto alla
     release. Se manca, o non corrisponde, ci si ferma **prima** di toccare
     l'eseguibile in uso. Senza, ci si fiderebbe solo del TLS.
  3. **La versione precedente resta** come `wdeck.exe.vecchio`, cancellata al
     primo avvio riuscito: se la nuova non parte, si rinomina indietro.

  Dai sorgenti la funzione non si attiva e lo dice: li' si aggiorna con
  `git pull`, e riscrivere i file di un checkout altrui sarebbe un pessimo modo
  di rendersi utili.
- **`npm run checksums`** scrive `release/SHA256SUMS.txt` nel formato di
  `sha256sum`, verificabile anche a mano con `sha256sum -c`.

### Note

L'aggiornamento automatico era elencato in ROADMAP fra gli **esclusi per
scelta**, e lo era per un vincolo esplicito di chi ha commissionato il lavoro.
La richiesta e' cambiata; la cautela no, ed e' per questo che si scarica solo su
richiesta e solo dopo aver verificato cosa si e' scaricato.

## [0.4.0] - 2026-08-14

### Aggiunto

- **`wdeck.exe`, eseguibile singolo per Windows** (`npm run exe`). Un file solo,
  ~84 MB, che parte con un doppio clic su un PC dove Node.js **non e'
  installato**: il runtime viaggia dentro, tramite le *Single Executable
  Applications* di Node 20+. Serviva per poter dare Wdeck a qualcuno senza
  chiedergli di installare nulla.
  Alla prima esecuzione riversa i moduli in
  `%LOCALAPPDATA%\Wdeck\runtime\<impronta>\` e semina `deck.json` un livello
  sopra, **fuori** dai file estratti, cosi' un exe piu' recente non porta via la
  configurazione. L'impronta e' l'hash del contenuto: due versioni convivono e
  un exe identico non ripete l'estrazione.
- **Firmware ESP32 gia' compilato** (`npm run firmware`): produce
  `release/firmware/*.bin` — firmware, bootloader e tabella delle partizioni —
  per tutte e tre le schede supportate. Prima il firmware era solo sorgente.

### Corretto

- **L'ambiente `esp32s3-st7789` non compilava.** `handleTouch()` chiamava
  `tft.getTouch()` senza condizioni, ma TFT_eSPI genera quella funzione solo
  quando `TOUCH_CS` e' definito — e quell'ambiente e' proprio quello del display
  **senza** touch. Il codice del tocco ora sta dietro `#ifdef TOUCH_CS`.
  Un errore rimasto invisibile finche' nessuno ha compilato: i test di
  conformita' al protocollo leggono il sorgente, non lo compilano.

- **La CI falliva su Node 20.10** (e solo li'): `scripts/sea-entry.cjs` chiedeva
  `node:sea` all'apertura, ma quel modulo esiste dalla 20.12, e il test che lo
  importa esplodeva. Ora il `require` e' dentro un try/catch: fuori da un
  eseguibile il file resta una libreria importabile ovunque. `npm run exe`
  controlla la versione e lo dice chiaro; l'host continua a girare dalla 20.10.
  Trovato dalla CI al suo primo giro vero, su una versione di Node che in locale
  non c'e'.

- **`npm test` non trovava nulla su Windows con Node 20.10.** Lo script era
  `node --test test/*.test.mjs`, e quel glob lo espande la shell: `cmd` e
  PowerShell non lo fanno, e Node ha imparato a farlo da se' solo dalla 21. Su
  quella combinazione la suite usciva con "Could not find" invece di eseguire
  443 verifiche — e nessuno se n'era accorto perche' la CI non era mai girata.
  Ora l'elenco dei file lo costruisce `scripts/test.mjs`, e un test impedisce a
  qualunque script di package.json di tornare a dipendere dal glob della shell.

### Note

Compilare non e' collaudare. Il firmware ora si costruisce per tre schede, ma
non e' mai stato **eseguito** su hardware: pin, rotazione e taratura del touch
restano da verificare su una scheda accesa.

`postject`, usato per scrivere il blob dentro il binario, e' uno strumento da
banco di lavoro scaricato da `npx` solo durante `npm run exe`: non e' una
dipendenza, non compare in `package.json` e l'host non lo importa mai. Il
vincolo di zero dipendenze a runtime resta verificato da `npm run check:deps`.

## [0.3.0] - 2026-08-13

### Aggiunto

- **Italiano e inglese.** L'interfaccia si traduce da `settings.ui.language`
  (`it`, `en`, `auto` per seguire il browser) e dal pannello Impostazioni. Le
  due lingue sono tenute allineate da un test: una chiave presente in una sola
  comparirebbe nella lingua sbagliata senza che nessuno se ne accorga.
- **Pressione prolungata configurabile dall'editor.** `holdAction` esisteva da
  sempre ma andava scritta a mano in `deck.json`; ora ha la sua sezione, con
  l'azione e i suoi parametri. E' comoda per mettere l'opposto sullo stesso
  tasto - accendi e spegni - senza occupare due celle.
- Tema e lingua si cambiano da *Impostazioni -> Aspetto*, senza toccare il file.

### Corretto

- **`ui.theme: "light"` non forzava il tema chiaro.** Il CSS aveva la tavolozza
  chiara solo dentro `prefers-color-scheme`, quindi valeva unicamente con
  `"auto"` e con un sistema impostato su chiaro. Ora `light` la impone e `auto`
  la segue, come dicevano entrambi di fare.

### Note

Sull'ESP32 la pressione prolungata resta non supportata: il firmware non
distingue un tocco lungo da uno breve, e aggiungerlo richiederebbe di provarlo
su hardware vero.

## [0.2.10] - 2026-08-13

### Aggiunto

- **MQTT**, **Spotify** e **Discord**: le tre integrazioni che la roadmap
  dichiarava assenti. Nessuna integrazione inclusa usa piu' l'azione `stub`.
- **`mqtt`**: client MQTT 3.1.1 scritto sui socket di Node (CONNECT, PUBLISH,
  SUBSCRIBE, DISCONNECT, QoS 0 e 1, `mqtt://` e `mqtts://`). MQTT e' il modo con
  cui parla mezza domotica - Home Assistant, Zigbee2MQTT, Tasmota, ESPHome -
  quindi copre molto piu' di quanto avrebbe coperto un'integrazione per marca.
  Con `stateTopic` il bottone mostra anche lo stato reale letto dal broker.
- **`spotify`**: riproduzione, brano, volume, casuale, ripetizione, spostamento
  su un altro dispositivo, riproduzione di un URI. Passa dalla Web API e non
  dai tasti multimediali perche' quelli agiscono su qualunque lettore abbia il
  fuoco: l'API comanda l'account, quindi funziona anche se la musica sta
  suonando sul telefono o su un altoparlante in un'altra stanza. Il refresh
  token si configura una volta; l'access token orario resta in memoria.
- **`discord`**: messaggi in un canale via webhook, e comandi su microfono e
  cuffie attraverso il canale locale del client Discord (named pipe su Windows,
  socket unix altrove).
- Tutte e tre dichiarano `readState`, quindi i loro bottoni mostrano la
  condizione vera e non l'ultima pressione.

### Corretto

- **Il client MQTT perdeva le risposte piu' veloci di lui.** Le attese venivano
  registrate dopo aver scritto sul socket: un broker sulla stessa macchina puo'
  rispondere nello stesso giro di eventi, e un messaggio "retained" arriva
  spesso nello stesso pacchetto TCP della conferma di iscrizione. Il difetto e'
  emerso col broker finto dei test, che parla il protocollo vero.

### Note

Sui limiti di Discord il progetto non promette piu' di quanto puo' mantenere:
il webhook funziona subito, mentre i comandi sulla voce richiedono
un'applicazione registrata e uno scope che Discord concede su richiesta. Senza,
il client risponde con un errore, che viene riportato tale e quale invece di far
finta di aver funzionato.

## [0.2.9] - 2026-08-13

### Aggiunto

- **QR code per accoppiare il telefono.** Si inquadra e il deck si apre gia'
  collegato: niente indirizzo da digitare, niente PIN. Il codice compare nel
  terminale all'avvio e in *Impostazioni -> Collega un altro dispositivo*.
  Nuovo endpoint `GET /api/pair/qr`.
- Ogni codice porta con se' un **token dedicato**, non quello principale:
  mostrarlo a qualcuno che passa non regala la chiave di casa, e cio' che e'
  stato inquadrato una volta si revoca da solo.
- **Generatore di QR scritto nel progetto** ([`shared/qr.mjs`](shared/qr.mjs)):
  modalita' byte, versioni 1-10, quattro livelli di correzione, scelta
  automatica della maschera fra le otto previste. Reed-Solomon su GF(256),
  informazioni di formato con BCH, resa in SVG e in caratteri a blocchi per il
  terminale. Nessuna libreria.
- **Scoperta in rete locale (mDNS)**: l'host si annuncia come `<nome>.local` e
  come servizio `_wdeck._tcp.local`. Serve a una cosa concreta: quel nome non
  cambia quando il router riassegna gli indirizzi, e macOS, iOS, Windows 10+ e
  Android recente lo risolvono senza installare nulla.
- `--no-qr` per non stampare il codice all'avvio; `settings.discovery` per il
  nome annunciato e per spegnere l'annuncio.

### Note

Il QR e' scritto da zero, quindi e' verificato contro riferimenti esterni e non
solo contro se stesso: il polinomio generatore di Reed-Solomon coincide con i
coefficienti elencati dalla norma, le codeword di correzione coincidono con
l'esempio della norma (`01234567` in versione 1 livello M), e la tabella dei
blocchi e' confrontata con le codeword ricavate dalla geometria per tutte e
quaranta le combinazioni versione/livello. Un errore di trascrizione non passa.

Se la porta 5353 e' gia' occupata da Bonjour o avahi, l'host lo segnala e
prosegue senza annuncio: non e' un motivo per non partire.

## [0.2.8] - 2026-08-13

### Sicurezza

- **HTTPS e WSS opzionali**, con certificato autofirmato generato all'avvio.
  Senza cifratura il token viaggia in chiaro dentro l'URL che si apre sul
  telefono: chiunque sia sulla stessa rete Wi-Fi puo' leggerlo e usare il deck.
  Si attiva con `--tls`, `WDECK_TLS=1` o `settings.server.tls.enabled`.
- La struttura X.509 e' **costruita nel progetto**: Node sa generare le chiavi
  e sa firmare, ma non sa comporre un certificato, e quel pezzo di solito lo
  mette una libreria o `openssl` come processo esterno. Qui non si poteva fare
  ne' l'uno ne' l'altro, quindi il DER e' scritto a mano in
  [`security/selfsigned.mjs`](src/host/security/selfsigned.mjs). Il vincolo di
  zero dipendenze resta intatto.
- Il certificato copre `localhost`, `127.0.0.1` e gli indirizzi IPv4 della
  macchina, e viene **rigenerato** quando scade o quando quegli indirizzi
  cambiano: dopo un cambio di rete o l'aggancio a una dock, un certificato che
  non copre il nuovo indirizzo sarebbe inutile proprio dove serve.
- Chi ha un certificato vero lo indica con `certFile` e `keyFile`: in quel caso
  l'host non genera nulla.
- Un errore nella configurazione TLS non lascia l'host spento: viene segnalato
  e si prosegue in HTTP.
- Il client WebSocket accetta ora `rejectUnauthorized: false`, che serve a
  collegarsi a un host con certificato autofirmato.

### Note

Il certificato **non e' fidato da nessuna autorita'**: la prima volta il browser
mostra un avviso, da accettare una volta per dispositivo. Serve a cifrare il
traffico in LAN, non a dimostrare l'identita' dell'host - ma il traffico in
chiaro era il problema piu' grosso rimasto.

I test rileggono il certificato con `crypto.X509Certificate`, cioe' con lo
stesso parser che useranno i browser, e poi lo usano davvero su un server HTTPS
con WebSocket sopra: se la struttura ASN.1 fosse sbagliata, nessuna delle due
cose funzionerebbe.

## [0.2.7] - 2026-08-13

### Sicurezza

- **Registro di audit persistente.** Wdeck esegue programmi sul PC su richiesta
  della rete locale: se qualcosa va storto, i log della console non aiutano
  perche' spariscono alla chiusura. Ora ogni azione lascia una riga accanto a
  `deck.json` con chi l'ha chiesta, da dove, con quale esito e in quanto tempo.
- Registrati anche gli eventi di sicurezza: `pair`, `pair-failed`,
  `device-created`, `device-revoked`, `token-rotated`, `rate-limited`.
- Formato JSONL, una riga per evento: si legge con `tail`, si filtra con `grep`,
  e un file troncato da un arresto improvviso costa una riga, non il registro.
  Rotazione a 1 MB con tre copie conservate.
- **Token, PIN e password non ci finiscono mai**: i campi con quei nomi sono
  sostituiti da `[omesso]` prima della scrittura, anche dentro i parametri
  liberi di un'azione, dove un header di autorizzazione puo' capitare.
- `GET /api/audit` (con `limit` ed `event`) e `settings.security.audit`.

### Corretto

- **Anche `npm run test:esp32` girava sulla `deck.json` dell'utente.** Come lo
  smoke test, ora usa una copia temporanea: da questa versione l'host scrive
  accanto alla configurazione, e una verifica non deve lasciarci nulla.
- Due difetti trovati dai test appena scritti: una riga rimasta a meta' per un
  arresto improvviso si portava via anche la riga successiva (che le veniva
  appesa di seguito), e subito dopo una rotazione la scrittura falliva perche'
  cercava di leggere la fine di un file appena spostato.

### Note

Ai client il registro non arriva: l'evento WebSocket `press` continua a portare
la forma ridotta di sempre. L'identificativo del dispositivo di un altro non
riguarda chi sta guardando il deck.

## [0.2.6] - 2026-08-13

### Sicurezza

- **Un token per dispositivo, revocabile da solo.** Il pairing con PIN non
  consegna piu' il token principale: crea una credenziale dedicata a quel
  telefono. Prima bastava un telefono perso per dover cambiare il token a
  tutti.
- **Scadenza facoltativa**: `days` alla creazione, oppure
  `settings.security.deviceTokenDays` come predefinito. `--prune-devices` toglie
  i scaduti.
- In `deck.json` resta la sola **impronta SHA-256**: chi legge il file non puo'
  ricavare le credenziali dei dispositivi. Il token si vede una volta sola, in
  risposta a chi lo ha chiesto.
- **La revoca scollega subito** i client che stavano usando quella credenziale.
  Lasciarli collegati fino alla disconnessione avrebbe significato non revocare
  niente per tutta la durata della sessione.
- **Rotazione del token principale** finalmente esposta: `POST /api/token/rotate`,
  il bottone in *Impostazioni* del client, e da riga di comando **senza avviare
  l'host** - che e' proprio il caso in cui serve, se il token e' andato perduto.
- Nuovi comandi CLI: `--rotate-token` (con `--revoke-devices`), `--list-devices`,
  `--add-device <nome>` (con `--days`), `--revoke-device <id>`, `--prune-devices`.
  `--add-device` serve all'ESP32, che il PIN non sa digitarlo.
- Nuovi endpoint `GET`/`POST`/`DELETE /api/devices`.
- Una revoca **scritta a mano** in `deck.json` vale alla ricarica a caldo: prima
  un token tolto dal file continuava a funzionare fino al riavvio.

### Corretto

- **Lo smoke test scriveva nel `deck.json` dell'utente.** Da quando il pairing
  crea un dispositivo, la verifica lasciava una voce nella configurazione di chi
  la lanciava. Ora gira su una copia temporanea: prova la configurazione vera,
  che e' il senso di uno smoke test, senza toccarla.

### Note

Ruotare il token principale **non** revoca i dispositivi accoppiati, a meno di
chiederlo con `revokeDevices`: cambiare la chiave di casa non deve buttare fuori
chi ha gia' la sua.

Il token principale finisce in `deck.json` solo quando viene davvero ruotato:
accoppiare un telefono non deve scrivere nel file una credenziale che l'utente
non ci aveva messo.

## [0.2.5] - 2026-08-13

### Sicurezza

- **Limiti di frequenza**, con il codice `rate_limited` che il protocollo
  definiva da sempre senza che nulla lo usasse. Due limiti indipendenti a
  finestra scorrevole: 60 comandi ogni 10 secondi e 10 tentativi di accesso
  ogni 5 minuti. Oltre il tetto la risposta e' `429` con `Retry-After`, e sul
  WebSocket un messaggio `error` con lo stesso codice.
- Un PIN di quattro cifre sono diecimila combinazioni: senza limite si provano
  in pochi secondi, ed era il punto piu' debole del pairing.
- **Anche i token rifiutati contano come tentativi di accesso**: tenere due
  contatori separati avrebbe lasciato aperta la via di provare direttamente i
  token invece del PIN.
- Un accesso riuscito azzera i tentativi di quell'indirizzo: chi conosce il PIN
  non deve pagare per i tentativi di chi non lo conosce.
- La tabella dei contatori ha un tetto di chiavi: senza, sarebbe stata a sua
  volta una via per esaurire la memoria dell'host.
- Taratura da `settings.security.rateLimit` (`enabled`, `press`, `auth`).

### Note

Il limite si conta per dispositivo autenticato quando c'e', altrimenti per
indirizzo: dietro un NAT tutti i telefoni di casa condividono l'indirizzo, e
limitarli insieme punirebbe l'innocente per il vicino.

`test/ratelimit.test.mjs` inietta l'orologio: aspettare davvero cinque minuti
per vedere scadere una finestra avrebbe reso la suite inservibile.

## [0.2.4] - 2026-08-13

### Aggiunto

- **L'editor visuale copre tutto il deck.** Oltre a bottoni e cursori si possono
  ora creare, rinominare, riordinare ed eliminare **pagine e profili**, cambiare
  la dimensione della griglia, scegliere pagina e profilo iniziali e **spostare
  i controlli trascinandoli** in un'altra cella. Prima per queste cose serviva
  aprire `deck.json` a mano.
- **Icone personalizzate** caricate dall'utente: PNG, JPEG, WebP, GIF o SVG,
  fino a 192 KB e 64 in tutto. Finiscono in `icons/` accanto a `deck.json` e si
  usano come `"icon": "custom:mio-logo"`. Nuovi endpoint `GET`/`POST`/`DELETE
  /api/icons` e `GET /api/icons/file`.
- Nell'editor si sceglie l'icona da una griglia che mostra insieme i glifi
  inclusi e quelli caricati, e si puo' decidere se un controllo debba mostrare
  lo stato reale.

### Corretto

- **Gli override di avvio finivano dentro `deck.json`.** Il salvataggio partiva
  dal deck in memoria, che porta con se' `--port`, `--token` e le variabili
  `WDECK_*`: al primo salvataggio dall'editor quei valori diventavano
  permanenti, e chi avviava su una porta effimera si ritrovava una
  configurazione perfino invalida. Ora la base e' il file cosi' com'e' su disco
  ([`ConfigStore.snapshot()`](src/host/config/loader.mjs)). Vale anche per
  `POST /api/settings`. Il difetto e' emerso scrivendo i test dell'editor, ed e'
  coperto da due test di regressione.
- Un salvataggio riuscito da `POST /api/settings` non avvisava i client
  collegati: ora rimanda il deck aggiornato come fa `POST /api/deck/save`.

### Sicurezza

Il formato di un'icona e' riconosciuto **dai byte**, non da quanto dichiara il
client. Gli SVG - l'unico formato accettato che possa contenere codice -
passano da una pulizia che toglie `<script>`, `<foreignObject>`, i gestori
`on*`, gli URL `javascript:`, i riferimenti esterni e le entita' XXE; se dopo la
pulizia resta qualcosa di eseguibile il caricamento e' rifiutato. Il file e'
poi servito con `nosniff` e una `Content-Security-Policy` restrittiva. I nomi
sono slug, quindi il path traversal non ha da dove passare.

### Note

Il campo `status` sui controlli e il riferimento `custom:` nel campo `icon` sono
entrambi opzionali: le configurazioni esistenti si caricano identiche.

## [0.2.3] - 2026-08-13

### Aggiunto

- **L'host non e' piu' solo-Windows.** `media`, `hotkey`, `text`, `url`,
  `volume` e `mic` funzionano ora anche su macOS e su Linux. Prima fuori da
  Windows rispondevano `501`.
- Nuova facciata [`src/host/platform/input.mjs`](src/host/platform/input.mjs):
  gli handler non contengono piu' alcun `if (process.platform === ...)`, e ogni
  operazione ha una coppia `plan*` (descrive, per il dry-run) / `send*` (esegue).
  Stessa cosa per l'audio in `platform/audio.mjs`.
- Adattatore macOS (`osascript`): tasti e testo via System Events, volume e muto
  via `set volume`, play/pausa/brano inoltrati al primo lettore attivo fra
  Spotify, Music e TV. Se manca il permesso Accessibilita', l'errore lo dice.
- Adattatore Linux: `xdotool` su X11 e `ydotool` su Wayland (scelti in base a
  `XDG_SESSION_TYPE`), `pactl` con ripiego su `amixer` per il volume,
  `playerctl` con ripiego sul tasto multimediale per la riproduzione,
  `xdg-open` per gli URL. Quando uno strumento manca, l'errore dice quale
  pacchetto installare invece di fallire in modo oscuro.
- L'azione `script` esegue anche i file `.sh`, che e' cio' che serviva perche'
  la sua dichiarazione `platforms: ['*']` fosse vera.
- `test/platform.test.mjs`: 34 verifiche sulle mappe dei tasti, sulla scelta
  degli strumenti e sulla facciata. Le mappe sono moduli puri, quindi la
  traduzione per macOS e Linux e' verificata anche dalla macchina Windows su
  cui il progetto e' nato, e dalla CI su tutti e tre i sistemi.

### Note

**Il percorso Windows non e' stato toccato**: gli stessi script PowerShell, le
stesse funzioni di `platform/windows.mjs`. La facciata li richiama tali e quali.

Restano dichiarate solo per Windows le azioni che richiederebbero un adattatore
per ogni ambiente desktop invece di un comando solo: `brightness`, `focus`,
`desktop`, `window`, `power`, `clipboard`, `folder`, `screenshot`, `notify`,
`browser`, `game`, `rdp`. Il motivo di ciascuna e' in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

L'esecuzione reale su macOS e Linux non e' stata provata su quelle macchine:
la CI ne verifica avvio, test e smoke, ma l'input sintetico richiede una
sessione grafica interattiva.

## [0.2.2] - 2026-08-13

### Aggiunto

- **Stato reale dei controlli.** Il bottone del muto sa di essere muto, quello
  della scena OBS sa se e' in onda, la luce Hue sa di essere accesa. L'host
  legge la condizione vera dal sistema e dai servizi collegati e la manda ai
  client: bordo acceso, spia e un'etichetta breve (`muto`, `LIVE`, il nome
  della scena). Resta giusta anche quando qualcosa viene cambiato da un'altra
  applicazione, che e' il caso in cui un deck cieco mente.
- Nuovo contratto opzionale `readState(params, ctx)` per gli handler
  (vedi [`docs/ADDING-ACTIONS.md`](docs/ADDING-ACTIONS.md)). Lo dichiarano
  `volume`, `mic`, `brightness`, `media`, `obs` e `hue`.
- `GET /api/status` (con `?refresh=1`) e messaggio WebSocket `status`, con
  `states` completo e `changed` per le sole voci variate.
- Il canale lite trasporta lo stato in forma compatta (`z` / `w`, `id -> 0|1`):
  il firmware ESP32 disegna i bottoni accesi con bordo chiaro e spia.
- `settings.status` (`enabled`, `intervalMs`) e `"status": false` sul singolo
  controllo per escluderlo dalle letture.
- `GET /api/actions` riporta `reportsState` per ogni azione.
- `test/status.test.mjs`: 21 verifiche su normalizzazione, letture condivise,
  backoff, eventi di variazione e traduzione delle risposte di OBS.

### Note

Il costo delle letture e' contenuto per scelta: vengono interrogati solo i
controlli della pagina attiva, solo mentre almeno un client e' collegato, le
letture identiche di un giro sono messe in comune e un servizio che non
risponde viene messo in pausa per un minuto. **In dry-run non viene letto
nulla**: la promessa di non toccare il PC vale anche per le letture, quindi in
quella modalita' la mappa degli stati resta vuota.

Il supporto ESP32 e' conforme al protocollo e verificato da `npm run test:esp32`,
ma come tutto il firmware **non e' provato su hardware reale**.

## [0.2.1] - 2026-08-13

### Aggiunto

- **Integrazione continua** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):
  `npm run verify` a ogni push e pull request, su Linux, Windows e macOS con
  Node 20.10 e 22. Prima i comandi andavano ricordati ed eseguiti a mano.
- `npm run check:deps`: guardia automatica del vincolo di zero dipendenze.
  Fallisce se `package.json` acquista dipendenze o se un sorgente importa un
  pacchetto che non sia un modulo built-in di Node.
- `test/project.test.mjs`: sei verifiche sull'impianto del progetto (assenza di
  dipendenze, presenza e trigger del workflow, completezza di `verify`).

### Note

`npm run check:deps` fa ora parte di `npm run verify`, quindi la violazione del
vincolo di zero dipendenze interrompe la catena di verifica come qualunque test
fallito. Il resto dei limiti noti e' in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## [0.2.0] - 2026-08-13

Prima versione installabile, con l'editor visuale e 17 azioni in piu'.

### Aggiunto

#### Client

- **Cursori** per volume, microfono e luminosita': si trascinano come uno slider
  e mostrano il valore reale letto dal PC. Gli invii sono limitati a uno ogni
  120 ms piu' uno garantito al rilascio, per non lanciare decine di script.
- **Scorrimento orizzontale** per cambiare pagina, con animazione direzionale e
  un rimbalzo quando non c'e' altra pagina. Funzionano anche le frecce.
- **Editor visuale**: la matita in alto attiva la modifica; si tocca un
  controllo per cambiarlo o una cella vuota per aggiungerne uno, scegliendo
  l'azione da un menu diviso per categorie con la descrizione dei parametri.
  Il salvataggio passa dalla validazione dell'host e crea un backup.
- **Piu' computer nella stessa app**: schede in alto per passare da un PC
  all'altro, ognuno con il proprio token. Gestione da Impostazioni.
- **Impostazioni** nel client: PIN modificabile, elenco dei computer,
  controllo aggiornamenti.
- **Conferma** prima delle azioni marcate `"confirm": true`.
- L'esito delle azioni senza effetti visibili (script, notifiche, comandi
  remoti) compare come messaggio: prima non si vedeva nulla.

#### Host

- **Icona nell'area di notifica** con menu: apri il deck, copia gli indirizzi,
  ricarica la configurazione, controlla aggiornamenti, esci. Realizzata con
  NotifyIcon di WinForms, senza dipendenze.
- **Controllo aggiornamenti** sulle release di GitHub, con notifica nel client.
  L'host non scarica e non installa nulla da solo.
- **Salvataggio della configurazione** (`POST /api/deck/save`) con validazione,
  scrittura atomica e backup ruotati in `.wdeck-backup/`.
- **Impostazioni a caldo** (`GET`/`POST /api/settings`): PIN, tema, aggiornamenti.
- 17 nuove azioni: `volume`, `mic`, `brightness`, `focus`, `desktop`, `window`,
  `power`, `browser`, `game`, `rdp`, `clipboard`, `folder`, `screenshot`,
  `notify`, `obs`, `homeassistant`, `hue`.
- Le azioni dichiarano una **categoria** e un tipo di controllo, usati
  dall'editor per raggrupparle.
- **Installer** (`installer/install.ps1`): installazione nel profilo utente,
  collegamenti, avvio automatico opzionale, generazione di token e PIN casuali,
  disinstallazione che conserva `deck.json`.
- `npm run package` prepara l'archivio da allegare a una release.

### Corretto

- **I programmi avviati restavano dietro alla finestra del browser.** `launch`
  ora chiede esplicitamente il primo piano: Windows rifiuta
  `SetForegroundWindow` a un processo che non ha il focus, quindi si aggancia
  temporaneamente il thread di input della finestra attiva. Se il programma
  delega la finestra a un'altra istanza (il Blocco note di Windows 11, i
  launcher dei giochi) c'e' un secondo tentativo per nome di processo.
- **L'interfaccia andava a scatti.** Tre cause distinte: mancava
  `touch-action`, quindi il browser aspettava 300 ms per escludere un doppio
  tap; l'azione partiva solo al rilascio, dopo un timer di 650 ms; e la griglia
  veniva ricostruita a ogni messaggio di stato. Ora il tocco parte subito, il
  timer serve solo ai bottoni con `holdAction`, e la griglia si ridisegna solo
  quando cambia davvero.
- **Un `deck.json` non valido faceva terminare l'host** durante la ricarica a
  caldo, invece di lasciare attiva la configurazione precedente come
  documentato: l'evento `error` del config store non aveva ascoltatori, e in
  Node questo si traduce in un'eccezione non gestita. Coperto da un test.

## [0.1.0] - 2026-08-12

Prima consegna: lavoro semi-finito, funzionante e valutabile.
Stato dettagliato di ogni componente in [docs/ROADMAP.md](docs/ROADMAP.md).

### Aggiunto

#### Host (Node.js 22, zero dipendenze runtime)

- Server HTTP + WebSocket su un'unica porta, costruito solo su moduli built-in.
- Implementazione propria del framing WebSocket RFC 6455 (`src/host/ws/`):
  parser incrementale, frammentazione, masking, ping/pong, close handshake,
  piu' un client usato dai test.
- API REST: `/api/health`, `/api/pair`, `/api/deck`, `/api/state`,
  `/api/actions`, `/api/press`, `/api/reload`.
- Canale WebSocket `/ws` con autenticazione, broadcast dello stato,
  `ack` correlati da `requestId` e heartbeat.
- Configurazione dichiarativa `deck.json` con validatore proprio (tipi +
  controlli semantici) e ricarica a caldo che preserva la versione valida
  in caso di errore.
- Registro azioni estensibile a plugin e dispatcher con dry-run.
- CLI `bin/wdeck.mjs` e override tramite variabili `WDECK_*`.

#### Azioni

- `media`, `hotkey`, `text` - input sintetico su Windows via PowerShell
  (`keybd_event` in P/Invoke e `SendKeys`), script passati con `-EncodedCommand`.
- `launch`, `script`, `url` - esecuzione locale filtrata dalla whitelist.
- `http` - richieste verso webhook e API.
- `sequence`, `delay`, `navigate`, `noop`, `stub`.

#### Sicurezza

- Token obbligatorio (querystring, header `x-wdeck-token`, `Authorization: Bearer`)
  con confronto a tempo costante e generazione automatica.
- Pairing tramite PIN.
- Whitelist `allowExec` con glob, whitelist di estensioni, whitelist degli
  schemi URL, protezione dal path traversal.
- Dry-run globale non disattivabile dai client.
- Layout servito ai client ripulito da token, PIN e whitelist.

#### Client web PWA

- Griglia responsive, profili e pagine sincronizzati, 22 icone vettoriali.
- Feedback live (stato connessione, badge dry-run, ultima azione, lampeggio
  per bottone, toast, vibrazione), pressione prolungata per `holdAction`,
  riconnessione con backoff.
- Pairing con PIN dall'interfaccia, token da URL o inserito a mano.
- Service worker con app shell in cache (`/api` e `/ws` sempre in rete),
  manifest, icone PNG generate da `scripts/gen-icons.mjs`.
- Build statica `npm run build` -> `dist/web/` con id di build, minificazione
  del CSS, `asset-manifest.json` e verifica dei file prodotti.

#### Protocollo lite ed ESP32

- Dialetto compatto (chiavi JSON di un carattere) con REST e `/ws/lite`,
  documentato in `docs/PROTOCOL.md`.
- Firmware di esempio PlatformIO (TFT_eSPI + ArduinoJson + WebSockets) con tre
  ambienti di scheda, ripiego REST e riconnessione Wi-Fi.
- `firmware/esp32/include/wdeck_protocol.h` come gemello C di
  `shared/protocol.mjs`, con test che ne impedisce la divergenza.

#### Test e strumenti

- `npm test` - 150 verifiche su schema, registro, dispatcher, autenticazione,
  whitelist, tasti, framing WebSocket, protocollo, configurazione, stato, API.
- `npm run smoke` - 36 verifiche end-to-end su un host reale.
- `npm run test:esp32` - 109 verifiche di conformita' del firmware.
- `npm run check:docs` - coerenza fra documentazione, codice e protocollo.
- `npm run verify` - tutti i controlli in sequenza.

#### Documentazione

- `README.md` con quickstart Windows, comandi, configurazione, sicurezza e
  architettura.
- `docs/PROTOCOL.md`, `docs/ROADMAP.md`, `docs/ADDING-ACTIONS.md`,
  `firmware/esp32/README.md`.

### Note

- Su macOS e Linux l'host parte e serve la PWA, ma `media`, `hotkey`, `text` e
  `url` rispondono `501`: sono implementate solo per Windows.
- Il firmware ESP32 non e' ancora stato provato su hardware reale.
- Nessun HTTPS, un solo token condiviso, nessun rate limiting.
