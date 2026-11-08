'use strict';
(function () {
  const ACTION_LABEL = { freeze: '❄ Freeze', flip3: '🎴 Flip 3' };
  const STATUS_LABEL = { active: '', stayed: 'Stayed', busted: 'BUST', frozen: 'Frozen' };

  // Remember how many cards each player had last render so only new cards animate.
  let seen = {};
  let seenRound = 0;
  let rulesOpen = false;
  const numCard = (v, fresh) => `<div class="fc n n${v}${fresh ? ' new' : ''}">${v}</div>`;
  const modCard = (m, fresh) => `<div class="fc m${fresh ? ' new' : ''}">${m}</div>`;

  function playerPanel(g, p, ctx) {
    const turn = g.turn === p.id && !g.pending;
    const cls = ['pp', p.status, turn ? 'turn' : '', p.id === ctx.you ? 'me' : ''].join(' ');
    const prev = seen[p.id] || { n: 0, m: 0, s: false };
    const cards =
      p.numbers.map((v, i) => numCard(v, i >= prev.n)).join('') +
      p.mods.map((m, i) => modCard(m, i >= prev.m)).join('') +
      (p.second ? `<div class="fc a${prev.s ? '' : ' new'}">♥ 2nd Chance</div>` : '');
    return `<div class="${cls}">
      <div class="pph">
        <b>${esc(p.name)}${p.id === ctx.you ? ' (you)' : ''}</b>
        <span class="tot">${p.total}</span>
      </div>
      <div class="ppm">
        ${turn ? '<span class="pill hot">flipping…</span>' : ''}
        ${p.status !== 'active' ? `<span class="pill st-${p.status}">${STATUS_LABEL[p.status]}</span>` : ''}
        ${p.flip7 ? '<span class="pill hot">FLIP 7!</span>' : ''}
        <span class="muted">${p.status === 'busted' ? '+0' : `round: +${p.score}`} · ${p.numbers.length}/7</span>
      </div>
      <div class="hand">${cards || '<span class="muted">no cards</span>'}</div>
    </div>`;
  }

  function controls(g, ctx) {
    if (g.phase !== 'playing') return '';
    const byId = Object.fromEntries(g.players.map((p) => [p.id, p]));
    if (g.pending) {
      const who = byId[g.pending.from];
      const label = g.pending.card === 'freeze' ? 'Freeze' : 'Flip Three';
      if (g.pending.from === ctx.you) {
        return `<div class="ctl"><p><b>You drew ${label}!</b> Pick a target:</p>
          <div class="targets">${g.pending.targets
            .map((id) => `<button class="btn" data-f7="target" data-id="${id}">${esc(byId[id].name)}${id === ctx.you ? ' (you)' : ''}</button>`)
            .join('')}</div></div>`;
      }
      return `<div class="ctl"><p>${esc(who.name)} is choosing a target for <b>${label}</b>…</p></div>`;
    }
    const me = byId[ctx.you];
    if (g.turn === ctx.you) {
      const empty = !me.numbers.length && !me.mods.length;
      return `<div class="ctl"><p><b>Your turn.</b> Flip again, or bank ${me.score} points?</p>
        <div class="row">
          <button class="btn primary big" data-f7="hit">Flip a card</button>
          <button class="btn big" data-f7="stay" ${empty ? 'disabled' : ''}>Stay (+${me.score})</button>
        </div></div>`;
    }
    return `<div class="ctl"><p class="muted">Waiting for ${esc(byId[g.turn].name)}…</p></div>`;
  }

  function overlay(g, ctx) {
    if (g.phase === 'playing') return '';
    const rows = [...g.lastRound]
      .sort((a, b) => b.total - a.total)
      .map(
        (r) => `<tr class="${r.id === g.winner ? 'win' : ''}">
          <td>${esc(r.name)}${r.flip7 ? ' 🎉' : ''}</td>
          <td>${r.status === 'busted' ? '<span class="pill st-busted">BUST</span>' : r.flip7 ? 'Flip 7!' : STATUS_LABEL[r.status] || 'Played'}</td>
          <td>+${r.points}</td><td><b>${r.total}</b></td></tr>`
      )
      .join('');
    let foot;
    if (g.phase === 'gameOver') {
      const w = g.players.find((p) => p.id === g.winner);
      foot = `<h2>🏆 ${esc(w.name)} wins!</h2>` +
        (ctx.isHost ? '<button class="btn primary" data-f7="lobby">Back to lobby</button>' : '<p class="muted">Waiting for host…</p>');
    } else {
      foot = '<button class="btn primary" data-f7="next">Next round</button>';
    }
    return `<div class="overlay"><div class="card">
      <h3>Round ${g.round} results</h3>
      <table><tr><th>Player</th><th></th><th>Round</th><th>Total</th></tr>${rows}</table>
      <p class="muted">First to ${g.target} wins.</p>${foot}</div></div>`;
  }

  window.Games.flip7 = {
    render(el, g, ctx) {
      if (g.round !== seenRound) { seen = {}; seenRound = g.round; }
      const html = `
        <div class="f7">
          <div class="f7bar">
            <span>Round <b>${g.round}</b></span>
            <span>Race to <b>${g.target}</b></span>
            <span>Deck <b>${g.deckCount}</b></span>
          </div>
          <div class="f7main">
            <div class="f7players">${g.players.map((p) => playerPanel(g, p, ctx)).join('')}</div>
            <aside>
              ${controls(g, ctx)}
              <div class="log">${[...g.log].reverse().map((l) => `<div>${esc(l)}</div>`).join('')}</div>
              <details class="rules"${rulesOpen ? ' open' : ''}><summary>How to play</summary>
                <p>On your turn, <b>flip</b> a card or <b>stay</b> to bank your points.</p>
                <p>Flip a number you already hold and you <b>bust</b> (0 points this round).</p>
                <p><b>7 unique numbers</b> ends the round with +${g.bonus}.</p>
                <p>+N modifiers add points, <b>x2</b> doubles your number total. <b>Freeze</b> forces someone to stay, <b>Flip 3</b> makes someone flip three cards, <b>Second Chance</b> cancels one duplicate.</p>
              </details>
            </aside>
          </div>
          ${overlay(g, ctx)}
        </div>`;
      el.innerHTML = html;
      seen = Object.fromEntries(g.players.map((p) => [p.id, { n: p.numbers.length, m: p.mods.length, s: p.second }]));
      el.onclick = (e) => {
        if (e.target.closest('summary')) rulesOpen = !rulesOpen;
        const b = e.target.closest('[data-f7]');
        if (!b || b.disabled) return;
        const k = b.dataset.f7;
        if (k === 'hit' || k === 'stay' || k === 'next') {
          // Block double-clicks: the next state from the server re-renders and re-enables the buttons.
          for (const btn of el.querySelectorAll('[data-f7]')) btn.disabled = true;
          ctx.send({ type: k });
        }
        else if (k === 'target') ctx.send({ type: 'target', target: b.dataset.id });
        else if (k === 'lobby') ctx.backToLobby();
      };
    },
  };
})();
