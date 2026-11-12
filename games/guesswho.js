'use strict';
// "Guess Who?" for exactly two players. Pure game logic, no networking.
// Each player secretly picks a name from the board, then they take turns asking the
// other a yes/no question (typed in, answered honestly by the opponent) and finally
// make a guess. Right guess wins, wrong guess loses.
// Game interface (shared by all games): constructor(players), handle(pid, action),
// view(pid), actor(), autoAct(pid).

const NAMES = [
  'Rinku', 'Frooti', 'Siddu', 'Dolly', 'Bittu', 'Pandu', 'Sweety', 'Kanna', 'Swetha', 'Vijitha',
  'Ramya', 'Srinivas', 'Chaithanya', 'Ratnankar', 'Balaji', 'Kavitha', 'Ravi', 'Kumar', 'Sabitha',
  'Kishan', 'Vijaya Laxmi', 'Leela Devi', 'Veera Bhadraiah', 'Komuramma', 'Sathya Narayana',
  'Narsingham', 'Upendra', 'Ravinder', 'Rajitha', 'Susheela', 'Sathaiah', 'Mohit', 'Sammy', 'Shiva',
];
const MAX_Q = 120;

const isIdx = (n) => Number.isInteger(n) && n >= 0 && n < NAMES.length;

class GuessWho {
  constructor(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.reset();
  }

  reset() {
    for (const p of this.players) {
      p.secret = null;
      p.down = new Set();
    }
    this.phase = 'pick'; // pick -> ask <-> answer -> gameOver
    this.turn = 0; // index of the asker
    this.question = null;
    this.history = [];
    this.winner = null;
    this.guess = null;
    this.log = ['Pick your secret character from the board.'];
  }

  say(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  byId(id) {
    return this.players.find((p) => p.id === id);
  }

  other(p) {
    return this.players.find((q) => q !== p);
  }

  finish(winner, how) {
    this.phase = 'gameOver';
    this.winner = winner.id;
    this.say(how);
  }

  // The player the server should auto-play for if they've gone away.
  actor() {
    if (this.phase === 'pick') {
      const p = this.players.find((q) => q.secret === null);
      return p ? p.id : null;
    }
    if (this.phase === 'ask') return this.players[this.turn].id;
    if (this.phase === 'answer') return this.players[1 - this.turn].id;
    return null;
  }

  handle(pid, a) {
    if (!a || typeof a !== 'object') return 'Bad action';
    const me = this.byId(pid);
    if (!me) return 'Not in this game';

    if (a.type === 'rematch') {
      if (this.phase !== 'gameOver') return 'Game is not over';
      this.reset();
      return null;
    }
    if (this.phase === 'gameOver') return 'Game is over';

    if (a.type === 'pick') {
      if (this.phase !== 'pick') return 'Characters are already chosen';
      if (me.secret !== null) return 'You already locked in your pick';
      if (!isIdx(a.n)) return 'Pick a name from the board';
      me.secret = a.n;
      if (this.players.every((p) => p.secret !== null)) {
        this.phase = 'ask';
        this.turn = Math.floor(Math.random() * 2);
        this.say(`Both characters chosen. ${this.players[this.turn].name} asks first!`);
      } else {
        this.say(`${me.name} has picked a character.`);
      }
      return null;
    }

    if (a.type === 'toggle') {
      // Private bookkeeping: flip a name down/up on your own board.
      if (this.phase !== 'ask' && this.phase !== 'answer') return 'Not now';
      if (!isIdx(a.n)) return 'Bad name';
      if (me.down.has(a.n)) me.down.delete(a.n);
      else me.down.add(a.n);
      return null;
    }

    if (a.type === 'ask') {
      if (this.phase !== 'ask' || this.players[this.turn] !== me) return 'Not your turn to ask';
      const q = String(a.q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
      if (!q) return 'Type a yes/no question first';
      this.question = q;
      this.phase = 'answer';
      this.say(`${me.name} asks: ${q}`);
      return null;
    }

    if (a.type === 'answer') {
      if (this.phase !== 'answer' || this.players[1 - this.turn] !== me) return 'Not your turn to answer';
      if (!['yes', 'no', 'skip'].includes(a.a)) return 'Answer yes or no';
      const asker = this.players[this.turn];
      this.history.push({ by: asker.id, q: this.question, a: a.a });
      this.say(a.a === 'skip' ? `${me.name} is away — no answer.` : `${me.name} answers: ${a.a.toUpperCase()}`);
      this.question = null;
      this.phase = 'ask';
      this.turn = 1 - this.turn;
      return null;
    }

    if (a.type === 'guess') {
      if (this.phase !== 'ask' || this.players[this.turn] !== me) return 'You can only guess on your turn';
      if (!isIdx(a.n)) return 'Pick a name to guess';
      const opp = this.other(me);
      this.guess = { by: me.id, n: a.n };
      if (a.n === opp.secret) {
        this.finish(me, `${me.name} guessed ${NAMES[a.n]} — correct! ${me.name} wins!`);
      } else {
        this.finish(opp, `${me.name} guessed ${NAMES[a.n]} — wrong! ${opp.name} wins!`);
      }
      return null;
    }

    if (a.type === 'pass') {
      if (this.phase !== 'ask' || this.players[this.turn] !== me) return 'Not your turn';
      this.say(`${me.name} passes.`);
      this.turn = 1 - this.turn;
      return null;
    }
    return 'Bad action';
  }

  autoAct(pid) {
    if (this.actor() !== pid) return;
    if (this.phase === 'pick') {
      this.handle(pid, { type: 'pick', n: Math.floor(Math.random() * NAMES.length) });
    } else if (this.phase === 'ask') {
      this.handle(pid, { type: 'pass' });
    } else if (this.phase === 'answer') {
      this.handle(pid, { type: 'answer', a: 'skip' });
    }
  }

  view(pid) {
    const me = this.byId(pid);
    const opp = me && this.other(me);
    const over = this.phase === 'gameOver';
    return {
      type: 'guesswho',
      phase: this.phase,
      names: NAMES,
      turn: this.phase === 'ask' || this.phase === 'answer' ? this.players[this.turn].id : null,
      question: this.phase === 'answer' ? this.question : null,
      secret: me ? me.secret : null,
      down: me ? [...me.down] : [],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        picked: p.secret !== null,
        // Secrets stay hidden until the game is over (your own is sent via `secret`).
        secret: over ? p.secret : null,
      })),
      opponent: opp ? opp.id : null,
      history: this.history,
      guess: this.guess,
      winner: this.winner,
      log: this.log.slice(-25),
    };
  }
}

module.exports = {
  id: 'guesswho',
  name: 'Guess Who?',
  desc: 'Two players. Secretly pick a name, ask yes/no questions, flip down who it can\'t be, and guess your opponent\'s character first!',
  min: 2,
  max: 2,
  Game: GuessWho,
  _internals: { NAMES, MAX_Q },
};
