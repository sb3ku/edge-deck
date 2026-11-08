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

  // iOS-style widgets: Small 1×1, Medium 2×1, Large 2×2, and Tall 1×2 for
  // naturally vertical content such as the quick controls (wide 4×1 maps in).
  const WIDGET_SPANS = Object.freeze({
    small: Object.freeze({columns:1, rows:1}),
    medium: Object.freeze({columns:2, rows:1}),
    large: Object.freeze({columns:2, rows:2}),
    wide: Object.freeze({columns:4, rows:1}),
    tall: Object.freeze({columns:1, rows:2}),
  });
  // Starting sizes when you switch to Widgets, by what a card shows.
  const WIDGET_DEFAULTS = Object.freeze({ clock:'small', today:'small', weather:'medium', tasks:'medium', printers:'medium', media:'large', stats:'large', actions:'tall', app:'large', website:'large', empty:'small', gauge:'small', switch:'small', timer:'small', machine:'small' });

  function packCards(cards, {columns = 12, spans = SIZE_SPANS} = {}) {
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
      if (!Object.hasOwn(spans,size)) throw new Error('Choose a supported card size.');
      const span = spans[size];
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
      // (The widget grid fills gaps instead, like iOS: see packWidgets.)
      cursor = start + columnSpan;
    }
    return {columns,rows,cards:placements};
  }

  // Auto arrange: every kind of card has a natural width (weight) and the
  // narrowest width its content needs at full height. When all cards fit in one
  // row they share it by weight; when they do not, cards that work at half
  // height are stacked in pairs (two in one column), the pair that frees the
  // most room first, keeping the card order, until the row fits.
  const AUTO_PROFILES = Object.freeze({
    clock: {weight:.75, min:250, stack:true}, today: {weight:.95, min:320, stack:false}, weather: {weight:.95, min:320, stack:false},
    tasks: {weight:1.1, min:340, stack:true}, printers: {weight:1.25, min:400, stack:true}, media: {weight:1.15, min:380, stack:false},
    stats: {weight:1.25, min:420, stack:true}, actions: {weight:.9, min:330, stack:false}, app: {weight:1.6, min:480, stack:true},
    website: {weight:1.6, min:480, stack:true}, empty: {weight:.6, min:200, stack:true},
    gauge: {weight:.5, min:200, stack:true}, switch: {weight:.5, min:200, stack:true}, timer: {weight:.6, min:220, stack:true}, machine: {weight:1, min:340, stack:true},
  });
  function planAuto(cards, {width = 2500, gap = 14, comfort = 1.15} = {}) {
    const columns = cards.filter(card => card && card.type !== 'launchers' && card.enabled !== false).map(card => {
      const profile = AUTO_PROFILES[card.type] || AUTO_PROFILES.empty;
      return {ids:[card.id], weight:profile.weight, min:profile.min, stack:profile.stack};
    });
    // Cards are given room to breathe: comfortable width is a bit above the minimum.
    const needed = (list, factor = comfort) => list.reduce((sum, column) => sum + column.min * factor, 0) + gap * Math.max(0, list.length - 1);
    while (needed(columns) > width) {
      let best = -1, saving = 0;
      for (let i = 0; i < columns.length - 1; i++) {
        const a = columns[i], b = columns[i + 1];
        if (a.ids.length !== 1 || b.ids.length !== 1 || !a.stack || !b.stack) continue;
        const freed = Math.min(a.min, b.min) + gap;
        if (freed > saving) { saving = freed; best = i; }
      }
      if (best < 0) break;
      const [a, b] = columns.splice(best, 2);
      columns.splice(best, 0, {ids:[...a.ids, ...b.ids], weight:Math.max(a.weight, b.weight), min:Math.max(a.min, b.min), stack:false});
    }
    return {columns:columns.map(({ids, weight, min}) => ({ids, weight, min})), fits:needed(columns, 1) <= width};
  }

  // Widgets fill the grid like iOS: each goes in the first free place that
  // fits, top-left first, so a Small widget can fill a gap left earlier.
  // Widgets that do not fit in the rows available are reported as overflow.
  function packWidgets(cards, options = {}) {
    // Your order first; if something does not fit, the big widgets first.
    const ordered = packInOrder(cards, options);
    if (!ordered.overflow.length) return ordered;
    const area = card => { const span = WIDGET_SPANS[card?.size] || WIDGET_SPANS.medium; return span.columns * span.rows * 10 + span.rows; };
    const bigFirst = packInOrder([...cards].sort((a, b) => area(b) - area(a)), options);
    return bigFirst.overflow.length < ordered.overflow.length ? bigFirst : ordered;
  }
  function packInOrder(cards, {columns = 8, rows = 2} = {}) {
    const occupied = new Set(), placements = [], overflow = [];
    for (const card of cards) {
      if (!card || card.enabled === false || card.type === 'launchers') continue;
      const span = WIDGET_SPANS[card.size] || WIDGET_SPANS.medium;
      const w = Math.min(span.columns, columns), h = Math.min(span.rows, rows);
      let placed = null;
      for (let column = 0; column + w <= columns && !placed; column++) {
        for (let row = 0; row + h <= rows && !placed; row++) {
          let free = true;
          for (let y = row; y < row + h && free; y++) for (let x = column; x < column + w; x++) if (occupied.has(y * columns + x)) { free = false; break; }
          if (free) placed = {column, row};
        }
      }
      if (!placed) { overflow.push(card.id); continue; }
      for (let y = placed.row; y < placed.row + h; y++) for (let x = placed.column; x < placed.column + w; x++) occupied.add(y * columns + x);
      placements.push({id:card.id, column:placed.column + 1, row:placed.row + 1, columnSpan:w, rowSpan:h});
    }
    return {columns, rows, cards:placements, overflow, free:columns * rows - occupied.size};
  }

  return Object.freeze({packCards,packWidgets,planAuto,SIZE_SPANS,WIDGET_SPANS,WIDGET_DEFAULTS,AUTO_PROFILES});
});
