import test from 'node:test';
import assert from 'node:assert/strict';

import { compactDeck } from '../src/host/config/writer.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

/**
 * Il difetto "le modifiche non vengono registrate": `compactDeck` riscrive il
 * file con un elenco esplicito di campi, e tipo di pagina, gruppi, sfondo e
 * gruppo del tasto NON c'erano. Bastava salvare qualunque altra cosa
 * dall'editor per perderli tutti, in silenzio.
 */
test('compactDeck: conserva tipo di pagina, gruppi, sfondo e gruppo del tasto', () => {
  const deck = rawDeck();
  const page = deck.profiles[0].pages[0];
  page.groups = [{ id: 'audio', label: 'Audio', color: '#4c8dff' }];
  page.background = { color: '#0b3d5c', color2: '#0a6c8c' };
  page.buttons[0].group = 'audio';
  deck.profiles[0].pages.push({ id: 'fin', name: 'Finestre', rows: 2, cols: 2, source: 'windows', buttons: [] });

  const out = compactDeck(deck);
  const p0 = out.profiles[0].pages[0];
  assert.deepEqual(p0.groups, [{ id: 'audio', label: 'Audio', color: '#4c8dff' }]);
  assert.deepEqual(p0.background, { color: '#0b3d5c', color2: '#0a6c8c' });
  assert.equal(p0.buttons[0].group, 'audio');
  assert.equal(out.profiles[0].pages.at(-1).source, "windows");
});

test('compactDeck: senza gruppi, sfondo o tipo non scrive campi vuoti', () => {
  const out = compactDeck(rawDeck());
  const p0 = out.profiles[0].pages[0];
  assert.equal('groups' in p0, false);
  assert.equal('background' in p0, false);
  assert.equal('source' in p0, false);
  assert.equal('group' in p0.buttons[0], false);
});

test('compactDeck: uno sfondo con solo immagine si scrive senza colori', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].background = { color: null, color2: null, image: 'foto' };
  const out = compactDeck(deck);
  assert.deepEqual(out.profiles[0].pages[0].background, { image: 'foto' });
});
