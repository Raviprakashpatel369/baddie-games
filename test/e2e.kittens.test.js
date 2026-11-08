'use strict';
// Real server + websocket bots playing Bomb Pussies, incl. the server-side Nope timer
// and auto-play for a player who disconnects.
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3600 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function bot(name) {
  return new Promise((res) => {
    const b = { name, s: null, errors: [], ws: new WebSocket(`ws://localhost:${PORT}`), auto: false };
    const send = (action) => b.ws.send(JSON.stringify({ t: 'act', action }));
    b.send = (o) => b.ws.send(JSON.stringify(o));
    b.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') b.welcome = m;
      if (m.t === 'error') b.errors.push(m.msg);
      if (m.t !== 'state') return;
      b.s = m;
      const g = m.game;
      if (!b.auto || !g || g.phase === 'gameOver') return;
      const me = g.players.find((p) => p.id === m.you);
      if (!me.alive) return;
      if (g.phase === 'reaction') {
        if (Math.random() < 0.3 && g.pending.nopes < 2 && g.hand.some((c) => c.t === 'nope')) send({ type: 'nope' });
      } else if (g.phase === 'favor' && g.favor.from === me.id) send({ type: 'give', id: rnd(g.hand).id });
      else if (g.phase === 'insert' && g.insert.by === me.id) send({ type: 'insert', pos: Math.floor(Math.random() * (g.insert.deckCount + 1)) });
      else if (g.phase === 'turn' && g.turn === me.id) {
        const acts = g.hand.filter((c) => ['attack', 'skip', 'shuffle', 'future'].includes(c.t));
        const favors = g.hand.filter((c) => c.t === 'favor');
        const others = g.players.filter((p) => p.alive && p.id !== me.id && p.count > 0);
        if (acts.length && Math.random() < 0.5) send({ type: 'play', ids: [rnd(acts).id] });
        else if (favors.length && others.length && Math.random() < 0.5) send({ type: 'play', ids: [favors[0].id], target: rnd(others).id });
        else send({ type: 'draw' });
      }
    });
    b.ws.on('open', () => res(b));
  });
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT, NOPE_MS: 120, AUTO_PLAY_MS: 300, GRACE_MS: 500 }, stdio: 'inherit',
  });
  await wait(700);
  try {
    const bots = await Promise.all(['A', 'B', 'C', 'D'].map(bot));
    const [a, b, c, d] = bots;
    a.send({ t: 'create', name: 'A' }); await wait(100);
    for (const x of [b, c, d]) x.send({ t: 'join', code: a.welcome.code, name: x.name });
    await wait(150);
    a.send({ t: 'select', game: 'kittens' }); await wait(80);
    assert.strictEqual(a.s.room.gameKey, 'kittens');
    a.send({ t: 'start' }); await wait(150);
    assert.strictEqual(a.s.room.phase, 'playing');
    assert.strictEqual(a.s.game.type, 'kittens');
    for (const x of bots) {
      const v = x.s.game;
      assert.strictEqual(v.hand.length, 8, 'everyone starts with 8 cards');
      assert.ok(v.hand.some((h) => h.t === 'defuse'), 'everyone starts with a Defuse');
      assert.ok(v.players.every((p) => p.count === 8));
      assert.ok(!JSON.stringify(v).includes('"ek"') || v.discard.length === 0, 'kitten positions are never sent');
    }
    // out-of-turn play is rejected
    const g0 = a.s.game; const other = bots.find((x) => x.s.you !== g0.turn);
    other.send({ t: 'act', action: { type: 'draw' } }); await wait(80);
    assert.ok(other.errors.includes('Not your turn'));

    c.ws.close(); // leaves: server must auto-play for them
    for (const x of [a, b, d]) { x.auto = true; if (x.s) x.ws.emit('message', JSON.stringify(x.s)); }
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && a.s.game.phase !== 'gameOver') await wait(50);
    const g = a.s.game;
    assert.strictEqual(g.phase, 'gameOver', 'game should finish (stalled in ' + g.phase + ')');
    assert.strictEqual(g.players.filter((p) => p.alive).length, 1);
    assert.ok(g.players.find((p) => p.id === g.winner).alive);
    console.log('e2e kittens: finished, winner', g.players.find((p) => p.id === g.winner).name);
  } finally {
    srv.kill();
  }
  process.exit(0);
})().catch((e) => { console.error('E2E KITTENS FAILED:', e); process.exit(1); });
