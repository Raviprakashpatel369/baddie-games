'use strict';
// Renders the Guess Who client UI for both players at every step of random games.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gw = require('../games/guesswho');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sandbox = { window: { Games: {} }, esc, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/games/guesswho.js'), 'utf8'), sandbox);
const ui = sandbox.window.Games.guesswho;

let renders = 0;
for (let i = 0; i < 100; i++) {
  const g = new gw.Game([{ id: 'a', name: 'Alice <b>' }, { id: 'b', name: 'Bob' }]);
  const check = () => {
    for (const id of ['a', 'b']) {
      const el = { innerHTML: '' };
      ui.render(el, g.view(id), { you: id, isHost: id === 'a', send() {}, backToLobby() {} });
      assert.ok(el.innerHTML.length > 500);
      assert.ok(!/undefined|NaN|null/.test(el.innerHTML), 'bad value in markup: ' + (el.innerHTML.match(/.{30}(undefined|NaN|null).{30}/) || [])[0]);
      assert.ok(!el.innerHTML.includes('Alice <b>'), 'names are escaped');
      renders++;
    }
  };
  check();
  g.handle('a', { type: 'pick', n: Math.floor(Math.random() * 34) }); check();
  g.handle('b', { type: 'pick', n: Math.floor(Math.random() * 34) }); check();
  let steps = 0;
  while (g.phase !== 'gameOver' && steps++ < 50) {
    const id = g.actor();
    if (g.phase === 'ask') {
      g.handle(id, { type: 'toggle', n: steps });
      if (Math.random() < 0.2) g.handle(id, { type: 'guess', n: Math.floor(Math.random() * 34) });
      else g.handle(id, { type: 'ask', q: 'Is it "someone" & <tall>?' });
    } else if (g.phase === 'answer') g.handle(id, { type: 'answer', a: Math.random() < 0.5 ? 'yes' : 'no' });
    check();
  }
  g.handle('a', { type: 'rematch' });
  check();
}
console.log(`guesswho ui: ${renders} renders OK`);
