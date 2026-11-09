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
  const WIDGET_DEFAULTS = Object.freeze({ clock:'small', today:'small', weather:'medium', tasks:'medium', printers:'medium', media:'large', stats:'large', actions:'tall', app:'large', website:'large', empty:'small', gauge:'small', switch:'small', timer:'small', machine:'small', 'rain-wind':'small', 'daily-forecast':'small', 'sun-path':'small', dial:'small', city:'small', 'world-clock':'medium' });

  // The widgets you can add, like iOS: each kind belongs to a source (the
  // "app" in the gallery) and offers only the sizes designed for it.
  const SIZE_ORDER = Object.freeze(['small', 'medium', 'large', 'tall']);
  const WIDGET_SOURCES = Object.freeze([
    {id:'clock', title:'Clock', symbol:'clock'}, {id:'weather', title:'Weather', symbol:'weather'},
    {id:'music', title:'Music', symbol:'music'}, {id:'printers', title:'3D printers', symbol:'printer'},
    {id:'pc', title:'PC', symbol:'stats'}, {id:'agents', title:'Agents', symbol:'tasks'},
    {id:'controls', title:'Controls', symbol:'actions'}, {id:'timer', title:'Timer', symbol:'timer'},
    {id:'apps', title:'Apps and websites', symbol:'app'},
  ].map(Object.freeze));
  const WIDGET_KINDS = Object.freeze([
    {type:'clock', source:null, title:'Date and time', detail:'The time and date; Large adds what is up next.', sizes:['small', 'medium', 'large']},
    {type:'dial', source:'clock', title:'Clock', detail:'Display the current time.', sizes:['small'], variants:[{title:'Clock digital', item:{face:'digital'}}, {title:'Clock I', item:{face:'numbers'}}, {title:'Clock II', item:{face:'bars'}}, {title:'Clock III', item:{face:'quarters'}}]},
    {type:'city', source:'clock', title:'City', detail:'Add a clock for a city to check the time there.', sizes:['small'], variants:[{title:'City digital', item:{face:'digital'}}, {title:'City I', item:{face:'numbers'}}, {title:'City II', item:{face:'bars'}}]},
    {type:'world-clock', source:'clock', title:'World clock', detail:'The time in several cities around the world.', sizes:['small', 'medium']},
    {type:'today', source:null, title:'Time & weather', detail:'The time with the weather outside.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'weather', source:'weather', title:'Forecast', detail:'The current weather and forecast for your location.', sizes:['small', 'medium', 'large']},
    {type:'rain-wind', source:'weather', title:'Details', detail:'The chance of rain, the wind and how it feels outside.', sizes:['small']},
    {type:'daily-forecast', source:'weather', title:'Daily forecast', detail:'The current weather and the coming days.', sizes:['small']},
    {type:'sun-path', source:'weather', title:'Sunrise and sunset', detail:'The next sunrise or sunset, and the sun’s path today.', sizes:['small', 'medium']},
    {type:'media', source:'music', title:'Recently played', detail:'Quickly play recently played playlists, artists and albums. Large and Tall are the full player with Canvas.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'printers', source:'printers', title:'All printers', detail:'Every printer: progress, finish time and the camera.', sizes:['medium', 'large', 'tall']},
    {type:'machine', source:'printers', title:'Printer', detail:'One printer at a glance; Large adds the job details.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'stats', source:'pc', title:'PC stats', detail:'CPU, GPU, memory and video memory; Large adds the busiest apps.', sizes:['medium', 'large', 'tall']},
    {type:'gauge', source:'pc', title:'Gauge', detail:'One reading as a ring, with its last minutes.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'tasks', source:'agents', title:'Agent chats', detail:'What Codex and Claude Code are working on.', sizes:['medium', 'large', 'tall']},
    {type:'actions', source:'controls', title:'Quick controls', detail:'Wi-Fi, Bluetooth, sound and more, like Quick Settings.', sizes:['medium', 'large', 'tall']},
    {type:'switch', source:'controls', title:'Switch', detail:'One control; bigger sizes list its networks or devices.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'timer', source:'timer', title:'Timer', detail:'A countdown with presets that rings when done.', sizes:['small', 'medium', 'large', 'tall']},
    {type:'app', source:'apps', title:'App shortcut', detail:'Open a saved app.', sizes:['small', 'medium', 'large']},
    {type:'website', source:'apps', title:'Website', detail:'A live preview of a saved HTTPS website.', sizes:['medium', 'large', 'tall']},
    {type:'empty', source:null, title:'Empty', detail:'', sizes:['small', 'medium', 'large', 'tall']},
  ].map(kind => Object.freeze({...kind, sizes:Object.freeze(kind.sizes), ...(kind.variants ? {variants:Object.freeze(kind.variants.map(Object.freeze))} : {})})));
  // Cities for the City and World clock widgets.
  const CITIES = Object.freeze([
    ['warsaw', 'Warsaw', 'WAW', 'Europe/Warsaw'], ['london', 'London', 'LON', 'Europe/London'], ['paris', 'Paris', 'PAR', 'Europe/Paris'], ['berlin', 'Berlin', 'BER', 'Europe/Berlin'],
    ['madrid', 'Madrid', 'MAD', 'Europe/Madrid'], ['rome', 'Rome', 'ROM', 'Europe/Rome'], ['athens', 'Athens', 'ATH', 'Europe/Athens'], ['istanbul', 'Istanbul', 'IST', 'Europe/Istanbul'],
    ['kyiv', 'Kyiv', 'KYI', 'Europe/Kyiv'], ['moscow', 'Moscow', 'MOW', 'Europe/Moscow'], ['dubai', 'Dubai', 'DXB', 'Asia/Dubai'], ['mumbai', 'Mumbai', 'BOM', 'Asia/Kolkata'],
    ['bangkok', 'Bangkok', 'BKK', 'Asia/Bangkok'], ['singapore', 'Singapore', 'SIN', 'Asia/Singapore'], ['hong-kong', 'Hong Kong', 'HKG', 'Asia/Hong_Kong'], ['shanghai', 'Shanghai', 'SHA', 'Asia/Shanghai'],
    ['seoul', 'Seoul', 'SEL', 'Asia/Seoul'], ['tokyo', 'Tokyo', 'TYO', 'Asia/Tokyo'], ['sydney', 'Sydney', 'SYD', 'Australia/Sydney'], ['auckland', 'Auckland', 'AKL', 'Pacific/Auckland'],
    ['honolulu', 'Honolulu', 'HNL', 'Pacific/Honolulu'], ['anchorage', 'Anchorage', 'ANC', 'America/Anchorage'], ['cupertino', 'Cupertino', 'CUP', 'America/Los_Angeles'], ['los-angeles', 'Los Angeles', 'LA', 'America/Los_Angeles'],
    ['denver', 'Denver', 'DEN', 'America/Denver'], ['chicago', 'Chicago', 'CHI', 'America/Chicago'], ['new-york', 'New York', 'NYC', 'America/New_York'], ['toronto', 'Toronto', 'TOR', 'America/Toronto'],
    ['mexico-city', 'Mexico City', 'MEX', 'America/Mexico_City'], ['sao-paulo', 'São Paulo', 'SAO', 'America/Sao_Paulo'], ['buenos-aires', 'Buenos Aires', 'BUE', 'America/Argentina/Buenos_Aires'], ['reykjavik', 'Reykjavík', 'REY', 'Atlantic/Reykjavik'],
  ].map(([id, name, short, zone]) => Object.freeze({id, name, short, zone})));
  const WORLD_CLOCK_DEFAULT = Object.freeze(['new-york', 'london', 'tokyo', 'sydney']);
  const KIND_BY_TYPE = new Map(WIDGET_KINDS.map(kind => [kind.type, kind]));
  // The closest designed size: a bigger request keeps as much room as it can.
  const NEAREST = { small:['small', 'medium', 'tall', 'large'], medium:['medium', 'small', 'large', 'tall'], large:['large', 'tall', 'medium', 'small'], tall:['tall', 'large', 'medium', 'small'], wide:['medium', 'large', 'small', 'tall'] };
  function allowedSizes(types) {
    const list = (Array.isArray(types) ? types : [types]).filter(Boolean);
    const sets = list.map(type => KIND_BY_TYPE.get(type)?.sizes || SIZE_ORDER);
    const shared = SIZE_ORDER.filter(size => sets.every(sizes => sizes.includes(size)));
    return shared.length ? shared : [...(sets[0] || SIZE_ORDER)];
  }
  function fitSize(types, size) {
    const allowed = allowedSizes(types);
    return (NEAREST[size] || NEAREST.medium).find(choice => allowed.includes(choice)) || allowed[0];
  }
  // Spreads cards over pages so each page's widgets fit (up to maxPages); cards
  // that fit nowhere stay on the last page. Returns a new page id per card id.
  function spreadOverPages(cards, pageIds, {columns = 8, rows = 2, maxPages = 6, newPageId = index => `page-${index + 1}`} = {}) {
    const ids = [...pageIds], assigned = {}, byPage = new Map(ids.map(id => [id, []]));
    for (const card of cards) {
      if (!card || card.type === 'launchers' || card.enabled === false) continue;
      let page = ids.find(id => !packInOrder([...byPage.get(id), card], {columns, rows}).overflow.length);
      if (!page && ids.length < maxPages) { page = newPageId(ids.length); ids.push(page); byPage.set(page, []); }
      page = page || ids[ids.length - 1];
      byPage.get(page).push(card); assigned[card.id] = page;
    }
    return {pages:ids, assigned};
  }

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
    'rain-wind': {weight:.5, min:200, stack:true}, 'daily-forecast': {weight:.6, min:220, stack:true}, 'sun-path': {weight:.5, min:200, stack:true}, dial: {weight:.5, min:200, stack:true}, city: {weight:.5, min:200, stack:true}, 'world-clock': {weight:1, min:360, stack:true},
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

  return Object.freeze({packCards,packWidgets,planAuto,SIZE_SPANS,WIDGET_SPANS,WIDGET_DEFAULTS,AUTO_PROFILES,WIDGET_KINDS,WIDGET_SOURCES,SIZE_ORDER,CITIES,WORLD_CLOCK_DEFAULT,allowedSizes,fitSize,spreadOverPages});
});
