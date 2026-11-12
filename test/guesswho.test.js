'use strict';
const assert = require('assert');
const gw = require('../games/guesswho');
const { NAMES } = gw._internals;
const mk = () => new gw.Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);

// ---- roster ----
assert.strictEqual(NAMES.length, 34);
assert.strictEqual(new Set(NAMES).size, 34, 'names are unique');
assert.ok(NAMES.includes('Vijaya Laxmi') && NAMES.includes('Veera Bhadraiah') && NAMES.includes('Shiva'));
assert.deepStrictEqual([gw.min, gw.max], [2, 2]);

// ---- picking ----
{
  const g = mk();
  assert.strictEqual(g.phase, 'pick');
  assert.ok(g.handle('a', { type: 'ask', q: 'hi' }), 'cannot ask before picking');
  assert.ok(g.handle('a', { type: 'pick', n: 99 }), 'invalid pick rejected');
  assert.ok(g.handle('a', { type: 'pick', n: 'x' }));
  assert.strictEqual(g.handle('a', { type: 'pick', n: 3 }), null);
  assert.ok(g.handle('a', { type: 'pick', n: 4 }), 'pick is locked once made');
  assert.strictEqual(g.phase, 'pick');
  assert.strictEqual(g.actor(), 'b', 'auto-play falls to the player who has not picked');
  // secrets are private
  assert.strictEqual(g.view('a').secret, 3);
  assert.strictEqual(g.view('b').secret, null);
  assert.ok(g.view('b').players.every((p) => p.secret === null), 'opponent secret never sent');
  assert.ok(!JSON.stringify(g.view('b')).includes('"secret":3'));
  g.handle('b', { type: 'pick', n: 7 });
  assert.strictEqual(g.phase, 'ask');
  assert.ok(g.view('a').players.every((p) => p.secret === null), 'still hidden during play');
}

// ---- turn flow ----
{
  const g = mk();
  g.handle('a', { type: 'pick', n: 1 }); g.handle('b', { type: 'pick', n: 2 });
  const first = g.players[g.turn].id, second = first === 'a' ? 'b' : 'a';
  assert.ok(g.handle(second, { type: 'ask', q: 'x?' }), 'not your turn');
  assert.ok(g.handle(first, { type: 'ask', q: '   ' }), 'empty question rejected');
  assert.ok(g.handle(first, { type: 'answer', a: 'yes' }), 'asker cannot answer');
  assert.strictEqual(g.handle(first, { type: 'ask', q: 'Is it a woman?' }), null);
  assert.strictEqual(g.phase, 'answer');
  assert.strictEqual(g.actor(), second);
  assert.strictEqual(g.view(second).question, 'Is it a woman?');
  assert.ok(g.handle(first, { type: 'ask', q: 'again' }), 'cannot ask twice');
  assert.ok(g.handle(first, { type: 'guess', n: 2 }), 'cannot guess while a question is pending');
  assert.ok(g.handle(second, { type: 'answer', a: 'maybe' }), 'only yes/no');
  assert.strictEqual(g.handle(second, { type: 'answer', a: 'no' }), null);
  assert.strictEqual(g.phase, 'ask');
  assert.strictEqual(g.players[g.turn].id, second, 'turn alternates');
  assert.deepStrictEqual(g.history, [{ by: first, q: 'Is it a woman?', a: 'no' }]);
  // flipping names down is private and per-player
  assert.strictEqual(g.handle('a', { type: 'toggle', n: 5 }), null);
  assert.deepStrictEqual(g.view('a').down, [5]);
  assert.deepStrictEqual(g.view('b').down, []);
  g.handle('a', { type: 'toggle', n: 5 });
  assert.deepStrictEqual(g.view('a').down, []);
  assert.ok(g.handle('a', { type: 'toggle', n: 500 }));
  // long questions are truncated
  g.handle(second, { type: 'ask', q: 'z'.repeat(500) });
  assert.strictEqual(g.question.length, gw._internals.MAX_Q);
}

// ---- guessing ----
for (const correct of [true, false]) {
  const g = mk();
  g.handle('a', { type: 'pick', n: 1 }); g.handle('b', { type: 'pick', n: 2 });
  const asker = g.players[g.turn], other = g.players[1 - g.turn];
  const target = other.secret;
  const n = correct ? target : (target + 1) % NAMES.length;
  assert.ok(g.handle(other.id, { type: 'guess', n }), 'cannot guess out of turn');
  assert.strictEqual(g.handle(asker.id, { type: 'guess', n }), null);
  assert.strictEqual(g.phase, 'gameOver');
  assert.strictEqual(g.winner, correct ? asker.id : other.id);
  assert.ok(g.view('a').players.every((p) => p.secret !== null), 'secrets revealed at the end');
  assert.ok(g.handle(asker.id, { type: 'ask', q: 'x' }));
  // rematch resets everything
  assert.strictEqual(g.handle('a', { type: 'rematch' }), null);
  assert.strictEqual(g.phase, 'pick');
  assert.strictEqual(g.winner, null);
  assert.strictEqual(g.view('a').secret, null);
  assert.deepStrictEqual(g.history, []);
}

// ---- auto-play for an absent player ----
{
  const g = mk();
  g.autoAct('a'); assert.ok(g.players[0].secret !== null);
  g.autoAct('b'); assert.strictEqual(g.phase, 'ask');
  const asker = g.players[g.turn].id;
  g.autoAct(asker); assert.notStrictEqual(g.players[g.turn].id, asker, 'away asker passes');
  const asker2 = g.players[g.turn].id, ans = g.players[1 - g.turn].id;
  g.handle(asker2, { type: 'ask', q: 'q' });
  g.autoAct(ans);
  assert.strictEqual(g.history[0].a, 'skip');
  assert.strictEqual(g.phase, 'ask');
}

console.log('guesswho logic: OK');
