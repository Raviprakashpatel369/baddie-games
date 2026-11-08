'use strict';
// Plays many random games to make sure the rules engine never throws or stalls.
const assert = require('assert');
const flip7 = require('../games/flip7');
const { buildDeck, score } = flip7._internals;

assert.strictEqual(buildDeck().length, 94, 'deck should have 94 cards');
assert.strictEqual(score({ numbers: [5, 7], mods: [{ m: 'x2' }, { m: '+4', v: 4 }], flip7: false }), 28);
assert.strictEqual(score({ numbers: [1, 2, 3, 4, 5, 6, 7], mods: [], flip7: true }), 43);

for (let i = 0; i < 500; i++) {
  const n = 2 + (i % 7);
  const g = new flip7.Game(Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k })));
  let steps = 0;
  while (g.phase !== 'gameOver') {
    if (++steps > 20000) throw new Error('game stalled');
    if (g.phase === 'roundEnd') {
      assert.strictEqual(g.handle('p0', { type: 'next' }), null);
      continue;
    }
    const id = g.actor();
    assert.ok(id, 'someone must be able to act');
    const p = g.byId(id);
    const err = g.pending
      ? g.handle(id, { type: 'target', target: g.players.filter((q) => q.status === 'active')[0].id })
      : g.handle(id, { type: Math.random() < 0.6 || !(p.numbers.length || p.mods.length) ? 'hit' : 'stay' });
    assert.strictEqual(err, null, err);
    g.view();
  }
  assert.ok(g.winner);
}
console.log('flip7: 500 random games OK');
