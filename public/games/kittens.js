'use strict';
// Client UI for "Bomb Pussies" (Exploding Kittens-style).
(function () {
  const CARD = {
    ek: { n: 'Exploding Kitten', e: '💣' },
    defuse: { n: 'Defuse', e: '🧯' },
    nope: { n: 'Nope', e: '🚫' },
    attack: { n: 'Attack', e: '⚔️' },
    skip: { n: 'Skip', e: '⏭️' },
    favor: { n: 'Favor', e: '🤝' },
    shuffle: { n: 'Shuffle', e: '🔀' },
    future: { n: 'See the Future', e: '🔮' },
    cat1: { n: 'Tacocat', e: '🌮' },
    cat2: { n: 'Hairy Potato Cat', e: '🥔' },
    cat3: { n: 'Beard Cat', e: '🧔' },
    cat4: { n: 'Rainbow-Ralphing Cat', e: '🌈' },
    cat5: { n: 'Cattermelon', e: '🍉' },
  };
  const ORDER = Object.keys(CARD);
  const NAMEABLE = ORDER.filter((t) => t !== 'ek');
  const isCat = (t) => t.startsWith('cat');
  const cls = (t) => (isCat(t) ? 'cat' : t);

  let ui = { sel: [], step: null, insertPos: 0, key: '' };
  let seen = null;
  let last = null;
  let rulesOpen = false;

  const tile = (c, o = {}) => `<button class="kc t-${cls(c.t)}${o.sel ? ' sel' : ''}${o.fresh ? ' new' : ''}${o.mini ? ' mini' : ''}"
    ${o.k ? `data-k="${o.k}" data-id="${c.id}"` : 'disabled'}><span class="e">${CARD[c.t].e}</span><span class="n">${CARD[c.t].n}</span></button>`;
  const mini = (t) => tile({ t }, { mini: true });

  function analyze(cards) {
    const n = cards.length;
    const ts = cards.map((c) => c.t);
    if (!n) return { ok: false, hint: 'Tap cards in your hand to play them, or draw a card to end your turn.' };
    if (n === 1) {
      const t = ts[0];
      if (['attack', 'skip', 'shuffle', 'future'].includes(t)) return { ok: true, label: CARD[t].n, need: [] };
      if (t === 'favor') return { ok: true, label: 'Favor', need: ['target'] };
      if (t === 'nope') return { ok: false, hint: 'Nope is played when someone else plays a card.' };
      if (t === 'defuse') return { ok: false, hint: 'Defuse is used automatically when you draw a kitten.' };
      return { ok: false, hint: 'Select a second matching cat to play a pair.' };
    }
    if ((n === 2 || n === 3) && ts.every((t) => t === ts[0] && isCat(t))) {
      return n === 2
        ? { ok: true, label: 'Pair — steal a random card', need: ['target'] }
        : { ok: true, label: 'Three of a kind — name a card', need: ['target', 'name'] };
    }
    if (n === 5 && ts.every(isCat) && new Set(ts).size === 5) {
      return { ok: true, label: 'Five different cats — take from discard', need: ['pick'] };
    }
    return { ok: false, hint: 'Cats combo: 2 or 3 matching, or 5 different.' };
  }

  function describe(p) {
    const L = (t) => CARD[t].n;
    if (p.kind === 'pair') return `a pair of ${L(p.cards[0])}s`;
    if (p.kind === 'triple') return `three ${L(p.cards[0])}s (asking for ${L(p.name)})`;
    if (p.kind === 'five') return 'five different cats';
    return L(p.kind);
  }

  function actions(g, ctx, byId, me) {
    if (g.phase === 'gameOver') return '';
    const nm = (id) => esc(byId[id].name);
    if (!me.alive) return `<div class="kact dead"><p>💀 <b>You blew up.</b> Spectating — you can't play any more cards.</p></div>`;

    if (g.phase === 'reaction') {
      const p = g.pending;
      const myNopes = g.hand.filter((c) => c.t === 'nope').length;
      const noped = p.nopes % 2 === 1;
      return `<div class="kact react">
        <p><b>${nm(p.by)}</b> played <b>${esc(describe(p))}</b>${p.target ? ` on <b>${nm(p.target)}</b>` : ''}</p>
        <div class="played">${p.cards.map(mini).join('')}</div>
        <p class="${noped ? 'bad' : 'muted'}">${noped ? '🚫 NOPED — cancelled unless someone Nopes the Nope!' : 'Resolving soon — anyone can Nope it…'}${p.nopes ? ` (×${p.nopes})` : ''}</p>
        <div class="timer"><i style="animation-duration:${p.ms}ms"></i></div>
        ${myNopes ? `<button class="btn nope big" data-k="nope">🚫 NOPE! <small>(${myNopes} in hand)</small></button>` : '<p class="muted">You have no Nope card.</p>'}
      </div>`;
    }

    if (g.phase === 'favor') {
      if (g.favor.from === ctx.you) {
        return `<div class="kact mine"><p><b>${nm(g.favor.to)}</b> called in a favor. Pick a card from your hand to give:</p>
          <button class="btn primary big" data-k="give" ${ui.sel.length === 1 ? '' : 'disabled'}>Give selected card</button></div>`;
      }
      return `<div class="kact"><p class="muted">Waiting for <b>${nm(g.favor.from)}</b> to hand over a card for ${nm(g.favor.to)}…</p></div>`;
    }

    if (g.phase === 'insert') {
      if (g.insert.by === ctx.you) {
        const max = g.insert.deckCount;
        const pos = Math.min(ui.insertPos, max);
        return `<div class="kact mine"><p>🧯 <b>Defused!</b> Secretly put the kitten back. Where?</p>
          <input type="range" id="ipos" min="0" max="${max}" value="${pos}">
          <p class="muted" id="iposlbl">${posLabel(pos, max)}</p>
          <div class="row quick">
            <button class="btn small" data-k="ipos" data-v="0">Top</button>
            <button class="btn small" data-k="ipos" data-v="${Math.floor(max / 2)}">Middle</button>
            <button class="btn small" data-k="ipos" data-v="${max}">Bottom</button>
          </div>
          <button class="btn primary big" data-k="insert">Hide it</button></div>`;
      }
      return `<div class="kact"><p class="muted"><b>${nm(g.insert.by)}</b> defused a kitten and is hiding it…</p></div>`;
    }

    // phase === 'turn'
    if (g.turn !== ctx.you) {
      return `<div class="kact"><p class="muted">Waiting for <b>${nm(g.turn)}</b>${g.turnsLeft > 1 ? ` (${g.turnsLeft} turns)` : ''}…</p>
        ${g.hand.some((c) => c.t === 'nope') ? '<p class="muted">Keep your Nope ready!</p>' : ''}</div>`;
    }
    const head = `<p><b>Your turn</b>${g.turnsLeft > 1 ? ` — you must take <b>${g.turnsLeft}</b> turns` : ''}</p>`;
    if (ui.step) return stepPanel(g, byId, ctx, head);
    const cards = ui.sel.map((id) => g.hand.find((c) => c.id === id)).filter(Boolean);
    const a = analyze(cards);
    return `<div class="kact mine">${head}
      <div class="row">
        <button class="btn primary big" data-k="draw">Draw a card<small>ends turn</small></button>
        <button class="btn big" data-k="play" ${a.ok ? '' : 'disabled'}>Play${a.ok ? `<small>${esc(a.label)}</small>` : ''}</button>
      </div>
      ${a.ok ? '' : `<p class="muted hint">${esc(a.hint)}</p>`}
    </div>`;
  }

  function stepPanel(g, byId, ctx, head) {
    const st = ui.step;
    const need = st.need.find((k) => !(k in st.got));
    let body = '';
    if (need === 'target') {
      const opts = g.players.filter((p) => p.alive && p.id !== ctx.you && p.count > 0);
      body = `<p>Choose a target:</p><div class="targets">${opts
        .map((p) => `<button class="btn" data-k="target" data-id="${p.id}">${esc(p.name)} <small>${p.count} cards</small></button>`)
        .join('') || '<p class="muted">Nobody has cards to target.</p>'}</div>`;
    } else if (need === 'name') {
      body = `<p>Name the card you want:</p><div class="names">${NAMEABLE.map(
        (t) => `<button class="btn small" data-k="name" data-t="${t}">${CARD[t].e} ${CARD[t].n}</button>`
      ).join('')}</div>`;
    } else if (need === 'pick') {
      body = `<p>Take any card from the discard pile:</p><div class="pickgrid">${
        g.discard.length ? g.discard.map((c) => tile(c, { k: 'pick', mini: true })).join('') : '<p class="muted">Discard pile is empty.</p>'
      }</div>`;
    }
    return `<div class="kact mine">${head}${body}<button class="btn small" data-k="cancel">Cancel</button></div>`;
  }

  const posLabel = (pos, max) =>
    pos === 0 ? 'Top — the very next card drawn' : pos >= max ? `Bottom — ${max} cards down` : `${pos} card${pos === 1 ? '' : 's'} down from the top`;

  function overlay(g, ctx, byId) {
    if (g.phase !== 'gameOver') return '';
    const w = byId[g.winner];
    return `<div class="overlay"><div class="card"><h2>🏆 ${esc(w.name)} wins!</h2>
      <p class="muted">Last one standing${g.winner === ctx.you ? ' — that\'s you!' : ''}.</p>
      ${ctx.isHost ? '<button class="btn primary" data-k="lobby">Back to lobby</button>' : '<p class="muted">Waiting for host…</p>'}</div></div>`;
  }

  function render(el, g, ctx) {
    last = { el, g, ctx };
    const byId = Object.fromEntries(g.players.map((p) => [p.id, p]));
    const me = byId[ctx.you];
    // reset local selection when the game moves on
    const key = [g.phase, g.turn, g.favor && g.favor.from, g.pending && g.pending.by].join('|');
    if (key !== ui.key) {
      if (g.phase === 'insert') ui.insertPos = Math.floor(g.deckCount / 2);
      ui = { sel: [], step: null, insertPos: ui.insertPos, key };
    }
    ui.sel = ui.sel.filter((id) => g.hand.some((c) => c.id === id));
    const canSel = me.alive && ((g.phase === 'turn' && g.turn === ctx.you && !ui.step) || (g.phase === 'favor' && g.favor.from === ctx.you));

    const hand = [...g.hand].sort((a, b) => ORDER.indexOf(a.t) - ORDER.indexOf(b.t) || a.id - b.id);
    const topDiscard = g.discard[g.discard.length - 1];

    el.innerHTML = `<div class="k">
      <div class="kbar">
        <span>Draw pile <b>${g.deckCount}</b></span>
        <span class="disc">Discard ${topDiscard ? mini(topDiscard.t) : '<b>—</b>'}</span>
      </div>
      ${actions(g, ctx, byId, me)}
      <div class="kplayers">${g.players
        .map(
          (p) => `<div class="kp${p.alive ? '' : ' dead'}${g.turn === p.id && g.phase !== 'reaction' ? ' turn' : ''}${p.id === ctx.you ? ' me' : ''}">
            <b>${p.alive ? '' : '💀 '}${esc(p.name)}${p.id === ctx.you ? ' (you)' : ''}</b>
            <span>${p.alive ? `🂠 ${p.count}` : 'out'}${g.turn === p.id && g.turnsLeft > 1 ? ` · ${g.turnsLeft} turns` : ''}</span></div>`
        )
        .join('')}</div>
      ${g.peek ? `<div class="kpeek"><b>🔮 Top of the pile</b> <small>(next card first)</small>
        <div class="played">${g.peek.map(mini).join('')}</div></div>` : ''}
      ${me.alive ? `<div class="khand">${hand
        .map((c) => tile(c, { k: canSel ? 'sel' : null, sel: ui.sel.includes(c.id), fresh: seen && !seen.has(c.id) }))
        .join('')}</div>` : ''}
      <div class="log">${[...g.log].reverse().map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      <details class="rules"${rulesOpen ? ' open' : ''}><summary>How to play</summary>
        <p>Each turn: play any cards you like, then <b>draw a card</b> to end your turn. Draw an <b>Exploding Kitten</b> and you're out — unless you have a <b>Defuse</b>, then hide the kitten back in the pile.</p>
        <p><b>Attack</b>: skip drawing, next player takes 2 turns. <b>Skip</b>: end a turn without drawing. <b>Favor</b>: someone gives you a card. <b>Shuffle</b>, <b>See the Future</b> (peek top 3).</p>
        <p><b>Nope</b> cancels any card (even another Nope) — everyone gets a few seconds to react.</p>
        <p>Cats: a <b>pair</b> steals a random card, <b>three</b> of a kind lets you name a card, <b>five different</b> cats take any card from the discard pile.</p>
      </details>
      ${overlay(g, ctx, byId)}
    </div>`;
    seen = new Set(g.hand.map((c) => c.id));

    el.onclick = (e) => {
      if (e.target.closest('summary')) rulesOpen = !rulesOpen;
      const b = e.target.closest('[data-k]');
      if (!b || b.disabled) return;
      const k = b.dataset.k;
      const again = () => render(last.el, last.g, last.ctx);
      const lock = () => el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      if (k === 'sel') {
        const id = Number(b.dataset.id);
        if (g.phase === 'favor') ui.sel = [id];
        else ui.sel = ui.sel.includes(id) ? ui.sel.filter((x) => x !== id) : [...ui.sel, id];
        again();
      } else if (k === 'draw') { lock(); ctx.send({ type: 'draw' }); }
      else if (k === 'play') {
        const a = analyze(ui.sel.map((id) => g.hand.find((c) => c.id === id)));
        if (!a.ok) return;
        if (!a.need.length) { lock(); ctx.send({ type: 'play', ids: ui.sel }); }
        else { ui.step = { ids: [...ui.sel], need: a.need, got: {} }; again(); }
      } else if (k === 'target' || k === 'name' || k === 'pick') {
        ui.step.got[k] = k === 'name' ? b.dataset.t : k === 'target' ? b.dataset.id : Number(b.dataset.id);
        if (ui.step.need.every((n) => n in ui.step.got)) {
          lock();
          ctx.send({ type: 'play', ids: ui.step.ids, ...ui.step.got });
        } else again();
      } else if (k === 'cancel') { ui.step = null; again(); }
      else if (k === 'nope') ctx.send({ type: 'nope' });
      else if (k === 'give') { lock(); ctx.send({ type: 'give', id: ui.sel[0] }); }
      else if (k === 'ipos') { ui.insertPos = Number(b.dataset.v); again(); }
      else if (k === 'insert') { lock(); ctx.send({ type: 'insert', pos: ui.insertPos }); }
      else if (k === 'lobby') ctx.backToLobby();
    };
    el.oninput = (e) => {
      if (e.target.id !== 'ipos') return;
      ui.insertPos = Number(e.target.value);
      const l = document.getElementById('iposlbl');
      if (l) l.textContent = posLabel(ui.insertPos, g.insert ? g.insert.deckCount : 0);
    };
  }

  window.Games.kittens = { render };
})();
