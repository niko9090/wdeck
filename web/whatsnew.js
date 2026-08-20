/**
 * "Novità" mostrate dopo un aggiornamento. Testo pensato per il pubblico: mette
 * in risalto cosa cambia per chi usa Wdeck, senza dettagli tecnici interni.
 *
 * Chiave = versione, valore = elenco di punti brevi. Aggiungere qui una voce a
 * ogni release che merita di essere raccontata; le versioni senza voce non
 * mostrano nulla.
 */

export const WHATSNEW = {
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
