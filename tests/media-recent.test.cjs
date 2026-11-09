'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the music widget in a minimal browser-like context; only the pure helper is exercised.
function load() {
  const context = { document: { documentElement: { classList: { contains: () => false } } }, setInterval() { return 0; }, clearInterval() {}, ResizeObserver: class { observe() {} } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'media-widget.js'), 'utf8'), context);
  return context.EdgeMediaWidget.recentTiles;
}
const plain = value => JSON.parse(JSON.stringify(value));
const item = (name, uri = `spotify:playlist:${name}`) => ({ uri, name, type: 'playlist' });
const liked = { uri: 'spotify:user:sample:collection', type: 'collection', name: 'Liked Songs' };

test('Small has no tiles', () => {
  assert.deepEqual(plain(load()({ liked, recent: [item('a')] }, [], 'small')), []);
  assert.deepEqual(plain(load()({}, [], 'tall')), []);
});
test('Medium shows DJ, Liked Songs and the two latest items', () => {
  const tiles = plain(load()({ liked, recent: [item('a'), item('b'), item('c')] }, [], 'medium'));
  assert.deepEqual(tiles.map(tile => tile.kind), ['dj', 'liked', 'item', 'item']);
  assert.deepEqual(tiles.slice(2).map(tile => tile.item.name), ['a', 'b']);
});
test('Large shows DJ, Liked Songs and six items, without repeats', () => {
  const recent = [item('a'), item('a'), item('b'), item('c')];
  const saved = [item('d'), item('b'), item('e'), item('f'), item('g')];
  const tiles = plain(load()({ liked, recent, albums: [item('h')] }, saved, 'large'));
  assert.equal(tiles.length, 8);
  assert.deepEqual(tiles.slice(2).map(tile => tile.item.name), ['a', 'b', 'c', 'd', 'e', 'f']);
});
test('without Liked Songs or recents the tiles fill from saved playlists', () => {
  const tiles = plain(load()({ recent: null }, [item('x'), item('y'), item('z')], 'medium'));
  assert.deepEqual(tiles.map(tile => tile.kind), ['dj', 'item', 'item', 'item']);
});
test('the DJ playlist and Liked Songs never repeat as items', () => {
  const tiles = plain(load()({ liked, recent: [{ ...item('dj'), uri: 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq' }, { ...liked }, item('a')] }, [], 'large'));
  assert.deepEqual(tiles.map(tile => tile.kind), ['dj', 'liked', 'item']);
});
