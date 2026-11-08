'use strict';
// "Bomb Pussies" — an Exploding Kittens-style game. Pure game logic, no networking.
// Same game interface as the others, plus the optional timer hooks used for the
// Nope window: nextDeadline() and tick(now).

const NOPE_MS = Number(process.env.NOPE_MS) || 3500;
const CATS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
const ACTIONS = ['attack', 'skip', 'favor', 'shuffle', 'future'];
const NAMEABLE = ['defuse', 'nope', 'attack', 'skip', 'favor', 'shuffle', 'future', ...CATS];
const LABEL = {
  ek: 'Exploding Kitten', defuse: 'Defuse', nope: 'Nope', attack: 'Attack', skip: 'Skip', favor: 'Favor',
  shuffle: 'Shuffle', future: 'See the Future', cat1: 'Tacocat', cat2: 'Hairy Potato Cat', cat3: 'Beard Cat',
  cat4: 'Rainbow-Ralphing Cat', cat5: 'Cattermelon',
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Kittens {
  constructor(players) {
    this.cid = 0;
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], alive: true }));
    const n = this.players.length;

    // Base deck: everything except Exploding Kittens and Defuses.
    const deck = [];
    const add = (t, count) => { for (let i = 0; i < count; i++) deck.push(this.mk(t)); };
    add('nope', 5);
    for (const t of ['attack', 'skip', 'favor', 'shuffle']) add(t, 4);
    add('future', 5);
    for (const t of CATS) add(t, 4);
    shuffle(deck);
    // Deal 7 cards + 1 Defuse each.
    for (const p of this.players) {
      for (let i = 0; i < 7; i++) p.hand.push(deck.pop());
      p.hand.push(this.mk('defuse'));
    }
    // Put Exploding Kittens (players - 1) and the spare Defuses (max 2) into the pile.
    for (let i = 0; i < n - 1; i++) deck.push(this.mk('ek'));
    for (let i = 0; i < Math.min(2, 6 - n); i++) deck.push(this.mk('defuse'));
    this.deck = shuffle(deck); // top of the pile = END of the array
    this.discard = [];

    this.log = [];
    this.phase = 'turn'; // turn | reaction | favor | insert | gameOver
    this.turn = Math.floor(Math.random() * n);
    this.turnsLeft = 1;
    this.pending = null;
    this.favor = null;
    this.ek = null;
    this.peek = null;
    this.dl = null;
    this.winner = null;
    this.say(`${this.players[this.turn].name} goes first.`);
  }

  mk(t) { return { id: ++this.cid, t }; }
  say(m) { this.log.push(m); if (this.log.length > 50) this.log.shift(); }
  byId(id) { return this.players.find((p) => p.id === id); }
  get cur() { return this.players[this.turn]; }
  alive() { return this.players.filter((p) => p.alive); }

  nextAliveFrom(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (this.players[j].alive) return j;
    }
    return i;
  }

  nextTurn(turns) {
    this.turn = this.nextAliveFrom(this.turn);
    this.turnsLeft = turns;
    this.peek = null;
    this.say(`${this.cur.name}'s turn${turns > 1 ? ` (${turns} turns)` : ''}.`);
  }

  endOneTurn() {
    this.turnsLeft--;
    if (this.turnsLeft <= 0) this.nextTurn(1);
    else this.peek = null;
  }

  drawTop() {
    if (!this.deck.length && this.discard.length) {
      this.deck = shuffle(this.discard);
      this.discard = [];
      this.say('The draw pile ran out — discard pile reshuffled.');
    }
    return this.deck.pop() || null;
  }

  // ---- timers (Nope window) ----
  nextDeadline() { return this.phase === 'reaction' ? this.dl : null; }
  tick(now) {
    if (this.phase === 'reaction' && now >= this.dl) {
      this.resolve();
      return true;
    }
    return false;
  }

  actor() {
    if (this.phase === 'turn' || this.phase === 'insert') return this.cur.id;
    if (this.phase === 'favor') return this.favor.from;
    return null;
  }

  // ---- actions ----
  handle(pid, a) {
    if (!a || typeof a !== 'object') return 'Bad action';
    const p = this.byId(pid);
    if (!p) return 'Not in this game';
    if (this.phase === 'gameOver') return 'Game is over';
    if (!p.alive) return "You're out — spectating";

    if (this.phase === 'reaction') {
      if (a.type !== 'nope') return 'Wait — a card is being played (you can Nope it)';
      const i = p.hand.findIndex((c) => c.t === 'nope');
      if (i < 0) return "You don't have a Nope";
      const [card] = p.hand.splice(i, 1);
      this.discard.push(card);
      this.pending.nopes.push(pid);
      this.dl = Date.now() + NOPE_MS;
      this.say(`${p.name} played NOPE!`);
      return null;
    }
    if (this.phase === 'favor') {
      if (a.type !== 'give' || pid !== this.favor.from) return 'Waiting for someone to hand over a card';
      const i = p.hand.findIndex((c) => c.id === a.id);
      if (i < 0) return 'Pick a card from your hand';
      const to = this.byId(this.favor.to);
      to.hand.push(...p.hand.splice(i, 1));
      this.say(`${p.name} gave ${to.name} a card.`);
      this.favor = null;
      this.phase = 'turn';
      return null;
    }
    if (this.phase === 'insert') {
      if (a.type !== 'insert' || pid !== this.cur.id) return 'Waiting for the kitten to be hidden';
      const pos = Math.max(0, Math.min(this.deck.length, Math.floor(Number(a.pos)) || 0));
      this.deck.splice(this.deck.length - pos, 0, this.ek);
      this.ek = null;
      this.peek = null;
      this.say(`${p.name} secretly put the Exploding Kitten back in the pile.`);
      this.phase = 'turn';
      this.endOneTurn();
      return null;
    }
    // phase === 'turn'
    if (pid !== this.cur.id) {
      return a.type === 'nope' ? 'Nope can only be played in response to a card' : 'Not your turn';
    }
    if (a.type === 'draw') return this.draw(p);
    if (a.type === 'play') return this.play(p, a);
    return 'Bad action';
  }

  draw(p) {
    this.peek = null;
    const card = this.drawTop();
    if (!card) {
      this.say('The draw pile is empty!');
      this.endOneTurn();
      return null;
    }
    if (card.t !== 'ek') {
      p.hand.push(card);
      this.say(`${p.name} drew a card.`);
      this.endOneTurn();
      return null;
    }
    const di = p.hand.findIndex((c) => c.t === 'defuse');
    if (di >= 0) {
      this.discard.push(...p.hand.splice(di, 1));
      this.ek = card;
      this.phase = 'insert';
      this.say(`${p.name} drew an EXPLODING KITTEN and used a Defuse!`);
      return null;
    }
    p.alive = false;
    this.discard.push(card, ...p.hand);
    p.hand = [];
    this.say(`💥 ${p.name} drew an EXPLODING KITTEN and blew up!`);
    const left = this.alive();
    if (left.length === 1) {
      this.phase = 'gameOver';
      this.winner = left[0].id;
      this.say(`🏆 ${left[0].name} is the last one standing!`);
    } else {
      this.nextTurn(1);
    }
    return null;
  }

  targetOf(p, id) {
    const t = this.byId(id);
    if (!t || !t.alive || t === p) return null;
    return t.hand.length ? t : null;
  }

  play(p, a) {
    if (!Array.isArray(a.ids) || a.ids.length < 1 || a.ids.length > 5) return 'Pick the card(s) to play';
    if (new Set(a.ids).size !== a.ids.length) return 'Bad selection';
    const cards = a.ids.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) return 'You do not hold those cards';
    const types = cards.map((c) => c.t);
    const pd = { by: p.id, cards: cards.map((c) => c.t), nopes: [] };

    if (cards.length === 1) {
      const t = types[0];
      if (t === 'nope') return 'Nope can only be played in response to another card';
      if (t === 'defuse') return 'Defuse is only used when you draw an Exploding Kitten';
      if (t === 'ek') return 'Bad card';
      if (CATS.includes(t)) return 'Cat cards must be played as a pair, three of a kind, or five different';
      pd.kind = t;
      if (t === 'favor') {
        const tg = this.targetOf(p, a.target);
        if (!tg) return 'Pick a player who has cards';
        pd.target = tg.id;
      }
    } else if (cards.length === 2 || cards.length === 3) {
      if (!CATS.includes(types[0]) || types.some((t) => t !== types[0])) return 'You need matching cat cards';
      const tg = this.targetOf(p, a.target);
      if (!tg) return 'Pick a player who has cards';
      pd.target = tg.id;
      if (cards.length === 2) pd.kind = 'pair';
      else {
        if (!NAMEABLE.includes(a.name)) return 'Name a card to ask for';
        pd.kind = 'triple';
        pd.name = a.name;
      }
    } else if (cards.length === 5) {
      if (types.some((t) => !CATS.includes(t)) || new Set(types).size !== 5) return 'Five different cat cards needed';
      if (!this.discard.some((c) => c.id === a.pick)) return 'Pick a card from the discard pile';
      pd.kind = 'five';
      pd.pick = a.pick;
    } else {
      return 'Those cards cannot be played together';
    }

    p.hand = p.hand.filter((c) => !a.ids.includes(c.id));
    this.discard.push(...cards);
    this.pending = pd;
    this.phase = 'reaction';
    this.dl = Date.now() + NOPE_MS;
    const tgName = pd.target ? ` on ${this.byId(pd.target).name}` : '';
    this.say(`${p.name} played ${this.describe(pd)}${tgName}…`);
    return null;
  }

  describe(pd) {
    if (pd.kind === 'pair') return `a pair of ${LABEL[pd.cards[0]]}s`;
    if (pd.kind === 'triple') return `three ${LABEL[pd.cards[0]]}s (asking for ${LABEL[pd.name]})`;
    if (pd.kind === 'five') return 'five different cats';
    return LABEL[pd.kind];
  }

  resolve() {
    const pd = this.pending;
    const by = this.byId(pd.by);
    this.pending = null;
    this.phase = 'turn';
    this.dl = null;
    if (pd.nopes.length % 2 === 1) {
      this.say(`🚫 ${by.name}'s ${this.describe(pd)} was NOPED!`);
      return;
    }
    const tg = pd.target ? this.byId(pd.target) : null;
    switch (pd.kind) {
      case 'attack': {
        const turns = this.turnsLeft > 1 ? this.turnsLeft + 2 : 2;
        this.say(`${by.name} attacks! No draw — the next player takes ${turns} turns.`);
        this.nextTurn(turns);
        break;
      }
      case 'skip':
        this.say(`${by.name} skipped.`);
        this.endOneTurn();
        break;
      case 'shuffle':
        shuffle(this.deck);
        this.peek = null;
        this.say(`${by.name} shuffled the draw pile.`);
        break;
      case 'future':
        this.peek = { by: by.id, cards: this.deck.slice(-3).reverse().map((c) => c.t) };
        this.say(`${by.name} peeks at the top of the pile.`);
        break;
      case 'favor':
        if (!tg.hand.length) this.say(`${tg.name} has no cards to give.`);
        else {
          this.favor = { from: tg.id, to: by.id };
          this.phase = 'favor';
          this.say(`${tg.name} must give ${by.name} a card.`);
        }
        break;
      case 'pair': {
        if (!tg.hand.length) { this.say(`${tg.name} has no cards.`); break; }
        const [c] = tg.hand.splice(Math.floor(Math.random() * tg.hand.length), 1);
        by.hand.push(c);
        this.say(`${by.name} stole a random card from ${tg.name}.`);
        break;
      }
      case 'triple': {
        const i = tg.hand.findIndex((c) => c.t === pd.name);
        if (i < 0) this.say(`${tg.name} doesn't have a ${LABEL[pd.name]}.`);
        else {
          by.hand.push(...tg.hand.splice(i, 1));
          this.say(`${by.name} took a ${LABEL[pd.name]} from ${tg.name}!`);
        }
        break;
      }
      case 'five': {
        const i = this.discard.findIndex((c) => c.id === pd.pick);
        if (i < 0) break;
        const [c] = this.discard.splice(i, 1);
        by.hand.push(c);
        this.say(`${by.name} took a ${LABEL[c.t]} from the discard pile.`);
        break;
      }
    }
  }

  autoAct(pid) {
    if (this.actor() !== pid) return;
    if (this.phase === 'favor') {
      const p = this.byId(pid);
      this.handle(pid, { type: 'give', id: p.hand[Math.floor(Math.random() * p.hand.length)].id });
    } else if (this.phase === 'insert') {
      this.handle(pid, { type: 'insert', pos: Math.floor(Math.random() * (this.deck.length + 1)) });
    } else {
      this.handle(pid, { type: 'draw' });
    }
  }

  view(pid) {
    const me = this.byId(pid);
    const pd = this.pending;
    return {
      type: 'kittens',
      phase: this.phase,
      turn: this.phase === 'gameOver' ? null : this.cur.id,
      turnsLeft: this.turnsLeft,
      deckCount: this.deck.length,
      discard: this.discard.map((c) => ({ id: c.id, t: c.t })),
      players: this.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, count: p.hand.length })),
      hand: me && me.alive ? me.hand : [],
      pending: pd
        ? {
            by: pd.by, kind: pd.kind, cards: pd.cards, target: pd.target || null, name: pd.name || null,
            nopes: pd.nopes.length, ms: Math.max(0, this.dl - Date.now()), total: NOPE_MS,
          }
        : null,
      favor: this.favor,
      insert: this.phase === 'insert' ? { by: this.cur.id, deckCount: this.deck.length } : null,
      peek: this.peek && this.peek.by === pid ? this.peek.cards : null,
      winner: this.winner,
      log: this.log.slice(-30),
    };
  }

  // test helper: every card must be in exactly one place
  _count() {
    return this.deck.length + this.discard.length + (this.ek ? 1 : 0) +
      this.players.reduce((s, p) => s + p.hand.length, 0);
  }
}

module.exports = {
  id: 'kittens',
  name: 'Bomb Pussies',
  desc: 'Draw cards, dodge the Exploding Kitten, and stay alive! Play Attacks, Skips, Favors and Nopes to be the last one standing.',
  min: 2,
  max: 5,
  Game: Kittens,
  _internals: { LABEL, CATS, ACTIONS },
};
