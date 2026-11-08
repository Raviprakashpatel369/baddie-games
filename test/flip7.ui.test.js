'use strict';
// Renders the Flip Seven client UI for every player at every step of random games.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const flip7 = require('../games/flip7');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sandbox = { window: { Games: {} }, esc, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/games/flip7.js'), 'utf8'), sandbox);
const ui = sandbox.window.Games.flip7;

let renders = 0;
for (let i = 0; i < 100; i++) {
  const n = 2 + (i % 7);
  const g = new flip7.Game(Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k })));
  const check = () => {
    const v = g.view();
    for (const p of g.players) {
      const el = { innerHTML: '' };
      ui.render(el, v, { you: p.id, isHost: p.id === 'p0', send() {}, backToLobby() {} });
      assert.ok(el.innerHTML.length > 100);
      assert.ok(!/undefined|NaN|null/.test(el.innerHTML), 'bad value in markup: ' + (el.innerHTML.match(/.{30}(undefined|NaN|null).{30}/) || [])[0]);
      renders++;
    }
  };
  let steps = 0;
  while (g.phase !== 'gameOver' && steps++ < 20000) {
    check();
    if (g.phase === 'roundEnd') { g.handle('p0', { type: 'next' }); continue; }
    const id = g.actor();
    const p = g.byId(id);
    if (g.pending) g.handle(id, { type: 'target', target: g.players.filter((q) => q.status === 'active')[0].id });
    else g.handle(id, { type: Math.random() < 0.6 || !(p.numbers.length || p.mods.length) ? 'hit' : 'stay' });
  }
  check();
}
console.log(`flip7 ui: ${renders} renders OK`);
