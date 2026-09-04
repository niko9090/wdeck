/**
 * "Novità" mostrate dopo un aggiornamento. Testo pensato per il pubblico: mette
 * in risalto cosa cambia per chi usa Wdeck, senza dettagli tecnici interni.
 *
 * Chiave = versione, valore = elenco di punti brevi. Aggiungere qui una voce a
 * ogni release che merita di essere raccontata; le versioni senza voce non
 * mostrano nulla.
 */

export const WHATSNEW = {
  '0.10.7': [
    "Cambiato: i gruppi sono un insieme contornato. Una linea del colore del gruppo circonda i suoi tasti affiancati, col nome sul bordo. Tienili vicini: se li allontani il contorno si spezza e l'editor avvisa."
  ],
  '0.10.6': [
    "Corretto: il suggerimento di una versione nuova compare entro pochi minuti dalla pubblicazione, anche con il deck sempre collegato (prima poteva volerci fino a 6 ore).",
    "Corretto: dopo un aggiornamento il deck torna a schermo intero al primo tocco, invece di restare con la barra del browser."
  ],
  '0.10.5': [
    "Corretto: salvare dall'editor non cancella piu' i gruppi, il tipo di pagina e il gruppo dei tasti (era il motivo per cui certe modifiche sparivano).",
    "Corretto: dopo un aggiornamento il deck sul telefono si ricarica da solo, su ordine dell'host, invece di restare alla versione vecchia.",
    "Nuovo: sfondo delle pagine (colore, sfumatura o foto) dal pannello della pagina.",
    "Nuovo: tocca un gruppo nella legenda e i suoi tasti restano accesi mentre gli altri si spengono, cosi' li trovi subito.",
    "Corretto: la notifica sul PC non tiene piu' il tasto occupato per 8 secondi; e alla chiusura non resta un'icona Wdeck fantasma nella barra."
  ],
  '0.10.4': [
    "Nuovo: la barra in alto e' una riga sola e bassa, e la riga di stato in fondo non c'e' piu': lo spazio va ai tasti.",
    "Nuovo: lo schermo del telefono o tablet resta acceso finche' il deck e' aperto (si disattiva dalle impostazioni).",
    "Corretto: volume e luminosita' rispondono subito, non piu' dopo qualche secondo.",
    "Cambiato: manopola, rotella e timer sono grandi quanto il tile; tolto il tasto SIM."
  ],
  '0.10.3': [
    "Corretto: appena l'aggiornamento e' installato, il suggerimento di aggiornare sparisce da solo su tutti i deck collegati, senza chiudere e riaprire l'app."
  ],
  '0.10.2': [
    "Corretto: dopo un aggiornamento il deck si rimette in pari da solo. Prima poteva restare la pagina vecchia, con il suggerimento di aggiornare acceso e due versioni vicino al nome, finche' non si ricaricava a mano.",
    "Corretto: il comando Zoom ora ingrandisce davvero (prima rimpiccioliva e basta). Riguarda tutte le scorciatoie che usano il tasto piu'.",
    "Nuovo: gli stili del deck hanno finalmente i loro caratteri, anche su telefono e tablet: prima si vedevano tutti uguali perche' i caratteri erano quelli del PC Windows."
  ],
  '0.10.1': [
    "Corretto: il suggerimento di aggiornare non resta piu' acceso dopo che l'aggiornamento e' gia' stato fatto, e accanto al nome dell'app non compaiono piu' due numeri di versione uguali."
  ],
  '0.10.0': [
    'Nuovo: i tasti non sono piu\' solo tasti. Nell\'editor, sotto "Tipo", trovi manopole, rotelle, cursori, tavolette a due assi, matrici, selettori, timer e quadranti di sola lettura.',
    'Nuovo: gira una manopola sul volume o sulla luminosita\' e il livello segue lo scatto; puntala sul mouse e scorre la rotellina; su una scorciatoia la manda a ripetizione (e con "Tasti all\'indietro" i due versi fanno cose diverse, come zoom avanti e indietro).',
    'Nuovo: la tavoletta a due assi puo\' muovere il puntatore del PC, come un trackpad che copre tutto lo schermo.',
    'Nuovo: i cursori possono stare in verticale, come i fader di un mixer, e partire dal centro quando quello che regoli ha uno zero in mezzo (bilanciamento, correzioni).',
    'Nuovo: sette stili per il deck (Impostazioni → Stile): keycap, ceramica, console, quaderno, strumento, camera oscura. Sono separati da chiaro/scuro: uno e\' la forma, l\'altro la luce.',
    'Corretto: le scorciatoie con la punteggiatura (Ctrl+, Ctrl+-, Ctrl+.) venivano registrate ma poi rifiutate dal PC. Ora funzionano, tastierino numerico compreso.',
    'Corretto: passare da una pagina all\'altra scorrendo il dito ora funziona anche partendo da sopra un cursore verticale, senza spostarlo per sbaglio.',
    'Corretto: i cursori seguono il dito subito, senza piu\' il ritardo che li faceva sembrare lenti, e non tornano piu\' indietro da soli un attimo dopo averli mollati.'
  ],
  '0.9.0': [
    'Nuovo: pagine dinamiche. Dal menu della pagina scegli "Tipo di pagina" per avere una pagina "Finestre aperte" (task switcher: tocca per portare davanti), "App installate" (tocca per avviare) o "Widget" (orologio e stato del PC).',
    'Nuovo: dal menu vicino all\'orologio puoi aggiungere tuoi script (.ps1/.bat/.exe…); poi te li ritrovi tra i suggerimenti nell\'editor, da mettere su un pulsante o uno slider.'
  ],
  '0.8.21': [
    'Nuovo: gruppi di tasti con nome e colore. Raggruppa i comandi simili per riconoscerli a colpo d\'occhio — crei i gruppi dalla pagina (tocca il nome della pagina in alto) e assegni i tasti dall\'editor del tasto.'
  ],
  '0.8.20': [
    'Su schermo touch ora puoi scorrere il dito in orizzontale per cambiare pagina, anche passando sopra i pulsanti (come sfogliare).',
    'In alto, accanto al nome del deck, vedi la versione di Wdeck in esecuzione.',
    'In modifica puoi riordinare i pulsanti anche su una pagina piena: trascinane uno sopra un altro e si scambiano di posto.',
    'Eliminare un pulsante è più chiaro: in modifica ogni tile ha una "×" in alto a destra (con conferma), separata dalla modifica dell\'azione.',
    'Impostare una scorciatoia da tastiera è più facile: tieni premuta tutta la combinazione (es. Ctrl+Shift+S) e viene registrata quando lasci i tasti, senza più fermarsi al primo.'
  ],
  '0.8.19': [
    'Le finestre dei programmi avviati vengono portate davanti in modo più deciso (minimizza-e-ripristina), anche premendo dal telefono o via Desktop Remoto. Può esserci un breve sfarfallio.'
  ],
  '0.8.18': [
    'Il banner della nuova versione ora sparisce dopo aver aggiornato (prima poteva restare).',
    'Ripristinato l\'avvio dei programmi in primo piano (una modifica recente lo aveva peggiorato).'
  ],
  '0.8.17': [
    'I programmi vengono portati davanti anche dalla seconda pressione in poi (aggirato il blocco del "primo piano" di Windows).'
  ],
  '0.8.16': [
    'Avviando un programma, la finestra viene portata davvero in primo piano (prima poteva aprirsi dietro le altre, specie via Desktop Remoto).'
  ],
  '0.8.15': [
    'Le richieste HTTP (webhook) ora raggiungono anche indirizzi locali come 127.0.0.1 e la rete di casa (utile per Home Assistant e servizi locali).',
    'Aggiornando dal menu vicino all\'orologio si apre il deck con la barra di avanzamento: vedi download e installazione.'
  ],
  '0.8.14': [
    'Nuova azione "Riproduci suono" (soundboard): un pulsante fa partire un file audio (wav, mp3, m4a, ogg, flac), a volume regolabile.'
  ],
  '0.8.13': [
    'Avvio programma: ora basta il nome (es. explorer.exe, notepad.exe, calc.exe) come nella finestra Esegui, senza il percorso completo.'
  ],
  '0.8.12': [
    'Su touch i messaggi di conferma restano visibili quando sollevi il dito (prima si chiudevano da soli).',
    'La luminosità, se lo schermo non la supporta (PC fisso o Desktop Remoto), ora lo dice chiaramente.'
  ],
  '0.8.11': [
    'Corretto il menu vicino all\'orologio: "Controlla aggiornamenti" e "Scarica e installa" ora funzionano (prima davano una pagina vuota o un errore 404).'
  ],
  '0.8.10': [
    'Modifica dei pulsanti più stabile su touch: la tastiera non compare più da sola aprendo l\'editor.',
    'Dall\'icona vicino all\'orologio apri direttamente le impostazioni, e "Controlla aggiornamenti" ti dà una risposta visibile.'
  ],
  '0.8.9': [
    'Dopo "Controlla ora" il pulsante "Scarica e installa" compare subito, senza dover riaprire le impostazioni.'
  ],
  '0.8.8': [
    'Aprendo l\'app controlla da sola se c\'è una versione nuova e te lo dice col banner: non serve più premere "Controlla ora".'
  ],
  '0.8.7': [
    'Nuova azione Mouse: clic sinistro/destro/centrale, doppio clic e rotellina su/giù.',
    'Puoi scegliere il colore del testo dei pulsanti, non solo lo sfondo.'
  ],
  '0.8.6': [
    'Molta più scelta: usa un\'emoji come icona (tavolozza pronta o scrivi la tua).',
    'Tanti più pulsanti pronti, divisi per categoria: audio, sistema, finestre, modifica e web.'
  ],
  '0.8.5': [
    'Molto più reattivo: i tasti media e le scorciatoie ora rispondono all\'istante, senza il ritardo di prima.'
  ],
  '0.8.4': [
    'Un banner in alto ti avvisa quando c\'è una nuova versione, con le novità a portata di clic e la X per chiuderlo.',
    'Dopo ogni aggiornamento vedi cosa è cambiato in questa schermata.',
    'Correzione: tenendo premuto un pulsante non compare più il menu del sistema che faceva sembrare rotta la pressione.'
  ],
  '0.8.3': [
    'L\'app si aggiorna da sola e non resta più bloccata su una versione vecchia.'
  ],
  '0.8.0': [
    'Editor dei pulsanti guidato: menù, cursori e interruttori al posto del testo tecnico.',
    'Una libreria di pulsanti pronti (Muto, Screenshot, Blocca PC…) da cui partire.',
    'Pulsante "Prova" per vedere cosa fa un\'azione prima di salvarla.'
  ]
};
