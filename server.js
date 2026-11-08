'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { registry, catalog } = require('./games');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? '/index.html' : url;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 12;
const AUTO_PLAY_MS = Number(process.env.AUTO_PLAY_MS) || 20000;
const LOBBY_GRACE_MS = Number(process.env.GRACE_MS) || 30000;

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function stateFor(room, p) {
  return {
    t: 'state',
    you: p.id,
    games: catalog,
    room: {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      gameKey: room.gameKey,
      players: [...room.players.values()].map((q) => ({ id: q.id, name: q.name, connected: q.connected })),
    },
    game: room.game ? room.game.view(p.id) : null,
  };
}

function broadcast(room) {
  for (const p of room.players.values()) send(p.ws, stateFor(room, p));
  scheduleAuto(room);
  scheduleTick(room);
}

// Games with timed phases (e.g. the Nope window) expose nextDeadline() and tick(now).
function scheduleTick(room) {
  clearTimeout(room.tickTimer);
  room.tickTimer = null;
  const dl = room.game && room.game.nextDeadline && room.game.nextDeadline();
  if (!dl) return;
  room.tickTimer = setTimeout(() => {
    room.tickTimer = null;
    if (rooms.get(room.code) !== room || !room.game) return;
    if (room.game.tick(Date.now())) broadcast(room);
    else scheduleTick(room);
  }, Math.max(0, dl - Date.now()) + 15);
}

// If the player whose move it is has disconnected, auto-play for them after a grace period.
function scheduleAuto(room) {
  const actorId = room.game && room.game.actor();
  const actor = actorId && room.players.get(actorId);
  if (!actor || actor.connected) {
    clearTimeout(room.autoTimer);
    room.autoTimer = null;
    return;
  }
  if (room.autoTimer) return;
  room.autoTimer = setTimeout(() => {
    room.autoTimer = null;
    const cur = room.game && room.game.actor();
    const p = cur && room.players.get(cur);
    if (p && !p.connected) {
      room.game.autoAct(cur);
      broadcast(room);
    }
  }, AUTO_PLAY_MS);
}

function removePlayer(room, id) {
  room.players.delete(id);
  if (room.hostId === id) {
    const next = [...room.players.values()].find((p) => p.connected) || [...room.players.values()][0];
    room.hostId = next ? next.id : null;
  }
  if (room.players.size === 0) {
    clearTimeout(room.autoTimer);
    rooms.delete(room.code);
  } else {
    broadcast(room);
  }
}

function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map((q) => q.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const cand = `${name.slice(0, 13)} ${i}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
}

// If the host stays disconnected, hand host to a connected player so the room never gets stuck.
function reassignHostIfAway(room, hostId) {
  const host = room.players.get(hostId);
  if (room.hostId !== hostId || !host || host.connected) return;
  const next = [...room.players.values()].find((p) => p.connected);
  if (next) {
    room.hostId = next.id;
    broadcast(room);
  }
}

function addPlayer(room, name, ws) {
  name = uniqueName(room, name);
  const p = {
    id: crypto.randomBytes(4).toString('hex'),
    secret: crypto.randomBytes(16).toString('hex'),
    name,
    ws,
    connected: true,
  };
  room.players.set(p.id, p);
  return p;
}

function welcome(ws, room, p) {
  ws.ctx = { room, player: p };
  send(ws, { t: 'welcome', code: room.code, id: p.id, secret: p.secret, name: p.name });
}

const handlers = {
  create(ws, m) {
    const name = cleanName(m.name);
    if (!name) return send(ws, { t: 'error', msg: 'Enter a name first.' });
    const room = {
      code: makeCode(),
      hostId: null,
      players: new Map(),
      phase: 'lobby',
      gameKey: catalog[0].id,
      game: null,
      autoTimer: null,
    };
    rooms.set(room.code, room);
    const p = addPlayer(room, name, ws);
    room.hostId = p.id;
    welcome(ws, room, p);
    broadcast(room);
  },

  join(ws, m) {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return send(ws, { t: 'error', msg: 'Room not found.', fatal: !!m.secret });
    let p = m.secret && [...room.players.values()].find((q) => q.secret === m.secret);
    if (p) {
      if (p.ws && p.ws !== ws) p.ws.close();
      p.ws = ws;
      p.connected = true;
    } else {
      const name = cleanName(m.name);
      if (!name) return send(ws, { t: 'error', msg: 'Enter a name first.' });
      if (room.phase !== 'lobby') return send(ws, { t: 'error', msg: 'That game is already in progress.' });
      if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Room is full.' });
      p = addPlayer(room, name, ws);
    }
    welcome(ws, room, p);
    broadcast(room);
  },

  select(ws, m) {
    const { room, player } = ws.ctx;
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    if (!registry[m.game]) return;
    room.gameKey = m.game;
    broadcast(room);
  },

  start(ws) {
    const { room, player } = ws.ctx;
    if (player.id !== room.hostId || room.phase !== 'lobby') return;
    const def = registry[room.gameKey];
    for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
    const players = [...room.players.values()];
    if (players.length < def.min) {
      return send(ws, { t: 'error', msg: `${def.name} needs at least ${def.min} players.` });
    }
    if (players.length > def.max) {
      return send(ws, { t: 'error', msg: `${def.name} supports at most ${def.max} players.` });
    }
    room.game = new def.Game(players.map((p) => ({ id: p.id, name: p.name })));
    room.phase = 'playing';
    broadcast(room);
  },

  act(ws, m) {
    const { room, player } = ws.ctx;
    if (room.phase !== 'playing' || !room.game) return;
    const err = room.game.handle(player.id, m.action);
    if (err) return send(ws, { t: 'error', msg: err });
    broadcast(room);
  },

  lobby(ws) {
    const { room, player } = ws.ctx;
    if (player.id !== room.hostId || room.phase !== 'playing') return;
    room.game = null;
    room.phase = 'lobby';
    for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
    broadcast(room);
  },

  leave(ws) {
    const { room, player } = ws.ctx;
    ws.ctx = null;
    player.connected = false;
    player.ws = null;
    if (room.phase === 'lobby') removePlayer(room, player.id);
    else {
      if (room.hostId === player.id) reassignHostIfAway(room, player.id);
      broadcast(room);
    }
  },
};

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string' || !Object.hasOwn(handlers, m.t)) return;
    if (!ws.ctx && m.t !== 'create' && m.t !== 'join') return;
    try {
      handlers[m.t](ws, m);
    } catch (e) {
      console.error(e);
      send(ws, { t: 'error', msg: 'Server error.' });
    }
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx || ctx.player.ws !== ws) return;
    const { room, player } = ctx;
    player.connected = false;
    player.ws = null;
    broadcast(room);
    setTimeout(() => {
      if (player.connected || room.players.get(player.id) !== player) return;
      if (room.phase === 'lobby') removePlayer(room, player.id);
      else reassignHostIfAway(room, player.id);
    }, LOBBY_GRACE_MS);
  });
});

// Drop abandoned rooms.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (![...room.players.values()].some((p) => p.connected)) {
      room.emptyTicks = (room.emptyTicks || 0) + 1;
      if (room.emptyTicks > 10) {
        clearTimeout(room.autoTimer);
        rooms.delete(code);
      }
    } else room.emptyTicks = 0;
  }
}, 60000).unref();

server.listen(PORT, () => console.log(`Baddie Games running on http://localhost:${PORT}`));
