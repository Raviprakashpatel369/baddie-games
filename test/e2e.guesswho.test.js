'use strict';
// Real server + websocket bots playing Guess Who, plus lobby rules (exactly 2 players).
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3900 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => {
  const d = Date.now() + ms;
  while (Date.now() < d && !f()) await wait(20);
  assert.ok(f(), 'timed out');
};

function bot(name) {
  return new Promise((res) => {
    const b = { name, s: null, errors: [], ws: new WebSocket(`ws://localhost:${PORT}`) };
    b.send = (o) => b.ws.send(JSON.stringify(o));
    b.act = (action) => b.send({ t: 'act', action });
    b.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') b.welcome = m;
      if (m.t === 'error') b.errors.push(m.msg);
      if (m.t === 'state') b.s = m;
    });
    b.ws.on('open', () => res(b));
  });
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, AUTO_PLAY_MS: 300, GRACE_MS: 500 }, stdio: 'inherit' });
  await wait(700);
  try {
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(bot));
    a.send({ t: 'create', name: 'A' });
    await until(() => a.welcome);
    b.send({ t: 'join', code: a.welcome.code, name: 'B' });
    c.send({ t: 'join', code: a.welcome.code, name: 'C' });
    await until(() => a.s && a.s.room.players.length === 3);
    assert.ok(a.s.games.some((g) => g.id === 'guesswho' && g.min === 2 && g.max === 2));
    a.send({ t: 'select', game: 'guesswho' });
    await until(() => a.s.room.gameKey === 'guesswho');
    a.send({ t: 'start' });
    await until(() => a.errors.length);
    assert.ok(/at most 2/.test(a.errors[0]), 'three players is rejected: ' + a.errors[0]);
    c.send({ t: 'leave' });
    await until(() => a.s.room.players.length === 2);

    a.send({ t: 'start' });
    await until(() => a.s.room.phase === 'playing');
    assert.strictEqual(a.s.game.type, 'guesswho');
    assert.strictEqual(a.s.game.names.length, 34);
    a.act({ type: 'pick', n: 10 });
    await until(() => a.s.game.secret === 10);
    assert.strictEqual(b.s.game.secret, null);
    assert.ok(!JSON.stringify(b.s).includes('"secret":10'), 'secret never reaches the opponent');
    b.act({ type: 'pick', n: 20 });
    await until(() => a.s.game.phase === 'ask');

    const byId = { [a.s.you]: a, [b.s.you]: b };
    const asker = byId[a.s.game.turn];
    const answerer = asker === a ? b : a;
    answerer.act({ type: 'ask', q: 'nope' });
    await until(() => answerer.errors.includes('Not your turn to ask'));
    asker.act({ type: 'ask', q: 'Is it a man?' });
    await until(() => answerer.s.game.phase === 'answer');
    assert.strictEqual(answerer.s.game.question, 'Is it a man?');
    answerer.act({ type: 'answer', a: 'yes' });
    await until(() => asker.s.game.phase === 'ask' && asker.s.game.turn === answerer.s.you);
    assert.strictEqual(asker.s.game.history[0].a, 'yes');

    // answerer is now the asker: a wrong guess loses
    const wrong = answerer === a ? 0 : 1; // neither 10 nor 20
    answerer.act({ type: 'guess', n: wrong });
    await until(() => asker.s.game.phase === 'gameOver');
    assert.strictEqual(asker.s.game.winner, asker.s.you);
    assert.deepStrictEqual(asker.s.game.players.map((p) => p.secret).sort(), [10, 20]);

    // rematch, then a disconnects mid-pick: the server auto-picks for them so b isn't stuck
    a.act({ type: 'rematch' });
    await until(() => a.s.game.phase === 'pick' && a.s.game.secret === null);
    b.act({ type: 'pick', n: 5 });
    await until(() => b.s.game.secret === 5);
    a.ws.close();
    await until(() => b.s.game.phase === 'ask', 5000);
    console.log('e2e guesswho: OK');
  } finally {
    srv.kill();
  }
  process.exit(0);
})().catch((e) => { console.error('E2E GUESSWHO FAILED:', e); process.exit(1); });
