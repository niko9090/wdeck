/**
 * Adattatori macOS e Linux.
 *
 * La parte verificabile ovunque e' la traduzione: quali comandi verrebbero
 * eseguiti, con quali argomenti. L'esecuzione vera richiede il sistema
 * corrispondente, quindi qui si prova tutto cio' che e' puro - mappe dei tasti,
 * costruzione degli script, scelta dello strumento - piu' la facciata, che
 * accetta la piattaforma come parametro proprio per poter essere provata da un
 * altro sistema.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  MAC_KEY_CODES,
  X11_KEYSYMS,
  buildMacKeyScript,
  buildMacTypeScript,
  buildXdotoolKeyArgs,
  buildXdotoolTypeArgs,
  escapeAppleScript,
  macKey,
  x11Key
} from '../src/host/platform/keymaps.mjs';
import { buildMacPlayerScript, MAC_PLAYERS } from '../src/host/platform/macos.mjs';
import { buildYdotoolKeyArgs, buildYdotoolTypeArgs, isWayland, parsePactlVolume, pickInputTool, ydotoolKey } from '../src/host/platform/linux.mjs';
import { assertSafeUrl, firstAvailable, runCommand, which } from '../src/host/platform/exec.mjs';
import { SUPPORTED_PLATFORMS, backendFor, planHotkey, planMediaKey, planText, planUrl } from '../src/host/platform/input.mjs';
import { AUDIO_PLATFORMS } from '../src/host/platform/audio.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { resolveScriptRunner } from '../src/host/platform/windows.mjs';

// ------------------------------------------------------------------ mappe macOS

test('macos: i tasti singoli si digitano, gli speciali usano il key code', () => {
  assert.deepEqual(macKey('a'), { kind: 'char', value: 'a' });
  assert.deepEqual(macKey('7'), { kind: 'char', value: '7' });
  assert.deepEqual(macKey('enter'), { kind: 'code', value: MAC_KEY_CODES.enter });
  assert.deepEqual(macKey('F5'), { kind: 'code', value: MAC_KEY_CODES.f5 });
  assert.deepEqual(macKey('left'), { kind: 'code', value: 123 });
});

test('macos: un tasto senza equivalente viene rifiutato con un messaggio chiaro', () => {
  assert.throws(() => macKey('scrolllock'), /non supportato su macOS/);
  assert.throws(() => macKey(''), /non supportato su macOS/);
});

test('macos: buildMacKeyScript traduce i modificatori nella sintassi AppleScript', () => {
  const script = buildMacKeyScript({ modifiers: ['ctrl', 'shift'], key: 'm' });
  assert.match(script, /tell application "System Events"/);
  assert.match(script, /keystroke "m" using \{control down, shift down\}/);
  assert.match(script, /end tell$/);
});

test('macos: "win" diventa il tasto Comando', () => {
  assert.match(buildMacKeyScript({ modifiers: ['win'], key: 'c' }), /using \{command down\}/);
});

test('macos: i tasti speciali passano da "key code"', () => {
  assert.match(buildMacKeyScript({ modifiers: ['win'], key: 'left' }), /key code 123 using \{command down\}/);
});

test('macos: repeat ripete la pressione e resta entro il limite', () => {
  const tre = buildMacKeyScript({ modifiers: [], key: 'a', repeat: 3 });
  assert.equal((tre.match(/keystroke "a"/g) ?? []).length, 3);
  assert.match(tre, /delay 0\.04/);
  const troppi = buildMacKeyScript({ modifiers: [], key: 'a', repeat: 999 });
  assert.equal((troppi.match(/keystroke "a"/g) ?? []).length, 20);
});

test('macos: virgolette e barre nel testo non rompono lo script', () => {
  assert.equal(escapeAppleScript('dice "ciao"'), 'dice \\"ciao\\"');
  assert.equal(escapeAppleScript('C:\\percorso'), 'C:\\\\percorso');
  const script = buildMacTypeScript('un "test" con \\ dentro');
  assert.match(script, /keystroke "un \\"test\\" con \\\\ dentro"/);
});

test('macos: un testo su piu\' righe resta un letterale AppleScript valido', () => {
  // Un a capo grezzo dentro le virgolette spezzerebbe la riga e osascript
  // darebbe errore di sintassi: va sostituito con la costante `return`/`linefeed`.
  assert.equal(escapeAppleScript('riga1\nriga2'), 'riga1" & linefeed & "riga2');
  assert.equal(escapeAppleScript('a\tb'), 'a" & tab & "b');
  const script = buildMacTypeScript('prima\nseconda');
  // Nessun a capo grezzo all'interno del letterale fra virgolette della keystroke.
  const keystrokeLine = script.split('\n').find((l) => l.includes('keystroke'));
  assert.ok(keystrokeLine, 'manca la riga keystroke');
  assert.match(keystrokeLine, /keystroke "prima" & linefeed & "seconda"/);
});

test('macos: il comando di riproduzione interroga i lettori in ordine', () => {
  const script = buildMacPlayerScript('playpause');
  for (const app of MAC_PLAYERS) assert.ok(script.includes(`"${app}"`), `manca ${app}`);
  assert.match(script, /if attivi contains "Spotify" then/);
  assert.match(script, /error "nessun lettore multimediale attivo/);
});

test('macos: "stop" diventa pausa su Spotify, che non lo conosce', () => {
  const script = buildMacPlayerScript('stop');
  assert.match(script, /tell application "Spotify" to pause/);
  assert.match(script, /tell application "Music" to stop/);
});

test('macos: un comando di riproduzione sconosciuto viene rifiutato', () => {
  assert.throws(() => buildMacPlayerScript('rewind'), /non supportato su macOS/);
});

// ------------------------------------------------------------------ mappe Linux

test('linux: x11Key traduce caratteri, tasti funzione e tasti speciali', () => {
  assert.equal(x11Key('a'), 'a');
  assert.equal(x11Key('f5'), 'F5');
  assert.equal(x11Key('enter'), 'Return');
  assert.equal(x11Key('pageup'), 'Prior');
  assert.equal(x11Key('mediaplaypause'), X11_KEYSYMS.mediaplaypause);
});

test('linux: un tasto senza keysym viene rifiutato', () => {
  assert.throws(() => x11Key('inesistente'), /non supportato su X11/);
});

test('linux: buildXdotoolKeyArgs compone la combinazione e pulisce i modificatori', () => {
  const args = buildXdotoolKeyArgs({ modifiers: ['ctrl', 'shift'], key: 'm' });
  assert.deepEqual(args, ['key', '--clearmodifiers', '--repeat', '1', '--repeat-delay', '40', 'ctrl+shift+m']);
});

test('linux: "win" diventa il tasto Super', () => {
  assert.ok(buildXdotoolKeyArgs({ modifiers: ['win'], key: 'd' }).includes('super+d'));
});

test('linux: buildXdotoolTypeArgs chiude le opzioni con "--"', () => {
  const args = buildXdotoolTypeArgs('--non-e-un-flag');
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), '--non-e-un-flag');
});

test('linux: buildYdotoolTypeArgs chiude le opzioni con "--"', () => {
  const args = buildYdotoolTypeArgs('--non-e-un-flag');
  assert.deepEqual(args, ['type', '--', '--non-e-un-flag']);
});

test('linux: ydotool usa i nomi dei tasti del kernel', () => {
  assert.equal(ydotoolKey('a'), 'KEY_A');
  assert.equal(ydotoolKey('enter'), 'KEY_ENTER');
  assert.equal(ydotoolKey('esc'), 'KEY_ESC');
  assert.equal(ydotoolKey('f7'), 'KEY_F7');
  assert.equal(ydotoolKey('volumeup'), 'KEY_VOLUMEUP');
});

test('linux: buildYdotoolKeyArgs preme e rilascia in ordine inverso', () => {
  const args = buildYdotoolKeyArgs({ modifiers: ['ctrl'], key: 'c' });
  assert.deepEqual(args, ['key', 'KEY_LEFTCTRL:1', 'KEY_C:1', 'KEY_C:0', 'KEY_LEFTCTRL:0']);
});

test('linux: buildYdotoolKeyArgs ripete la sequenza completa', () => {
  const args = buildYdotoolKeyArgs({ modifiers: [], key: 'a', repeat: 2 });
  assert.deepEqual(args, ['key', 'KEY_A:1', 'KEY_A:0', 'KEY_A:1', 'KEY_A:0']);
});

test('linux: isWayland riconosce la sessione dal suo ambiente', () => {
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'wayland' }), true);
  assert.equal(isWayland({ WAYLAND_DISPLAY: 'wayland-0' }), true);
  assert.equal(isWayland({ XDG_SESSION_TYPE: 'x11' }), false);
  assert.equal(isWayland({}), false);
});

test('linux: senza strumenti di input l\'errore dice cosa installare', () => {
  assert.throws(
    () => pickInputTool({ env: { PATH: path.join(os.tmpdir(), 'cartella-che-non-esiste-wdeck') } }),
    /xdotool.*ydotool/s
  );
});

test('linux: parsePactlVolume estrae la percentuale dal primo canale', () => {
  assert.equal(parsePactlVolume('Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50%'), 50);
  assert.equal(parsePactlVolume('Volume: mono: 0 / 0% / -inf dB'), 0);
  assert.equal(parsePactlVolume('nessuna percentuale'), null);
});

// ------------------------------------------------------------------ ricerca eseguibili

test('exec: which trova un file presente nel PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-which-'));
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  fs.writeFileSync(path.join(dir, `finto${suffix}`), '');
  const found = which('finto', {
    env: { PATH: dir, PATHEXT: suffix },
    platform: process.platform
  });
  assert.equal(found, path.join(dir, `finto${suffix}`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exec: which restituisce null per un comando assente', () => {
  assert.equal(which('comando-che-non-esiste-wdeck', { env: { PATH: os.tmpdir() } }), null);
});

test('exec: firstAvailable rispetta l\'ordine di preferenza', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-first-'));
  fs.writeFileSync(path.join(dir, 'secondo'), '');
  const env = { PATH: dir, PATHEXT: '' };
  assert.equal(firstAvailable(['primo', 'secondo'], { env, platform: 'linux' })?.name, 'secondo');
  assert.equal(firstAvailable(['assente'], { env, platform: 'linux' }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exec: which prova il nome verbatim se porta gia\' un\'estensione', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-ext-'));
  fs.writeFileSync(path.join(dir, 'tool.exe'), '');
  const env = { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT;.COM' };
  // Senza il tentativo verbatim diventerebbe "tool.exe.EXE" e non si troverebbe.
  assert.equal(which('tool.exe', { env, platform: 'win32' }), path.join(dir, 'tool.exe'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exec: which su Windows trova anche un file esatto senza estensione', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-noext-'));
  fs.writeFileSync(path.join(dir, 'senzaext'), '');
  const env = { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT;.COM' };
  assert.equal(which('senzaext', { env, platform: 'win32' }), path.join(dir, 'senzaext'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exec: assertSafeUrl ammette gli schemi noti e rifiuta il resto', () => {
  assert.equal(assertSafeUrl('https://example.it/x'), 'https://example.it/x');
  assert.equal(assertSafeUrl('mailto:a@b.it'), 'mailto:a@b.it');
  // Un valore che inizia con "-" (verrebbe scambiato per un flag) o con uno
  // schema inatteso viene respinto con un errore chiaro.
  assert.throws(() => assertSafeUrl('-flag'), /URL non ammesso/);
  assert.throws(() => assertSafeUrl('javascript:alert(1)'), /URL non ammesso/);
  assert.throws(() => assertSafeUrl('senza-schema'), /URL non ammesso/);
});

test('exec: un comando inesistente produce un errore leggibile', async () => {
  await assert.rejects(
    () => runCommand('wdeck-comando-inesistente-xyz', []),
    /comando non trovato/
  );
});

// ------------------------------------------------------------------ facciata

test('input: ogni piattaforma supportata ha il proprio adattatore', () => {
  assert.equal(backendFor('win32'), 'windows');
  assert.equal(backendFor('darwin'), 'macos');
  assert.equal(backendFor('linux'), 'linux');
  assert.equal(backendFor('aix'), null);
  assert.deepEqual([...SUPPORTED_PLATFORMS], ['win32', 'darwin', 'linux']);
});

test('input: planHotkey descrive il comando giusto per ogni piattaforma', () => {
  const win = planHotkey('ctrl+shift+m', { platform: 'win32' });
  assert.equal(win.backend, 'windows');
  assert.match(win.command, /keybd_event/);

  const mac = planHotkey('ctrl+shift+m', { platform: 'darwin' });
  assert.equal(mac.backend, 'macos');
  assert.match(mac.command, /keystroke "m" using \{control down, shift down\}/);

  const lin = planHotkey('ctrl+shift+m', { platform: 'linux' });
  assert.equal(lin.backend, 'linux');
  assert.match(lin.command, /xdotool key .*ctrl\+shift\+m/);
});

test('input: planHotkey rifiuta una piattaforma senza adattatore', () => {
  assert.throws(() => planHotkey('ctrl+c', { platform: 'aix' }), /piattaforma non supportata/);
});

test('input: planMediaKey spiega come verrebbe eseguito il comando', () => {
  assert.match(planMediaKey('playpause', { platform: 'darwin' }).description, /lettore attivo/);
  assert.match(planMediaKey('playpause', { platform: 'linux' }).description, /playerctl play-pause/);
  assert.match(planMediaKey('mute', { platform: 'linux' }).description, /pactl/);
  assert.match(planMediaKey('playpause', { platform: 'win32' }).description, /VK 0x/);
});

test('input: planText e planUrl nominano lo strumento di ogni piattaforma', () => {
  assert.match(planText('ciao', { platform: 'darwin' }).description, /osascript/);
  assert.match(planText('ciao', { platform: 'linux' }).description, /xdotool/);
  assert.match(planUrl('https://x.it', { platform: 'win32' }).description, /Start-Process/);
  assert.match(planUrl('https://x.it', { platform: 'darwin' }).description, /open/);
  assert.match(planUrl('https://x.it', { platform: 'linux' }).description, /xdg-open/);
});

// ------------------------------------------------------------------ handler

test('azioni: media, hotkey, text e url girano su Windows, macOS e Linux', () => {
  const registry = createDefaultRegistry();
  for (const type of ['media', 'hotkey', 'text', 'url']) {
    assert.deepEqual(registry.get(type).platforms, ['win32', 'darwin', 'linux'], `azione ${type}`);
    for (const platform of ['win32', 'darwin', 'linux']) {
      assert.equal(registry.supportsPlatform(type, platform), true, `${type} su ${platform}`);
    }
  }
});

test('azioni: volume e mic girano ovunque ci sia un controllo audio', () => {
  const registry = createDefaultRegistry();
  for (const type of ['volume', 'mic']) {
    assert.deepEqual(registry.get(type).platforms, [...AUDIO_PLATFORMS]);
  }
});

test('azioni: la luminosita\' resta dichiarata solo per Windows', () => {
  // Su macOS e Linux non e' pilotabile senza un binario nativo: dichiararla
  // supportata darebbe un errore a ogni pressione invece che un 501 chiaro.
  assert.deepEqual(createDefaultRegistry().get('brightness').platforms, ['win32']);
});

test('script: gli script di shell sono eseguibili fuori da Windows', () => {
  const runner = resolveScriptRunner('/home/utente/backup.sh', ['ora']);
  assert.match(runner.command, /sh$/);
  assert.deepEqual(runner.argv, ['/home/utente/backup.sh', 'ora']);
});

test('script: un argomento .bat con "&" viene rifiutato', () => {
  // cmd.exe /c ri-analizza la riga: "& calc" avvierebbe calc come comando a se'.
  assert.throws(() => resolveScriptRunner('C:\\tmp\\job.bat', ['& calc']), /metacarattere di cmd\.exe/);
  assert.throws(() => resolveScriptRunner('C:\\tmp\\job.cmd', ['a|b']), /metacarattere di cmd\.exe/);
  // Un argomento innocuo passa senza modifiche.
  const ok = resolveScriptRunner('C:\\tmp\\job.bat', ['normale']);
  assert.deepEqual(ok.argv, ['/c', 'C:\\tmp\\job.bat', 'normale']);
});
