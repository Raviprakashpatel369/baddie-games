'use strict';
// Platform shell: connection, home, lobby. Game UIs register in window.Games.
const $app = document.getElementById('app');
const $tag = document.getElementById('roomtag');
const $toast = document.getElementById('toast');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.esc = esc;

let ws;
let state = null;
let session = load();
let toastTimer;

function load() {
  try {
    return JSON.parse(localStorage.getItem('bg-session')) || {};
  } catch {
    return {};
  }
}
function save() {
  try {
    localStorage.setItem('bg-session', JSON.stringify(session));
  } catch {}
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2800);
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    if (session.code && session.secret) send({ t: 'join', code: session.code, secret: session.secret });
    else render();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      session = { code: m.code, secret: m.secret, id: m.id, name: m.name };
      save();
    } else if (m.t === 'state') {
      state = m;
      render();
    } else if (m.t === 'error') {
      toast(m.msg);
      if (m.fatal) {
        session = { name: session.name };
        save();
        state = null;
        render();
      }
    }
  };
  ws.onclose = () => {
    toast('Disconnected — reconnecting…');
    setTimeout(connect, 1500);
  };
}

function render() {
  $tag.innerHTML = state ? `Room <b>${esc(state.room.code)}</b> <button class="link" data-act="leave">Leave</button>` : '';
  if (!state) return renderHome();
  if (state.room.phase === 'lobby') return renderLobby();
  const ui = window.Games[state.game.type];
  const you = state.you;
  ui.render($app, state.game, {
    you,
    isHost: state.room.hostId === you,
    send: (action) => send({ t: 'act', action }),
    backToLobby: () => send({ t: 'lobby' }),
  });
}

function renderHome() {
  const name = esc(session.name || '');
  $app.innerHTML = `
    <section class="card home">
      <label>Your name
        <input id="name" maxlength="16" placeholder="e.g. Baddie" value="${name}">
      </label>
      <button class="btn primary" data-act="create">Create room</button>
      <div class="or">or join with a code</div>
      <div class="row">
        <input id="code" maxlength="4" placeholder="ABCD" autocapitalize="characters">
        <button class="btn" data-act="join">Join</button>
      </div>
    </section>`;
  const q = new URLSearchParams(location.search).get('room');
  if (q) document.getElementById('code').value = q.toUpperCase().slice(0, 4);
}

function renderLobby() {
  const { room, games, you } = state;
  const host = room.hostId === you;
  const def = games.find((g) => g.id === room.gameKey);
  const link = `${location.origin}/?room=${room.code}`;
  $app.innerHTML = `
    <section class="card">
      <div class="roomcode">
        <span>Room code</span><b>${esc(room.code)}</b>
        <button class="btn small" data-act="copy" data-link="${esc(link)}">Copy invite link</button>
      </div>
      <h3>Players (${room.players.length})</h3>
      <ul class="players">
        ${room.players
          .map(
            (p) => `<li class="${p.connected ? '' : 'off'}">${esc(p.name)}
              ${p.id === room.hostId ? '<span class="pill">host</span>' : ''}
              ${p.id === you ? '<span class="pill you">you</span>' : ''}
              ${p.connected ? '' : '<span class="pill">away</span>'}</li>`
          )
          .join('')}
      </ul>
    </section>
    <section class="card">
      <h3>Game</h3>
      <div class="games">
        ${games
          .map(
            (g) => `<button class="gamebtn ${g.id === room.gameKey ? 'sel' : ''}" data-act="select" data-game="${g.id}" ${host ? '' : 'disabled'}>
              <b>${esc(g.name)}</b><small>${g.min}–${g.max} players</small><span>${esc(g.desc)}</span></button>`
          )
          .join('')}
      </div>
      ${
        host
          ? `<button class="btn primary" data-act="start">Start ${esc(def.name)}</button>`
          : `<p class="muted">Waiting for the host to start…</p>`
      }
    </section>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'create') {
    const name = document.getElementById('name').value.trim();
    session.name = name;
    save();
    send({ t: 'create', name });
  } else if (act === 'join') {
    const name = document.getElementById('name').value.trim();
    session.name = name;
    save();
    send({ t: 'join', code: document.getElementById('code').value, name });
  } else if (act === 'select') send({ t: 'select', game: el.dataset.game });
  else if (act === 'start') send({ t: 'start' });
  else if (act === 'leave') {
    send({ t: 'leave' });
    session = { name: session.name };
    save();
    state = null;
    render();
  } else if (act === 'copy') {
    navigator.clipboard?.writeText(el.dataset.link).then(() => toast('Invite link copied!'), () => toast(el.dataset.link));
  }
});

connect();
