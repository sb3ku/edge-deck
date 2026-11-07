(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EdgeLayout = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const SIZE_SPANS = Object.freeze({
    small: Object.freeze({columns:2, rows:1}),
    medium: Object.freeze({columns:3, rows:1}),
    wide: Object.freeze({columns:6, rows:1}),
    tall: Object.freeze({columns:3, rows:2}),
    large: Object.freeze({columns:6, rows:2}),
  });

  function packCards(cards, {columns = 12} = {}) {
    if (!Array.isArray(cards) || cards.length > 17) throw new Error('Use up to 16 cards and one app dock.');
    if (!Number.isInteger(columns) || columns < 1 || columns > 24) throw new Error('Choose between 1 and 24 grid columns.');
    const occupied = new Set();
    const ids = new Set();
    const placements = [];
    let cursor = 0;
    let rows = 0;

    for (const card of cards) {
      if (!card || typeof card.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(card.id) || ids.has(card.id)) {
        throw new Error('Card IDs must be valid and unique.');
      }
      ids.add(card.id);
      if (card.enabled === false || card.type === 'launchers') continue;
      const size = card.size ?? 'medium';
      if (!Object.hasOwn(SIZE_SPANS,size)) throw new Error('Choose a supported card size.');
      const span = SIZE_SPANS[size];
      const columnSpan = Math.min(span.columns, columns);
      const rowSpan = span.rows;
      let start = cursor;
      let row, column;
      while (true) {
        row = Math.floor(start / columns);
        column = start % columns;
        if (column + columnSpan > columns) {
          start = (row + 1) * columns;
          continue;
        }
        let free = true;
        for (let y = row; y < row + rowSpan && free; y++) {
          for (let x = column; x < column + columnSpan; x++) {
            if (occupied.has(y * columns + x)) { free = false; break; }
          }
        }
        if (free) break;
        start++;
      }
      for (let y = row; y < row + rowSpan; y++) {
        for (let x = column; x < column + columnSpan; x++) occupied.add(y * columns + x);
      }
      placements.push({id:card.id,column:column+1,row:row+1,columnSpan,rowSpan});
      rows = Math.max(rows, row + rowSpan);
      // Never search earlier cells: card/tab order stays the same visually and
      // in keyboard navigation even when earlier rows have unused spaces.
      cursor = start + columnSpan;
    }
    return {columns,rows,cards:placements};
  }

  return Object.freeze({packCards,SIZE_SPANS});
});
