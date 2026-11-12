'use strict';
(function () {
  // Local-only UI state (never sent to the server until the player commits).
  let pickSel = null; // name picked but not yet locked in
  let guessMode = false; // choosing a final guess
  let guessTarget = null;
  let draft = ''; // question being typed; survives re-renders caused by the opponent's actions
  let last = null;
  let rulesOpen = false;

  const hue = (n) => (n * 47) % 360;
  const initial = (s) => esc(String(s).trim().charAt(0).toUpperCase());

  function tile(g, n, opts) {
    const name = g.names[n];
    const cls = ['gwt'];
    if (opts.down.has(n)) cls.push('down');
    if (opts.mine === n) cls.push('mine');
    if (opts.sel === n) cls.push('sel');
    if (opts.theirs === n) cls.push('theirs');
    return `<button class="${cls.join(' ')}" data-gw="tile" data-n="${n}" ${opts.disabled ? 'disabled' : ''}>
      <i style="background:hsl(${hue(n)} 60% 48%)">${initial(name)}</i>
      <span>${esc(name)}</span>
      ${opts.mine === n ? '<em>you</em>' : ''}
    </button>`;
  }

  function controls(g, ctx, me, opp) {
    const nm = g.names;
    if (g.phase === 'pick') {
      if (g.secret !== null) {
        return `<div class="ctl"><p>You picked <b>${esc(nm[g.secret])}</b>. ${
          opp.picked ? 'Starting…' : `Waiting for ${esc(opp.name)} to pick…`
        }</p></div>`;
      }
      return `<div class="ctl"><p><b>Pick your secret character.</b> ${esc(opp.name)} will try to guess it.</p>
        <button class="btn primary big" data-gw="lock" ${pickSel === null ? 'disabled' : ''}>${
          pickSel === null ? 'Tap a name below' : `Lock in ${esc(nm[pickSel])}`
        }</button></div>`;
    }
    if (g.phase === 'gameOver') return '';
    const mine = g.turn === ctx.you;
    if (g.phase === 'answer') {
      if (!mine) {
        return `<div class="ctl answer"><p><b>${esc(opp.name)}</b> asks: <span class="q">“${esc(g.question)}”</span></p>
          <p class="muted">Your character is <b>${esc(nm[g.secret])}</b>. Answer honestly!</p>
          <div class="row">
            <button class="btn big yes" data-gw="yes">Yes</button>
            <button class="btn big no" data-gw="no">No</button>
          </div></div>`;
      }
      return `<div class="ctl"><p>You asked: <span class="q">“${esc(g.question)}”</span></p>
        <p class="muted">Waiting for ${esc(opp.name)} to answer…</p></div>`;
    }
    // phase === 'ask'
    if (!mine) {
      return `<div class="ctl"><p class="muted">${esc(opp.name)} is thinking of a question… (you can flip names down meanwhile)</p></div>`;
    }
    if (guessMode) {
      return `<div class="ctl guess"><p><b>Final guess!</b> Tap who you think ${esc(opp.name)} picked. Wrong guess = you lose.</p>
        ${
          guessTarget === null
            ? ''
            : `<button class="btn primary big" data-gw="confirmguess">Guess ${esc(nm[guessTarget])}</button>`
        }
        <button class="btn" data-gw="cancelguess">Back to questions</button></div>`;
    }
    return `<div class="ctl mine"><p><b>Your turn.</b> Ask ${esc(opp.name)} a yes/no question, or make your final guess.</p>
      <div class="row">
        <input id="gw-q" maxlength="120" autocomplete="off" placeholder="e.g. Is your character a woman?" value="${esc(draft)}">
        <button class="btn primary" data-gw="ask">Ask</button>
      </div>
      <button class="btn guessbtn" data-gw="guessmode">🎯 Make final guess</button></div>`;
  }

  function history(g, ctx, me, opp) {
    if (!g.history.length) return '<div class="log"><div class="muted">No questions yet.</div></div>';
    return `<div class="log">${[...g.history]
      .reverse()
      .map((h) => {
        const by = h.by === ctx.you ? 'You' : opp.name;
        const ans = h.a === 'skip' ? '<b class="skip">no answer</b>' : `<b class="${h.a}">${h.a.toUpperCase()}</b>`;
        return `<div><span>${esc(by)}:</span> ${esc(h.q)} → ${ans}</div>`;
      })
      .join('')}</div>`;
  }

  function overlay(g, ctx, me, opp) {
    if (g.phase !== 'gameOver') return '';
    const won = g.winner === ctx.you;
    const winner = g.players.find((p) => p.id === g.winner);
    const gp = g.guess && g.players.find((p) => p.id === g.guess.by);
    const how = gp
      ? `${gp.id === ctx.you ? 'You' : esc(gp.name)} guessed <b>${esc(g.names[g.guess.n])}</b> — ${
          g.guess.n === (g.players.find((p) => p.id !== gp.id) || {}).secret ? 'correct!' : 'wrong!'
        }`
      : '';
    const reveal = g.players
      .map((p) => `<div class="rv"><span class="muted">${esc(p.name)}${p.id === ctx.you ? ' (you)' : ''}</span>
          <b>${p.secret === null ? '?' : esc(g.names[p.secret])}</b></div>`)
      .join('');
    return `<div class="overlay"><div class="card">
      <h2>${won ? '🏆 You win!' : `😬 ${esc(winner.name)} wins!`}</h2>
      <p>${how}</p>
      <div class="reveal">${reveal}</div>
      <button class="btn primary" data-gw="rematch">Play again</button>
      ${ctx.isHost ? '<button class="btn" data-gw="lobby" style="width:100%;margin-top:8px">Back to lobby</button>' : ''}
    </div></div>`;
  }

  function render(el, g, ctx) {
    last = { el, g, ctx };
    const me = g.players.find((p) => p.id === ctx.you);
    const opp = g.players.find((p) => p.id === g.opponent);
    if (g.phase !== 'pick') pickSel = null;
    if (!(g.phase === 'ask' && g.turn === ctx.you)) {
      guessMode = false;
      guessTarget = null;
    }

    const hadFocus = typeof document !== 'undefined' && document.activeElement && document.activeElement.id === 'gw-q';
    const down = new Set(g.down);
    const picking = g.phase === 'pick';
    const over = g.phase === 'gameOver';
    const tiles = g.names
      .map((_, n) =>
        tile(g, n, {
          down: picking || over ? new Set() : down,
          mine: g.secret,
          sel: picking ? pickSel : guessMode ? guessTarget : null,
          theirs: over && opp ? opp.secret : null,
          disabled: (picking && g.secret !== null) || over,
        })
      )
      .join('');
    const remaining = g.names.length - down.size;
    const status = picking
      ? ''
      : `<span>Your character: <b>${g.secret === null ? '?' : esc(g.names[g.secret])}</b></span>
         <span>Still in: <b>${remaining}</b></span>`;

    el.innerHTML = `
      <div class="gw">
        <div class="gwbar"><span>vs <b>${esc(opp.name)}</b></span>${status}</div>
        ${controls(g, ctx, me, opp)}
        <div class="gwhint muted">${
          picking
            ? 'Tap a name to choose your secret character.'
            : guessMode
              ? 'Tap a name to select your guess.'
              : 'Tap a name to flip it down (only you see this).'
        }</div>
        <div class="gwboard">${tiles}</div>
        <h4 class="gwh">Questions</h4>
        ${history(g, ctx, me, opp)}
        <details class="rules"${rulesOpen ? ' open' : ''}><summary>How to play</summary>
          <p>Each player secretly picks a name. Take turns asking each other <b>yes/no questions</b> about the other's character — answer honestly!</p>
          <p>Use the answers to flip down names it can't be. On your turn you can instead make a <b>final guess</b>: right wins, wrong loses.</p>
        </details>
        ${overlay(g, ctx, me, opp)}
      </div>`;

    if (hadFocus) {
      const i = el.querySelector('#gw-q');
      if (i) {
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    }

    el.oninput = (e) => {
      if (e.target && e.target.id === 'gw-q') draft = e.target.value;
    };
    el.onkeydown = (e) => {
      if (e.key === 'Enter' && e.target && e.target.id === 'gw-q') {
        e.preventDefault();
        submitAsk();
      }
    };
    el.onclick = (e) => {
      if (e.target.closest('summary')) rulesOpen = !rulesOpen;
      const b = e.target.closest('[data-gw]');
      if (!b || b.disabled) return;
      const k = b.dataset.gw;
      const cur = last.g;
      const rerender = () => render(last.el, last.g, last.ctx);
      if (k === 'tile') {
        const n = Number(b.dataset.n);
        if (cur.phase === 'pick' && cur.secret === null) {
          pickSel = n;
          rerender();
        } else if (guessMode) {
          guessTarget = n;
          rerender();
        } else if (cur.phase === 'ask' || cur.phase === 'answer') {
          ctx.send({ type: 'toggle', n });
        }
      } else if (k === 'lock') {
        if (pickSel === null) return;
        lockButtons(el);
        ctx.send({ type: 'pick', n: pickSel });
      } else if (k === 'ask') submitAsk();
      else if (k === 'yes' || k === 'no') {
        lockButtons(el);
        ctx.send({ type: 'answer', a: k });
      } else if (k === 'guessmode') {
        guessMode = true;
        guessTarget = null;
        rerender();
      } else if (k === 'cancelguess') {
        guessMode = false;
        guessTarget = null;
        rerender();
      } else if (k === 'confirmguess') {
        if (guessTarget === null) return;
        lockButtons(el);
        ctx.send({ type: 'guess', n: guessTarget });
      } else if (k === 'rematch') {
        lockButtons(el);
        ctx.send({ type: 'rematch' });
      } else if (k === 'lobby') ctx.backToLobby();
    };

    function submitAsk() {
      const inp = el.querySelector && el.querySelector('#gw-q');
      const q = (inp ? inp.value : draft).trim();
      if (!q) return;
      draft = '';
      lockButtons(el);
      ctx.send({ type: 'ask', q });
    }
  }

  // Block double-taps: the next state from the server re-renders and re-enables the buttons.
  function lockButtons(el) {
    if (!el.querySelectorAll) return;
    for (const btn of el.querySelectorAll('[data-gw]')) btn.disabled = true;
  }

  window.Games.guesswho = { render };
})();
