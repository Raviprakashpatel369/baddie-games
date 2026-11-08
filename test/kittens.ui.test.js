'use strict';
process.env.NOPE_MS = '1';
// Renders the Bomb Pussies client UI for every player at every step of random games.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const k = require('../games/kittens');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sandbox = { window: { Games: {} }, esc, console, document: { getElementById: () => null } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/games/kittens.js'), 'utf8'), sandbox);
const ui = sandbox.window.Games.kittens;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

let renders = 0;
for (let i = 0; i < 80; i++) {
  const g = new k.Game(Array.from({ length: 2 + (i % 4) }, (_, j) => ({ id: 'p' + j, name: 'P' + j })));
  const check = () => {
    for (const p of g.players) {
      const el = { innerHTML: '' };
      ui.render(el, g.view(p.id), { you: p.id, isHost: p.id === 'p0', send() {}, backToLobby() {} });
      assert.ok(el.innerHTML.length > 100);
      const bad = el.innerHTML.match(/.{40}(undefined|NaN|\[object).{40}/);
      assert.ok(!bad, 'bad value in markup: ' + (bad && bad[0]));
      renders++;
    }
  };
  let steps = 0;
  while (g.phase !== 'gameOver' && steps++ < 5000) {
    check();
    if (g.phase === 'reaction') {
      const nopers = g.alive().filter((p) => p.hand.some((c) => c.t === 'nope'));
      if (nopers.length && Math.random() < 0.3 && g.pending.nopes.length < 3) g.handle(rnd(nopers).id, { type: 'nope' });
      else g.tick(Date.now() + 10);
      continue;
    }
    const id = g.actor();
    const p = g.byId(id);
    if (g.phase === 'favor') g.handle(id, { type: 'give', id: rnd(p.hand).id });
    else if (g.phase === 'insert') g.handle(id, { type: 'insert', pos: Math.floor(Math.random() * (g.deck.length + 1)) });
    else {
      const acts = p.hand.filter((c) => ['attack', 'skip', 'shuffle', 'future'].includes(c.t));
      if (Math.random() < 0.4 && acts.length) g.handle(id, { type: 'play', ids: [rnd(acts).id] });
      else g.handle(id, { type: 'draw' });
    }
  }
  check();
}
console.log(`kittens ui: ${renders} renders OK`);

// ---- multi-step flows driven through the UI's click handler ----
{
  const g = new k.Game([{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]);
  g.turn = 0; g.turnsLeft = 1;
  const me = g.players[0];
  const add = (t) => { const c = g.mk(t); me.hand.push(c); return c; };
  const trio = [add('cat2'), add('cat2'), add('cat2')];
  const five = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'].map(add);
  g.discard.push(g.mk('skip'));
  const sent = [];
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = { you: 'p0', isHost: true, send: (a) => sent.push(a), backToLobby() {} };
  const draw = () => ui.render(el, g.view('p0'), ctx);
  const click = (k, data = {}) => el.onclick({ target: { closest: (s) => (s === 'summary' ? null : { dataset: { k, ...data }, disabled: false }) } });
  draw();

  // three of a kind: select 3 same cats -> Play -> target -> name -> send
  trio.forEach((c) => click('sel', { id: c.id }));
  assert.ok(/Three of a kind/.test(el.innerHTML), 'triple recognised');
  click('play');
  assert.ok(/Choose a target/.test(el.innerHTML));
  click('target', { id: 'p1' });
  assert.ok(/Name the card/.test(el.innerHTML));
  click('name', { t: 'defuse' });
  assert.deepEqual(sent.pop(), { type: 'play', ids: trio.map((c) => c.id), target: 'p1', name: 'defuse' });

  // five different: Play -> pick from discard -> send
  ui.render(el, g.view('p0'), ctx); // fresh render (new key not needed; selection cleared below)
  click('cancel');
  trio.forEach((c) => click('sel', { id: c.id })); // real server state would have cleared these
  const cur = g.view('p0');
  five.forEach((c) => click('sel', { id: c.id }));
  assert.ok(/Five different/.test(el.innerHTML), 'five recognised');
  click('play');
  assert.ok(/discard pile/.test(el.innerHTML));
  click('pick', { id: cur.discard[0].id });
  assert.deepEqual(sent.pop(), { type: 'play', ids: five.map((c) => c.id), pick: cur.discard[0].id });

  // invalid selections explain themselves and cannot be played
  click('cancel'); five.slice(1).forEach((c) => click('sel', { id: c.id })); // leave a single cat selected
  draw();
  assert.ok(/second matching cat/.test(el.innerHTML), 'hint shown');
  assert.ok(!/Play<small>/.test(el.innerHTML));

  // favor give: choose a card then Give
  const g2 = new k.Game([{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }]);
  g2.phase = 'favor'; g2.favor = { from: 'p0', to: 'p1' };
  const sent2 = [];
  const ctx2 = { you: 'p0', isHost: false, send: (a) => sent2.push(a), backToLobby() {} };
  ui.render(el, g2.view('p0'), ctx2);
  assert.ok(/data-k="give" disabled/.test(el.innerHTML), 'give disabled until a card is chosen');
  click('sel', { id: g2.players[0].hand[2].id });
  assert.ok(!/data-k="give" disabled/.test(el.innerHTML));
  click('give');
  assert.deepEqual(sent2.pop(), { type: 'give', id: g2.players[0].hand[2].id });
  console.log('kittens ui: multi-step flows OK');
}
