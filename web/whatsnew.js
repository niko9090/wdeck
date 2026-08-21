/**
 * "Novità" mostrate dopo un aggiornamento. Testo pensato per il pubblico: mette
 * in risalto cosa cambia per chi usa Wdeck, senza dettagli tecnici interni.
 *
 * Chiave = versione, valore = elenco di punti brevi. Aggiungere qui una voce a
 * ogni release che merita di essere raccontata; le versioni senza voce non
 * mostrano nulla.
 */

export const WHATSNEW = {
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
