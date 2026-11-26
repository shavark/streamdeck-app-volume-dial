/*
 * App Volume Dial - a Stream Deck + encoder action.
 *
 *   turn  -> change the volume of the currently selected app
 *   press -> move to the NEXT app that is actually making sound right now
 *   tap   -> mute / unmute the selected app
 *
 * The app list is discovered live from the Windows audio session API, so
 * programs that are closed never appear, and nothing is hardcoded.
 *
 * No npm packages: the Stream Deck WebSocket is spoken directly over a TCP
 * socket, and the audio work is done by bin/audio-helper.ps1, which is kept
 * running so dial turns are instant.
 */

'use strict';

const net = require('net');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------- arguments
function argOf(name) {
  const i = process.argv.indexOf('-' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const PORT = parseInt(argOf('port'), 10);
const PLUGIN_UUID = argOf('pluginUUID');
const REGISTER_EVENT = argOf('registerEvent');

const STEP = 0.02;          // volume change per rotation tick
const REFRESH_MS = 2000;    // how often the app list is re-read
// Hold the dial this long to hide an app. Long enough to be a deliberate
// commitment, short enough not to feel broken. The dial draws a countdown and
// a filling bar while you hold, which is what makes the wait legible.
// History: 1.2s -> 5s (user wanted a firmer commitment) -> 3s (5 felt long).
const HOLD_MS = 3000;

function log(msg) {
  // Stream Deck captures stdout into its own plugin log.
  console.log(new Date().toISOString() + '  ' + msg);
}

// ------------------------------------------------- minimal WebSocket client
class WS {
  constructor(port, onMessage, onOpen) {
    this.buf = Buffer.alloc(0);
    this.open = false;
    this.onMessage = onMessage;
    const key = crypto.randomBytes(16).toString('base64');
    this.sock = net.connect(port, '127.0.0.1', () => {
      this.sock.write(
        'GET / HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    this.sock.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (!this.open) {
        const end = this.buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this.buf.slice(0, end).toString('latin1');
        this.buf = this.buf.slice(end + 4);
        if (!/101/.test(head.split('\r\n')[0])) {
          log('websocket handshake refused: ' + head.split('\r\n')[0]);
          process.exit(1);
        }
        this.open = true;
        onOpen();
      }
      this.drain();
    });
    this.sock.on('error', (e) => { log('socket error: ' + e.message); process.exit(1); });
    this.sock.on('close', () => { log('stream deck closed the socket'); process.exit(0); });
  }

  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); off = 10;
      }
      let mask = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        mask = this.buf.slice(off, off + 4); off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (mask) {
        const copy = Buffer.alloc(len);
        for (let i = 0; i < len; i++) copy[i] = payload[i] ^ mask[i % 4];
        payload = copy;
      }
      if (opcode === 0x1) {
        try { this.onMessage(JSON.parse(payload.toString('utf8'))); }
        catch (e) { log('bad json from stream deck: ' + e.message); }
      } else if (opcode === 0x8) {
        this.sock.end();
      } else if (opcode === 0x9) {
        this.raw(0xA, payload);
      }
    }
  }

  raw(opcode, data) {
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
    header[0] = 0x80 | opcode;
    const mask = crypto.randomBytes(4);
    const body = Buffer.alloc(len);
    for (let i = 0; i < len; i++) body[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, body]));
  }

  send(obj) {
    if (!this.open) return;
    this.raw(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }
}

// ------------------------------------------------------------ audio helper
class Helper {
  constructor() {
    this.queue = [];
    this.line = '';
    const script = path.join(__dirname, 'audio-helper.ps1');
    this.proc = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    this.proc.stdout.on('data', (d) => {
      this.line += d.toString('utf8');
      let i;
      while ((i = this.line.indexOf('\n')) >= 0) {
        const raw = this.line.slice(0, i).trim();
        this.line = this.line.slice(i + 1);
        if (!raw) continue;
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { log('helper said: ' + raw); continue; }
        if (msg.ready) { log('audio helper ready'); continue; }
        const waiter = this.queue.shift();
        if (waiter) waiter(msg);
      }
    });
    this.proc.stderr.on('data', (d) => log('helper stderr: ' + d.toString().trim()));
    this.proc.on('exit', (c) => log('audio helper exited with code ' + c));
  }

  cmd(text) {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin.write(text + '\n');
      setTimeout(() => {
        const at = this.queue.indexOf(resolve);
        if (at >= 0) { this.queue.splice(at, 1); resolve({ ok: false, err: 'timeout' }); }
      }, 4000);
    });
  }

  list()            { return this.cmd('list'); }
  set(pid, vol)     { return this.cmd('set ' + pid + ' ' + vol.toFixed(4)); }
  toggle(pid)       { return this.cmd('toggle ' + pid); }
  icon(pid)         { return this.cmd('icon ' + pid); }
}

// ------------------------------------------------------------------- state
const helper = new Helper();
const contexts = new Set();     // visible dials using this action
let sessions = [];              // live apps, minus anything hidden
let selectedPid = null;         // which one the dial is on
let ws = null;

// Apps the user has hidden, by process name. Windows cannot tell "an app that
// never makes sound" from "an app that is quiet right now", so this is manual
// on purpose: hold the dial to hide, hold the screen to bring them all back.
let hidden = new Set();
let pressAt = 0;
let holdTimer = null;           // drives the countdown while the dial is held
let didHide = false;            // so the release after a hide does not also cycle
let flash = null;               // short-lived message shown on the dial

function saveHidden() {
  ws.send({ event: 'setGlobalSettings', context: PLUGIN_UUID,
            payload: { hidden: Array.from(hidden) } });
}

function showFlash(text) {
  flash = text;
  render();
  setTimeout(() => { flash = null; refresh(); }, 1100);
}

// ----------------------------------------------------- hold-to-hide gesture
function hideSelected() {
  const s = selected();
  if (!s) return;
  hidden.add(s.name);
  saveHidden();
  sessions = sessions.filter((x) => x.name !== s.name);
  selectedPid = sessions.length ? sessions[0].pid : null;
  log('hid ' + s.name + ' (hidden: ' + Array.from(hidden).join(', ') + ')');
  showFlash('Hid ' + pretty(s.name));
}

function stopHold() {
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
}

function startHold() {
  stopHold();
  pressAt = Date.now();
  didHide = false;
  holdTimer = setInterval(() => {
    const held = Date.now() - pressAt;
    if (held >= HOLD_MS) {
      stopHold();
      didHide = true;
      hideSelected();
      return;
    }
    // Only start showing the countdown once it is clear this is a hold and not
    // a tap, so an ordinary click never flickers a countdown at you.
    if (held < 600) return;
    const s = selected();
    if (!s) return;
    const left = Math.ceil((HOLD_MS - held) / 1000);
    const pct = Math.round((held / HOLD_MS) * 100);
    for (const ctx of contexts) {
      ws.send({ event: 'setFeedback', context: ctx,
                payload: { title: 'Hide ' + pretty(s.name) + '?',
                           value: 'keep holding ' + left + 's',
                           indicator: { value: pct } } });
    }
  }, 150);
}

function selected() {
  if (!sessions.length) return null;
  let s = sessions.find((x) => x.pid === selectedPid);
  if (!s) { s = sessions[0]; selectedPid = s.pid; }
  return s;
}

// Real app icons, pulled out of each program's executable by the helper.
// Keyed by process name so every Chrome/Discord child shares one lookup, and
// the icon survives the app being restarted with a new pid.
const iconCache = new Map();
const iconPending = new Set();

function ensureIcon(s) {
  if (!s || iconCache.has(s.name) || iconPending.has(s.name)) return;
  iconPending.add(s.name);
  helper.icon(s.pid).then((r) => {
    iconPending.delete(s.name);
    if (r && r.ok && r.png) {
      iconCache.set(s.name, 'data:image/png;base64,' + r.png);
      render();
    } else {
      iconCache.set(s.name, null);   // remember the failure, do not retry forever
    }
  });
}

function pretty(name) {
  if (!name) return '';
  const map = { brave: 'Brave', chrome: 'Chrome', firefox: 'Firefox', msedge: 'Edge',
                steam: 'Steam', claude: 'Claude', Discord: 'Discord' };
  if (map[name]) return map[name];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function render() {
  const s = selected();
  for (const ctx of contexts) {
    if (flash) {
      ws.send({ event: 'setFeedback', context: ctx,
                payload: { title: flash, value: '', indicator: { value: 0 } } });
      continue;
    }
    if (!s) {
      const none = hidden.size ? 'All hidden' : 'No audio';
      ws.send({ event: 'setFeedback', context: ctx,
                payload: { title: none, value: '--', indicator: { value: 0 } } });
      continue;
    }
    const pct = Math.round(s.vol * 100);
    const n = sessions.length;
    const idx = sessions.findIndex((x) => x.pid === s.pid) + 1;
    ensureIcon(s);
    const payload = {
      title: pretty(s.name) + (n > 1 ? '  ' + idx + '/' + n : ''),
      value: s.mute ? 'muted' : pct + '%',
      indicator: { value: s.mute ? 0 : pct },
    };
    const art = iconCache.get(s.name);
    if (art) payload.icon = art;
    ws.send({ event: 'setFeedback', context: ctx, payload });
  }
}

async function refresh() {
  if (!contexts.size) return;
  const r = await helper.list();
  if (!r || !r.ok) return;
  sessions = (r.sessions || []).filter((s) => !hidden.has(s.name));
  render();
}

// --------------------------------------------------------- stream deck wire
function onMessage(msg) {
  const ev = msg.event;
  const ctx = msg.context;

  if (ev === 'willAppear') {
    contexts.add(ctx);
    refresh();
  } else if (ev === 'willDisappear') {
    contexts.delete(ctx);
  } else if (ev === 'dialRotate') {
    const s = selected();
    if (!s) return;
    const ticks = (msg.payload && msg.payload.ticks) || 0;
    let vol = Math.min(1, Math.max(0, s.vol + ticks * STEP));
    s.vol = vol;
    if (s.mute && ticks > 0) s.mute = false;    // turning up un-mutes
    render();
    helper.set(s.pid, vol).then((r) => { if (r && r.ok) { s.vol = r.vol; render(); } });
  } else if (ev === 'dialDown') {
    startHold();
  } else if (ev === 'dialUp') {
    stopHold();
    if (didHide) {
      // the hide already fired at 5s; releasing must not also cycle
      didHide = false;
    } else if (sessions.length > 1) {
      // tapped: THE POINT OF THE CLICK-IN - step to the next live app
      const at = sessions.findIndex((x) => x.pid === selectedPid);
      selectedPid = sessions[(at + 1) % sessions.length].pid;
      render();
    } else {
      refresh();
    }
  } else if (ev === 'touchTap') {
    const isHold = !!(msg.payload && msg.payload.hold);
    if (isHold) {
      if (hidden.size) {
        const n = hidden.size;
        log('unhiding: ' + Array.from(hidden).join(', '));
        hidden = new Set();
        saveHidden();
        showFlash('Restored ' + n);
      } else {
        showFlash('None hidden');
      }
      return;
    }
    const s = selected();
    if (!s) return;
    s.mute = !s.mute;
    render();
    helper.toggle(s.pid).then((r) => { if (r && r.ok) { s.mute = r.mute; render(); } });
  } else if (ev === 'didReceiveGlobalSettings') {
    const list = (msg.payload && msg.payload.settings && msg.payload.settings.hidden) || [];
    hidden = new Set(list);
    log('hidden apps loaded: ' + (list.length ? list.join(', ') : '(none)'));
    refresh();
  }
}

if (!PORT || !PLUGIN_UUID || !REGISTER_EVENT) {
  log('missing stream deck arguments; not launched by Stream Deck?');
  process.exit(1);
}

ws = new WS(PORT, onMessage, () => {
  ws.send({ event: REGISTER_EVENT, uuid: PLUGIN_UUID });
  log('registered with Stream Deck');
  ws.send({ event: 'getGlobalSettings', context: PLUGIN_UUID });   // loads the hidden list
  setInterval(refresh, REFRESH_MS);
  refresh();
});
