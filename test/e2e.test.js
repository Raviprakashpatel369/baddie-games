'use strict';
// Spawns the real server and plays full games with websocket bots.
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3100 + Math.floor(Math.random() * 500);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(name) {
  return new Promise((res) => {
    const b = { name, state: null, errors: [], welcome: null, ws: new WebSocket(`ws://localhost:${PORT}`) };
    b.send = (o) => b.ws.send(JSON.stringify(o));
    b.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state') { b.state = m; if (b.auto) b.think(); }
      if (m.t === 'welcome') b.welcome = m;
      if (m.t === 'error') b.errors.push(m.msg);
    });
    b.think = () => {
      const g = b.state && b.state.game;
      if (!g || g.phase !== 'playing') return;
      const me = g.players.find((p) => p.id === b.state.you);
      if (g.pending && g.pending.from === me.id) {
        const t = g.pending.targets[Math.floor(Math.random() * g.pending.targets.length)];
        b.send({ t: 'act', action: { type: 'target', target: t } });
      } else if (!g.pending && g.turn === me.id) {
        const hand = me.numbers.length || me.mods.length;
        b.send({ t: 'act', action: { type: !hand || Math.random() < 0.6 ? 'hit' : 'stay' } });
      }
    };
    b.ws.on('open', () => res(b));
  });
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, AUTO_PLAY_MS: 300, GRACE_MS: 500 }, stdio: 'inherit' });
  await wait(700);
  try {
    // --- lobby ---
    const [a, b, c, d] = await Promise.all(['Ann', 'Bob', 'Bob', 'Dee'].map(bot));
    a.send({ t: 'create', name: 'Ann' }); await wait(100);
    const code = a.welcome.code;
    assert.match(code, /^[A-Z]{4}$/);
    for (const x of [b, c, d]) x.send({ t: 'join', code: code.toLowerCase(), name: x.name });
    await wait(150);
    const names = a.state.room.players.map((p) => p.name);
    assert.strictEqual(new Set(names.map((n) => n.toLowerCase())).size, 4, 'names must be unique: ' + names);
    b.send({ t: 'start' }); await wait(80);
    assert.strictEqual(a.state.room.phase, 'lobby', 'non-host cannot start');
    a.send({ t: 'select', game: 'nope' }); await wait(50);
    assert.strictEqual(a.state.room.gameKey, 'flip7');
    const late0 = await bot('Late'); late0.send({ t: 'join', code: 'ZZZZ', name: 'Late' }); await wait(80);
    assert.ok(late0.errors.includes('Room not found.'));

    // --- start & play ---
    a.send({ t: 'start' }); await wait(120);
    assert.strictEqual(a.state.room.phase, 'playing');
    const late = await bot('Late'); late.send({ t: 'join', code, name: 'Late' }); await wait(80);
    assert.ok(late.errors.some((e) => /in progress/.test(e)), 'late joiner must be rejected');
    // wrong-player actions are rejected
    const g0 = a.state.game; const notTurn = [a, b, c, d].find((x) => x.state.you !== g0.turn);
    notTurn.send({ t: 'act', action: { type: 'hit' } }); await wait(80);
    assert.ok(notTurn.errors.includes('Not your turn'));
    // state must never leak a secret
    assert.ok(!JSON.stringify(a.state).includes(b.welcome.secret));

    for (const x of [a, b, d]) x.auto = true;
    // c stays "away": disconnect immediately, server must auto-play for them
    c.ws.close();
    // b refreshes mid-game and reconnects with its secret
    await wait(400); const bSecret = b.welcome;
    b.ws.close(); await wait(100);
    const b2 = await bot('Bob'); b2.auto = true; b2.send({ t: 'join', code, secret: bSecret.secret }); await wait(100);
    assert.strictEqual(b2.state.you, bSecret.id, 'reconnect keeps identity');

    const deadline = Date.now() + 30000;
    let rounds = 0, lastRound = 0;
    const host = a;
    while (Date.now() < deadline) {
      const g = host.state.game;
      if (g.phase === 'gameOver') break;
      if (g.phase === 'roundEnd') { if (g.round !== lastRound) { rounds++; lastRound = g.round; } host.send({ t: 'act', action: { type: 'next' } }); }
      await wait(20);
    }
    const final = host.state.game;
    assert.strictEqual(final.phase, 'gameOver', 'game should finish (stalled?)');
    assert.ok(final.winner);
    assert.ok(Math.max(...final.players.map((p) => p.total)) >= 200);
    console.log(`e2e: game finished in ${final.round} rounds, winner ${final.players.find((p) => p.id === final.winner).name}`);

    // --- host handover & back to lobby ---
    a.send({ t: 'lobby' }); await wait(100);
    assert.strictEqual(a.state.room.phase, 'lobby');
    a.ws.close(); await wait(900);
    assert.notStrictEqual(b2.state.room.hostId, a.welcome.id, 'host must move off a disconnected host');
    console.log('e2e: all checks passed');
  } finally {
    srv.kill();
  }
  process.exit(0);
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
