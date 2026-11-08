'use strict';
// Game registry. To add a game: create games/<id>.js exporting
// { id, name, desc, min, max, Game } and add it here, then add a client
// renderer in public/games/<id>.js that registers window.Games[<id>].
const list = [require('./flip7')];

const registry = Object.fromEntries(list.map((g) => [g.id, g]));
const catalog = list.map(({ id, name, desc, min, max }) => ({ id, name, desc, min, max }));

module.exports = { registry, catalog };
