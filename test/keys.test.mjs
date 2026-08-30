import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHotkey, resolveKey, resolveMediaKey, VK } from '../src/host/platform/keys.mjs';
import { buildKeyOps, buildKeyScript, buildMouseOps, buildMouseScript, buildTypeTextScript, encodeKeyOps, escapeSendKeys, encodePowerShell, MOUSE_COMMANDS, resolveScriptRunner } from '../src/host/platform/windows.mjs';

test('keys: resolveKey riconosce lettere, cifre, funzione e alias', () => {
  assert.equal(resolveKey('a'), 0x41);
  assert.equal(resolveKey('Z'), 0x5a);
  assert.equal(resolveKey('5'), 0x35);
  assert.equal(resolveKey('f1'), 0x70);
  assert.equal(resolveKey('F12'), 0x7b);
  assert.equal(resolveKey('f24'), 0x87);
  assert.equal(resolveKey('enter'), VK.enter);
  assert.equal(resolveKey('return'), VK.enter);
  assert.equal(resolveKey('escape'), VK.esc);
  assert.equal(resolveKey('pgdn'), VK.pagedown);
  assert.equal(resolveKey('  Space  '), VK.space);
  assert.equal(resolveKey('inesistente'), null);
  assert.equal(resolveKey(''), null);
  assert.equal(resolveKey(undefined), null);
});

test('keys: parseHotkey separa modificatori e tasto', () => {
  const hotkey = parseHotkey('ctrl+shift+m');
  assert.deepEqual(hotkey.modifiers, ['ctrl', 'shift']);
  assert.equal(hotkey.key, 'm');
  assert.deepEqual(hotkey.modifierCodes, [VK.ctrl, VK.shift]);
  assert.equal(hotkey.keyCode, 0x4d);
});

test('keys: parseHotkey accetta alias e spazi', () => {
  const hotkey = parseHotkey(' Control + Alt + Del ');
  assert.deepEqual(hotkey.modifiers, ['ctrl', 'alt']);
  assert.equal(hotkey.keyCode, VK.delete);

  assert.equal(parseHotkey('win+l').modifierCodes[0], VK.win);
  assert.equal(parseHotkey('cmd+d').modifierCodes[0], VK.win);
  assert.deepEqual(parseHotkey('f5').modifiers, []);
});

test('keys: parseHotkey non duplica i modificatori', () => {
  assert.deepEqual(parseHotkey('ctrl+ctrl+a').modifiers, ['ctrl']);
});

test('keys: parseHotkey rifiuta le combinazioni non valide', () => {
  assert.throws(() => parseHotkey(''), /hotkey vuota/);
  assert.throws(() => parseHotkey('   '), /hotkey vuota/);
  assert.throws(() => parseHotkey('ctrl+'), /non contiene un tasto finale/);
  assert.throws(() => parseHotkey('ctrl+shift'), /non contiene un tasto finale/);
  assert.throws(() => parseHotkey('a+b'), /piu' di un tasto/);
  assert.throws(() => parseHotkey('ctrl+inesistente'), /tasto sconosciuto/);
  assert.throws(() => parseHotkey(null), /hotkey vuota/);
});

test('keys: resolveMediaKey mappa le chiavi logiche', () => {
  assert.equal(resolveMediaKey('playpause'), VK.mediaplaypause);
  assert.equal(resolveMediaKey('PLAY'), VK.mediaplaypause);
  assert.equal(resolveMediaKey('next'), VK.medianext);
  assert.equal(resolveMediaKey('previous'), VK.mediaprev);
  assert.equal(resolveMediaKey('mute'), VK.volumemute);
  assert.equal(resolveMediaKey('volup'), VK.volumeup);
  assert.throws(() => resolveMediaKey('turbo'), /non supportato/);
  assert.throws(() => resolveMediaKey(undefined), /non supportato/);
});

test('windows: buildKeyScript genera pressione e rilascio in ordine', () => {
  const script = buildKeyScript([VK.ctrl], 0x41);
  const lines = script.split('\n').filter((l) => l.includes('$k::keybd_event('));
  assert.equal(lines.length, 4, script);
  assert.match(lines[0], /0x11,0,0x00/);  // ctrl giu'
  assert.match(lines[1], /0x41,0,0x00/);  // A giu'
  assert.match(lines[2], /0x41,0,0x02/);  // A su
  assert.match(lines[3], /0x11,0,0x02/);  // ctrl su
});

test('windows: buildKeyOps rispecchia buildKeyScript (giu/su in ordine)', () => {
  const ops = buildKeyOps([VK.ctrl], 0x41);
  // ctrl giu, A giu, A su, ctrl su
  assert.deepEqual(ops, [
    { vk: 0x11, flags: 0x00 },
    { vk: 0x41, flags: 0x00 },
    { vk: 0x41, flags: 0x02 },
    { vk: 0x11, flags: 0x02 }
  ]);
});

test('windows: buildKeyOps marca i tasti media come extended, con ripetizione e pause', () => {
  const ops = buildKeyOps([], VK.volumeup, { repeat: 2 });
  assert.deepEqual(ops, [
    { vk: 0xaf, flags: 0x01 },
    { vk: 0xaf, flags: 0x03 },
    { sleep: 40 },
    { vk: 0xaf, flags: 0x01 },
    { vk: 0xaf, flags: 0x03 }
  ]);
});

test('windows: encodeKeyOps produce solo numeri esadecimali (K:/S:)', () => {
  const enc = encodeKeyOps(buildKeyOps([VK.ctrl], 0x41));
  assert.equal(enc, 'K:11:0;K:41:0;K:41:2;K:11:2');
  assert.match(encodeKeyOps([{ sleep: 40 }]), /^S:28$/);
  // nessun carattere fuori da [A-Fa-f0-9:;]: nessuno script arbitrario passa
  assert.ok(/^[0-9a-fK S:;]*$/i.test(enc));
});

test('windows: buildMouseOps genera giu/su per un clic, delta per lo scroll', () => {
  assert.deepEqual(buildMouseOps('left'), [{ mouse: 0x0002 }, { mouse: 0x0004 }]);
  assert.deepEqual(buildMouseOps('right'), [{ mouse: 0x0008 }, { mouse: 0x0010 }]);
  assert.equal(buildMouseOps('double').length, 4);
  const up = buildMouseOps('scroll-up');
  assert.equal(up[0].mouse, 0x0800);
  assert.equal(up[0].data, 120);
  const down = buildMouseOps('scroll-down');
  assert.equal(down[0].data >>> 0, (-120) >>> 0); // delta negativo come uint32
});

test('windows: encodeKeyOps codifica il mouse come M:<flags>:<data>:<dx>:<dy>', () => {
  assert.equal(encodeKeyOps(buildMouseOps('left')), 'M:2:0:0:0;M:4:0:0:0');
  assert.equal(encodeKeyOps(buildMouseOps('scroll-up')), 'M:800:78:0:0'); // 0x78 = 120
  assert.match(encodeKeyOps(buildMouseOps('scroll-down')), /^M:800:ffffff88:0:0$/);
});

test('windows: la rotellina moltiplica gli scatti e si ferma al tetto', () => {
  assert.equal(buildMouseOps('scroll-up', { notches: 3 })[0].data, 360);
  assert.equal(buildMouseOps('scroll-down', { notches: 3 })[0].data >>> 0, (-360) >>> 0);
  // Meno di uno scatto resta uno scatto: una manopola sfiorata deve muovere.
  assert.equal(buildMouseOps('scroll-up', { notches: 0.2 })[0].data, 120);
  // Tetto a 30: una torsione distratta non scorre mezzo documento.
  assert.equal(buildMouseOps('scroll-up', { notches: 999 })[0].data, 120 * 30);
});

test('windows: move porta il puntatore in coordinate assolute, con la y rovesciata', () => {
  const [op] = buildMouseOps('move', { x: 0, y: 100 }); // in alto a sinistra
  assert.equal(op.mouse, 0x8001); // MOVE | ABSOLUTE
  assert.equal(op.dx, 0);
  assert.equal(op.dy, 0);
  const [centro] = buildMouseOps('move', { x: 50, y: 50 });
  assert.equal(centro.dx, Math.round(65535 / 2));
  assert.equal(centro.dy, Math.round(65535 / 2));
  const [basso] = buildMouseOps('move', { x: 100, y: 0 });
  assert.equal(basso.dx, 65535);
  assert.equal(basso.dy, 65535);
  // Fuori scala si taglia invece di sfondare: il puntatore resta sullo schermo.
  assert.equal(buildMouseOps('move', { x: 500, y: -9 })[0].dx, 65535);
});

test('windows: buildMouseScript passa dx e dy a mouse_event', () => {
  const script = buildMouseScript('move', { x: 50, y: 50 });
  assert.match(script, /mouse_event\(0x8001,32768,32768,0,/);
});

test('windows: buildMouseScript rifiuta un comando ignoto e accetta quelli noti', () => {
  for (const c of MOUSE_COMMANDS) assert.ok(buildMouseScript(c).includes('mouse_event'), c);
  assert.throws(() => buildMouseOps('boh'));
});

test('keys: la punteggiatura e\u2019 un tasto come gli altri (ctrl+piu\u2019 = zoom)', () => {
  // La cattura dei tasti nel client manda `event.key` cosi' com'e': senza
  // questi alias "ctrl+-" arrivava all'host e veniva rifiutato, e legare lo
  // zoom a una manopola era semplicemente impossibile.
  assert.equal(parseHotkey('ctrl+-').key, 'minus');
  assert.equal(parseHotkey('ctrl+minus').keyCode, 0xbd);
  assert.equal(parseHotkey('ctrl+.').key, 'period');
  assert.equal(parseHotkey('ctrl+/').key, 'slash');
  assert.equal(parseHotkey('ctrl+[').key, 'lbracket');
  assert.equal(parseHotkey('ctrl+numpadadd').keyCode, 0x6b);
});

test('keys: il "piu\u2019" finale e\u2019 un tasto, non un separatore avanzato', () => {
  // "ctrl++" e' quello che compone la cattura premendo ctrl e il tasto piu'.
  // Spezzando la stringa sul "+" il tasto sparirebbe fra i pezzi vuoti.
  assert.equal(parseHotkey('ctrl++').key, 'plus');
  assert.deepEqual(parseHotkey('ctrl++').modifiers, ['ctrl']);
  assert.equal(parseHotkey('ctrl+shift++').key, 'plus');
  assert.equal(parseHotkey('+').key, 'plus');
  assert.equal(parseHotkey('ctrl+plus').keyCode, parseHotkey('ctrl++').keyCode);
});

test('windows: buildKeyScript rilascia i modificatori in ordine inverso', () => {
  const script = buildKeyScript([VK.ctrl, VK.shift], 0x4d);
  const lines = script.split('\n').filter((l) => l.includes('$k::keybd_event('));
  assert.match(lines.at(-2), /0x10,0,0x02/); // shift su
  assert.match(lines.at(-1), /0x11,0,0x02/); // ctrl su
});

test('windows: buildKeyScript marca i tasti media come extended', () => {
  const script = buildKeyScript([], VK.volumeup);
  assert.match(script, /0xAF,0,0x01/);
  assert.match(script, /0xAF,0,0x03/); // extended + keyup
});

test('windows: buildKeyScript ripete la pressione e limita repeat', () => {
  const tre = buildKeyScript([], VK.volumeup, { repeat: 3 });
  assert.equal(tre.split('\n').filter((l) => l.includes('$k::keybd_event(')).length, 6);

  const troppi = buildKeyScript([], VK.volumeup, { repeat: 999 });
  assert.equal(troppi.split('\n').filter((l) => l.includes('$k::keybd_event(')).length, 40);

  const zero = buildKeyScript([], VK.volumeup, { repeat: 0 });
  assert.equal(zero.split('\n').filter((l) => l.includes('$k::keybd_event(')).length, 2);
});

test('windows: escapeSendKeys protegge i caratteri speciali', () => {
  assert.equal(escapeSendKeys('a+b'), 'a{+}b');
  assert.equal(escapeSendKeys('100%'), '100{%}');
  assert.equal(escapeSendKeys('a^b~c'), 'a{^}b{~}c');
  assert.equal(escapeSendKeys('f(x)[1]{2}'), 'f{(}x{)}{[}1{]}{{}2{}}');
  assert.equal(escapeSendKeys('riga1\nriga2'), 'riga1{ENTER}riga2');
  assert.equal(escapeSendKeys('riga1\r\nriga2'), 'riga1{ENTER}riga2');
  assert.equal(escapeSendKeys('testo normale'), 'testo normale');
});

test('windows: buildTypeTextScript incapsula il testo in base64', () => {
  const script = buildTypeTextScript('ciao "mondo" $var');
  assert.match(script, /FromBase64String/);
  assert.match(script, /SendKeys/);
  assert.ok(!script.includes('$var'), 'il testo non deve finire inline nello script');
  const payload = /\$b64 = '([^']+)'/.exec(script)[1];
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), 'ciao "mondo" $var');
});

test('windows: encodePowerShell usa UTF-16LE come richiede -EncodedCommand', () => {
  const encoded = encodePowerShell('Write-Output "ok"');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), 'Write-Output "ok"');
});

test('windows: resolveScriptRunner sceglie l\'interprete corretto', () => {
  assert.match(resolveScriptRunner('C:\\a\\x.ps1').command, /powershell/i);
  assert.ok(resolveScriptRunner('C:\\a\\x.ps1').argv.includes('-File'));
  assert.match(resolveScriptRunner('C:\\a\\x.bat').argv[0], /^\/c$/);
  assert.equal(resolveScriptRunner('C:\\a\\x.py', ['1']).argv.at(-1), '1');
  assert.equal(resolveScriptRunner('C:\\a\\x.mjs').command, process.execPath);
  assert.equal(resolveScriptRunner('C:\\a\\x.exe', ['--flag']).command, 'C:\\a\\x.exe');
  assert.throws(() => resolveScriptRunner('C:\\a\\x.vbs'), /non supportata/);
  assert.throws(() => resolveScriptRunner('C:\\a\\x'), /nessuna/);
});
