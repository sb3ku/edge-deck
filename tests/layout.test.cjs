'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {packCards,SIZE_SPANS} = require('../lib/layout.cjs');

const card = (id,size='medium',extra={}) => ({id,type:'clock',size,enabled:true,...extra});

test('mixed card sizes reserve their cells and leave prior gaps instead of reordering',()=>{
  const cards=[card('tall','tall'),card('wide','wide'),card('large','large'),card('small','small')];
  const packed=packCards(cards);
  assert.deepEqual(packed, {columns:12,rows:3,cards:[
    {id:'tall',column:1,row:1,columnSpan:3,rowSpan:2},
    {id:'wide',column:4,row:1,columnSpan:6,rowSpan:1},
    {id:'large',column:4,row:2,columnSpan:6,rowSpan:2},
    {id:'small',column:10,row:2,columnSpan:2,rowSpan:1},
  ]});
  assert.deepEqual(packCards(cards),packed,'Packing is deterministic');
  assert.deepEqual(cards.map(c=>c.id),['tall','wide','large','small'],'Packing does not mutate the card order');
});

test('hidden cards and app dock use no cells; narrow layouts clamp spans',()=>{
  const cards=[card('hidden','large',{enabled:false}),card('dock','wide',{type:'launchers'}),card('visible','large'),card('next','small')];
  assert.deepEqual(packCards(cards,{columns:1}),{columns:1,rows:3,cards:[
    {id:'visible',column:1,row:1,columnSpan:1,rowSpan:2},
    {id:'next',column:1,row:3,columnSpan:1,rowSpan:1},
  ]});
  assert.deepEqual(packCards([]),{columns:12,rows:0,cards:[]});
  assert.deepEqual(packCards([card('default',undefined)]).cards[0],{id:'default',column:1,row:1,columnSpan:3,rowSpan:1});
});

test('all size combinations stay within the grid without overlapping or reversing reading order',()=>{
  const sizes=Object.keys(SIZE_SPANS);
  for (const columns of [1,2,3,6,8,12,24]) {
    for (let offset=0;offset<sizes.length;offset++) {
      const cards=Array.from({length:16},(_,i)=>card('card-'+i,sizes[(i+offset)%sizes.length]));
      const snapshot=JSON.stringify(cards);
      const packed=packCards(cards,{columns});
      const occupied=new Set();
      let lastStart=-1;
      for (const item of packed.cards) {
        assert.ok(item.column>=1 && item.column+item.columnSpan-1<=columns);
        const start=(item.row-1)*columns+item.column-1;
        assert.ok(start>lastStart);lastStart=start;
        for(let y=item.row;y<item.row+item.rowSpan;y++)for(let x=item.column;x<item.column+item.columnSpan;x++){
          const cell=y+':'+x;assert.equal(occupied.has(cell),false,cell);occupied.add(cell);
        }
      }
      assert.equal(JSON.stringify(cards),snapshot);
      assert.deepEqual(packed.cards.map(c=>c.id),cards.map(c=>c.id));
    }
  }
});

test('the browser exports the same packing engine without Node globals',()=>{
  const context={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/layout-engine.js'),'utf8'),context);
  assert.equal(typeof context.EdgeLayout.packCards,'function');
  const cards=[card('one','large'),card('two','tall'),card('three','medium')];
  assert.equal(JSON.stringify(context.EdgeLayout.packCards(cards)),JSON.stringify(packCards(cards)));
});

test('invalid grid inputs cannot create an unbounded packing loop',()=>{
  for(const columns of [0,-1,25,1.5,Infinity,NaN,'12'])assert.throws(()=>packCards([],{columns}));
  assert.throws(()=>packCards(Array.from({length:18},(_,i)=>card('c'+i))));
  assert.throws(()=>packCards([card('same'),card('same')]));
  for(const size of ['unknown','constructor','__proto__'])assert.throws(()=>packCards([card('bad',size)]));
});

test('auto arrange shares one row by content and stacks half-height cards when space runs out', () => {
  const { planAuto } = require('../src/layout-engine.js');
  const cards = types => types.map(type => ({ id: type, type }));
  const roomy = planAuto(cards(['clock', 'weather', 'media']), { width: 2500 });
  assert.deepEqual(roomy.columns.map(column => column.ids), [['clock'], ['weather'], ['media']]);
  assert.ok(roomy.columns[0].weight < roomy.columns[1].weight, 'The clock is narrower than the weather');
  const crowded = planAuto(cards(['today', 'tasks', 'printers', 'media', 'stats', 'actions']), { width: 2512 });
  assert.deepEqual(crowded.columns.map(column => column.ids), [['today'], ['tasks', 'printers'], ['media'], ['stats'], ['actions']]);
  // The music player and the controls are never stacked.
  const tight = planAuto(cards(['media', 'actions', 'weather', 'today']), { width: 600 });
  assert.ok(tight.columns.every(column => column.ids.length === 1));
  assert.equal(tight.fits, false);
  assert.deepEqual(planAuto(cards(['clock', 'launchers']), { width: 2500 }).columns.map(column => column.ids), [['clock']]);
});

test('widgets fill an 8×2 grid like iOS, filling gaps, and report what does not fit', () => {
  const { packWidgets, WIDGET_DEFAULTS } = require('../src/layout-engine.js');
  const widgets = ['today', 'tasks', 'printers', 'media', 'stats', 'actions'].map(type => ({ id: type, type, size: WIDGET_DEFAULTS[type] }));
  const plan = packWidgets(widgets, { columns: 8, rows: 2 });
  assert.deepEqual(plan.overflow, []); assert.equal(plan.free, 1, 'The default sizes fit the deck with one cell to spare');
  const media = plan.cards.find(card => card.id === 'media'); assert.deepEqual([media.columnSpan, media.rowSpan], [2, 2], 'Music starts Large: the full player');
  const gap = packWidgets([{ id: 'a', size: 'large' }, { id: 'b', size: 'medium' }, { id: 'c', size: 'small' }], { columns: 4, rows: 2 });
  // Large, medium, then small: column by column, the small one takes the free cell below the medium one.
  assert.deepEqual(gap.cards.find(card => card.id === 'c'), { id: 'c', column: 3, row: 2, columnSpan: 1, rowSpan: 1 }, 'A small widget fills the gap under a medium one');
  const full = packWidgets(Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, size: 'large' })), { columns: 8, rows: 2 });
  assert.deepEqual(full.overflow, ['l4']);
});

test('single-purpose widgets start small and have auto profiles', () => {
  const { WIDGET_DEFAULTS, AUTO_PROFILES } = require('../src/layout-engine.js');
  for (const type of ['gauge', 'switch', 'timer', 'machine']) { assert.equal(WIDGET_DEFAULTS[type], 'small', type); assert.ok(AUTO_PROFILES[type]?.min > 0, type); }
});

test('each widget offers only its own sizes, and a size snaps to the nearest one it has', () => {
  const { WIDGET_KINDS, allowedSizes, fitSize } = require('../src/layout-engine.js');
  assert.deepEqual(allowedSizes('tasks'), ['medium', 'large', 'tall']);
  assert.equal(fitSize('tasks', 'small'), 'medium');
  assert.equal(fitSize('city', 'large'), 'small');
  assert.equal(fitSize('clock', 'tall'), 'large');
  assert.equal(fitSize(['clock', 'weather'], 'tall'), 'large', 'A card with several views offers the sizes they share');
  for (const kind of WIDGET_KINDS) assert.ok(kind.sizes.length > 0 && kind.sizes.every(size => ['small', 'medium', 'large', 'tall'].includes(size)), kind.type);
});
