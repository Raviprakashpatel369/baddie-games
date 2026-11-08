'use strict';
// "Flip 7"-inspired push-your-luck card game. Pure game logic, no networking.
// Game interface (shared by all games): constructor(players), handle(pid, action),
// view(pid), actor(), autoAct(pid).

const TARGET = 200;
const FLIP7_BONUS = 15;

function buildDeck() {
  const d = [];
  for (let n = 0; n <= 12; n++) {
    const copies = n === 0 ? 1 : n;
    for (let i = 0; i < copies; i++) d.push({ k: 'n', v: n });
  }
  for (const v of [2, 4, 6, 8, 10]) d.push({ k: 'm', m: '+' + v, v });
  d.push({ k: 'm', m: 'x2' });
  for (const a of ['freeze', 'flip3', 'second']) {
    for (let i = 0; i < 3; i++) d.push({ k: 'a', a });
  }
  return d;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function score(p) {
  let s = p.numbers.reduce((a, b) => a + b, 0);
  if (p.mods.some((m) => m.m === 'x2')) s *= 2;
  for (const m of p.mods) if (m.m !== 'x2') s += m.v;
  if (p.flip7) s += FLIP7_BONUS;
  return s;
}

class Flip7 {
  constructor(players) {
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      total: 0,
      numbers: [],
      mods: [],
      second: false,
      status: 'active',
      flip7: false,
    }));
    this.deck = shuffle(buildDeck());
    this.discard = [];
    this.round = 0;
    this.dealer = -1;
    this.log = [];
    this.lastRound = null;
    this.winner = null;
    this.startRound();
  }

  say(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  byId(id) {
    return this.players.find((p) => p.id === id);
  }

  startRound() {
    this.round++;
    this.dealer = (this.dealer + 1) % this.players.length;
    for (const p of this.players) {
      p.numbers = [];
      p.mods = [];
      p.second = false;
      p.status = 'active';
      p.flip7 = false;
    }
    this.pending = null;
    this.queue = [];
    this.flip7By = null;
    this.phase = 'playing';
    this.turn = this.nextActiveFrom(this.dealer);
    this.say(`— Round ${this.round} — ${this.players[this.dealer].name} deals`);
  }

  nextActiveFrom(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (this.players[j].status === 'active') return j;
    }
    return -1;
  }

  draw() {
    if (this.deck.length === 0 && this.discard.length) {
      this.deck = shuffle(this.discard);
      this.discard = [];
      this.say('Deck reshuffled.');
    }
    return this.deck.pop() || null;
  }

  receive(p, card, defer) {
    if (card.k === 'n') {
      if (p.numbers.includes(card.v)) {
        if (p.second) {
          p.second = false;
          this.discard.push(card, { k: 'a', a: 'second' });
          this.say(`${p.name} flipped a duplicate ${card.v} — Second Chance saved them!`);
        } else {
          p.status = 'busted';
          this.discard.push(card);
          this.say(`${p.name} flipped a duplicate ${card.v} and BUSTED!`);
        }
        return;
      }
      p.numbers.push(card.v);
      this.say(`${p.name} flipped a ${card.v}.`);
      if (p.numbers.length === 7) {
        p.flip7 = true;
        this.flip7By = p;
        this.say(`${p.name} FLIPPED 7 UNIQUE NUMBERS! +${FLIP7_BONUS} bonus!`);
      }
    } else if (card.k === 'm') {
      p.mods.push(card);
      this.say(`${p.name} got a ${card.m} modifier.`);
    } else if (card.a === 'second') {
      if (!p.second) {
        p.second = true;
        this.say(`${p.name} got a Second Chance.`);
      } else {
        const o = this.players.find((q) => q !== p && q.status === 'active' && !q.second);
        if (o) {
          o.second = true;
          this.say(`${p.name} already had one, so ${o.name} gets the Second Chance.`);
        } else {
          this.discard.push(card);
          this.say(`${p.name} drew a spare Second Chance — discarded.`);
        }
      }
    } else {
      // freeze / flip3 need a target
      if (defer) defer.push({ card, from: p.id });
      else this.pending = { card, from: p.id };
      this.say(`${p.name} drew ${card.a === 'freeze' ? 'Freeze' : 'Flip Three'}!`);
    }
  }

  hit(p) {
    const card = this.draw();
    if (!card) {
      p.status = 'stayed';
      this.say('The deck is empty — no card to flip.');
      return;
    }
    this.receive(p, card, null);
  }

  resolveTarget(t) {
    const { card } = this.pending;
    this.pending = null;
    this.discard.push(card);
    if (card.a === 'freeze') {
      t.status = 'frozen';
      this.say(`${t.name} was FROZEN and banks their points.`);
      return;
    }
    this.say(`${t.name} must flip three cards!`);
    const defer = [];
    for (let i = 0; i < 3; i++) {
      if (t.status !== 'active' || this.flip7By) break;
      const c = this.draw();
      if (!c) break;
      this.receive(t, c, defer);
    }
    if (t.status === 'active' && !this.flip7By) this.queue.push(...defer);
    else for (const d of defer) this.discard.push(d.card);
  }

  advance() {
    for (;;) {
      if (this.flip7By || !this.players.some((p) => p.status === 'active')) {
        return this.endRound();
      }
      if (this.pending) return;
      if (this.queue.length) {
        const next = this.queue.shift();
        const from = this.byId(next.from);
        if (from.status !== 'active') {
          this.discard.push(next.card);
          continue;
        }
        this.pending = next;
        return;
      }
      this.turn = this.nextActiveFrom(this.turn);
      return;
    }
  }

  endRound() {
    const results = this.players.map((p) => {
      const pts = p.status === 'busted' ? 0 : score(p);
      p.total += pts;
      return { id: p.id, name: p.name, status: p.status, points: pts, total: p.total, flip7: p.flip7 };
    });
    this.lastRound = results;
    for (const p of this.players) {
      for (const v of p.numbers) this.discard.push({ k: 'n', v });
      this.discard.push(...p.mods);
      if (p.second) this.discard.push({ k: 'a', a: 'second' });
    }
    this.pending = null;
    this.queue = [];
    const max = Math.max(...this.players.map((p) => p.total));
    const top = this.players.filter((p) => p.total === max);
    if (max >= TARGET && top.length === 1) {
      this.phase = 'gameOver';
      this.winner = top[0].id;
      this.say(`${top[0].name} wins the game with ${max} points!`);
    } else {
      this.phase = 'roundEnd';
    }
  }

  actor() {
    if (this.phase !== 'playing') return null;
    return this.pending ? this.pending.from : this.players[this.turn].id;
  }

  handle(pid, a) {
    if (!a || typeof a !== 'object') return 'Bad action';
    if (this.phase === 'roundEnd') {
      if (a.type !== 'next') return 'Round is over';
      this.startRound();
      return null;
    }
    if (this.phase !== 'playing') return 'Game is over';
    if (this.pending) {
      if (a.type !== 'target' || pid !== this.pending.from) return 'Not your decision';
      const t = this.byId(a.target);
      if (!t || t.status !== 'active') return 'Invalid target';
      this.resolveTarget(t);
      this.advance();
      return null;
    }
    const p = this.players[this.turn];
    if (p.id !== pid) return 'Not your turn';
    if (a.type === 'hit') {
      this.hit(p);
    } else if (a.type === 'stay') {
      if (!p.numbers.length && !p.mods.length) return 'Flip at least one card first';
      p.status = 'stayed';
      this.say(`${p.name} stays with ${score(p)}.`);
    } else {
      return 'Bad action';
    }
    this.advance();
    return null;
  }

  autoAct(pid) {
    if (this.actor() !== pid) return;
    if (this.pending) {
      const opts = this.players.filter((p) => p.status === 'active');
      this.handle(pid, { type: 'target', target: opts[Math.floor(Math.random() * opts.length)].id });
    } else {
      const p = this.byId(pid);
      this.handle(pid, { type: p.numbers.length || p.mods.length ? 'stay' : 'hit' });
    }
  }

  view() {
    return {
      type: 'flip7',
      phase: this.phase,
      round: this.round,
      target: TARGET,
      bonus: FLIP7_BONUS,
      deckCount: this.deck.length,
      dealer: this.players[this.dealer].id,
      turn: this.phase === 'playing' ? this.players[this.turn].id : null,
      pending: this.pending
        ? {
            from: this.pending.from,
            card: this.pending.card.a,
            targets: this.players.filter((p) => p.status === 'active').map((p) => p.id),
          }
        : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        numbers: p.numbers,
        mods: p.mods.map((m) => m.m),
        second: p.second,
        status: p.status,
        flip7: p.flip7,
        total: p.total,
        score: p.status === 'busted' ? 0 : score(p),
      })),
      lastRound: this.lastRound,
      winner: this.winner,
      log: this.log.slice(-25),
    };
  }
}

module.exports = {
  id: 'flip7',
  name: 'Flip Seven',
  desc: 'Push your luck! Flip cards, never repeat a number, and race to 200. Seven unique cards ends the round with a bonus.',
  min: 2,
  max: 8,
  Game: Flip7,
  _internals: { buildDeck, score, TARGET },
};
