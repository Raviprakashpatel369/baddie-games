'use strict';
process.env.NOPE_MS = '1';
const assert = require('assert');
const k = require('../games/kittens');
const { CATS } = k._internals;
const mk = (n) => new k.Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
const flush = (g) => { while (g.phase === 'reaction') g.tick(Date.now() + 10); };
const count = (g, t) => g.deck.concat(g.discard, ...g.players.map((p) => p.hand)).filter((c) => c.t === t).length;
const give = (g, p, ...types) => { for (const t of types) p.hand.push(g.mk(t)); return p.hand.slice(-types.length); };

// ---- setup ----
for (let n = 2; n <= 5; n++) assert.strictEqual(mk(n)._count(), 46 + n + (n - 1) + Math.min(2, 6 - n), 'card total, n=' + n);
assert.strictEqual(mk(5)._count(), 56, 'a 5-player game uses the full 56-card deck');
{
  const g = mk(4);
  assert.strictEqual(g.deck.filter((c) => c.t === 'ek').length, 3, 'players-1 kittens');
  assert.ok(g.players.every((p) => p.hand.length === 8 && p.hand.filter((c) => c.t === 'defuse').length === 1));
  assert.strictEqual(count(g, 'defuse') + 0, 4 + 2);
}

// ---- nope: odd cancels, even resolves ----
{
  const g = mk(3); g.turn = 0; g.turnsLeft = 1;
  const [atk] = give(g, g.players[0], 'attack');
  give(g, g.players[1], 'nope', 'nope');
  assert.strictEqual(g.handle('p0', { type: 'play', ids: [atk.id] }), null);
  assert.strictEqual(g.phase, 'reaction');
  assert.notStrictEqual(g.handle('p0', { type: 'draw' }), null, 'cannot draw during reaction');
  assert.strictEqual(g.handle('p1', { type: 'nope' }), null);
  flush(g);
  assert.strictEqual(g.turn, 0, 'noped attack: still p0 turn');
  assert.strictEqual(g.phase, 'turn');
  give(g, g.players[1], 'nope');
  const [atk2] = give(g, g.players[0], 'attack');
  g.handle('p0', { type: 'play', ids: [atk2.id] });
  g.handle('p1', { type: 'nope' }); g.handle('p1', { type: 'nope' });
  flush(g);
  assert.strictEqual(g.turn, 1); assert.strictEqual(g.turnsLeft, 2, 'attack gives 2 turns');
}
// ---- attack stacking & skip ----
{
  const g = mk(3); g.turn = 1; g.turnsLeft = 2;
  const [atk] = give(g, g.players[1], 'attack');
  g.handle('p1', { type: 'play', ids: [atk.id] }); flush(g);
  assert.strictEqual(g.turn, 2); assert.strictEqual(g.turnsLeft, 4, 'attacked player attacking stacks');
  const [sk] = give(g, g.players[2], 'skip');
  g.handle('p2', { type: 'play', ids: [sk.id] }); flush(g);
  assert.strictEqual(g.turn, 2); assert.strictEqual(g.turnsLeft, 3, 'skip ends only one turn');
}
// ---- defuse & explode ----
{
  const g = mk(3); g.turn = 0; g.turnsLeft = 1;
  const ek = g.mk('ek'); g.deck.push(ek);
  const before = g.players[0].hand.length;
  g.handle('p0', { type: 'draw' });
  assert.strictEqual(g.phase, 'insert'); assert.strictEqual(g.players[0].hand.length, before - 1, 'defuse used');
  assert.ok(g.handle('p1', { type: 'insert', pos: 0 }), 'only drawer inserts');
  g.handle('p0', { type: 'insert', pos: 0 });
  assert.strictEqual(g.deck[g.deck.length - 1], ek, 'kitten on top');
  assert.strictEqual(g.turn, 1);
  g.players[1].hand = g.players[1].hand.filter((c) => c.t !== 'defuse');
  g.handle('p1', { type: 'draw' });
  assert.strictEqual(g.players[1].alive, false); assert.strictEqual(g.turn, 2);
  assert.notStrictEqual(g.handle('p1', { type: 'draw' }), null);
}
// ---- favor / pair / triple / five / future ----
{
  const g = mk(3); g.turn = 0; g.turnsLeft = 1;
  const [f] = give(g, g.players[0], 'favor');
  g.handle('p0', { type: 'play', ids: [f.id], target: 'p1' }); flush(g);
  assert.strictEqual(g.phase, 'favor');
  const gift = g.players[1].hand[0], n0 = g.players[0].hand.length;
  assert.ok(g.handle('p0', { type: 'give', id: gift.id }), 'only target gives');
  assert.strictEqual(g.handle('p1', { type: 'give', id: gift.id }), null);
  assert.strictEqual(g.players[0].hand.length, n0 + 1); assert.strictEqual(g.phase, 'turn');

  const [c1, c2] = give(g, g.players[0], 'cat1', 'cat1');
  assert.ok(g.handle('p0', { type: 'play', ids: [c1.id], target: 'p1' }), 'single cat rejected');
  const n1 = g.players[1].hand.length;
  g.handle('p0', { type: 'play', ids: [c1.id, c2.id], target: 'p1' }); flush(g);
  assert.strictEqual(g.players[1].hand.length, n1 - 1, 'pair steals one');

  const [d] = give(g, g.players[1], 'defuse');
  const trio = give(g, g.players[0], 'cat2', 'cat2', 'cat2');
  g.players[1].hand = g.players[1].hand.filter((c) => c.t !== 'defuse' || c === d);
  g.handle('p0', { type: 'play', ids: trio.map((c) => c.id), target: 'p1', name: 'defuse' }); flush(g);
  assert.ok(g.players[0].hand.some((c) => c.id === d.id), 'triple takes the named card');

  const five = give(g, g.players[0], ...CATS);
  const pick = g.discard[0];
  g.handle('p0', { type: 'play', ids: five.map((c) => c.id), pick: pick.id }); flush(g);
  assert.ok(g.players[0].hand.some((c) => c.id === pick.id), 'took from discard');

  const [fu] = give(g, g.players[0], 'future');
  const top3 = g.deck.slice(-3).reverse().map((c) => c.t);
  g.handle('p0', { type: 'play', ids: [fu.id] }); flush(g);
  assert.deepStrictEqual(g.view('p0').peek, top3);
  assert.strictEqual(g.view('p1').peek, null, 'peek is private');
}
// ---- views never leak other hands ----
{
  const g = mk(3); const v = g.view('p0');
  assert.strictEqual(v.hand.length, 8); assert.ok(!('hand' in v.players[1])); assert.strictEqual(v.players[1].count, 8);
}

// ---- random full games: conservation + termination ----
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
for (let i = 0; i < 400; i++) {
  const g = mk(2 + (i % 4));
  let steps = 0; const total = g._count();
  while (g.phase !== 'gameOver') {
    assert.ok(++steps < 5000, 'stalled in phase ' + g.phase);
    assert.strictEqual(g._count(), total, 'card conservation');
    if (g.phase === 'reaction') {
      const nopers = g.alive().filter((p) => p.hand.some((c) => c.t === 'nope'));
      if (nopers.length && Math.random() < 0.3 && g.pending.nopes.length < 3) assert.strictEqual(g.handle(rnd(nopers).id, { type: 'nope' }), null);
      else g.tick(Date.now() + 10);
      continue;
    }
    const id = g.actor(); assert.ok(id); const p = g.byId(id);
    if (g.phase === 'favor') { assert.strictEqual(g.handle(id, { type: 'give', id: rnd(p.hand).id }), null); continue; }
    if (g.phase === 'insert') { assert.strictEqual(g.handle(id, { type: 'insert', pos: Math.floor(Math.random() * (g.deck.length + 1)) }), null); continue; }
    const others = g.alive().filter((q) => q !== p && q.hand.length);
    const acts = p.hand.filter((c) => ['attack', 'skip', 'shuffle', 'future'].includes(c.t));
    const favs = p.hand.filter((c) => c.t === 'favor');
    const cats = CATS.map((t) => p.hand.filter((c) => c.t === t)).filter((a) => a.length >= 2);
    const r = Math.random();
    let err;
    if (r < 0.3 && acts.length) err = g.handle(id, { type: 'play', ids: [rnd(acts).id] });
    else if (r < 0.4 && favs.length && others.length) err = g.handle(id, { type: 'play', ids: [favs[0].id], target: rnd(others).id });
    else if (r < 0.5 && cats.length && others.length) {
      const grp = rnd(cats); const n = grp.length >= 3 && Math.random() < 0.5 ? 3 : 2;
      err = g.handle(id, { type: 'play', ids: grp.slice(0, n).map((c) => c.id), target: rnd(others).id, name: rnd(['nope', 'defuse', 'attack']) });
    } else err = g.handle(id, { type: 'draw' });
    assert.strictEqual(err, null, err);
  }
  assert.strictEqual(g.alive().length, 1); assert.ok(g.winner); g.view('p0');
}
console.log('kittens: setup, rules and 400 random games OK');
