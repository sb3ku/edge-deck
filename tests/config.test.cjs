const test=require('node:test');
const assert=require('node:assert/strict');
const {validTarget,cleanConfig,defaults,createConfigStore,normalizePlaylistUri}=require('../lib/config.cjs');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
test('launcher rejects shell commands and dangerous URL schemes',()=>{
  for(const target of ['javascript:alert(1)','file:///C:/secret','cmd /c whoami','http://example.com','\\\\host\\app.exe','//host/share/app.exe','https://user:password@example.com'])assert.equal(validTarget(target),false,target);
  assert.equal(validTarget('https://chatgpt.com/'),true);assert.equal(validTarget('spotify:'),true);
});

test('legacy widgets gain weather after clock without losing their order or visibility',()=>{
  const original=defaults();
  const widgets=[{id:'music',type:'media',title:'Music',enabled:false},{id:'time',type:'clock',title:'Clock',enabled:false},{id:'jobs',type:'tasks',title:'Tasks',enabled:true}];
  const migrated=cleanConfig({widgets},original);
  assert.deepEqual(migrated.widgets.map(w=>w.type),['media','clock','weather','tasks']);
  assert.equal(migrated.widgets[0].enabled,false);assert.equal(migrated.widgets[1].enabled,false);assert.equal(migrated.widgets[2].enabled,true);
  assert.equal(cleanConfig(migrated,migrated).widgets.filter(w=>w.type==='weather').length,1);
  migrated.widgets[2].enabled=false;assert.equal(cleanConfig(migrated,migrated).widgets[2].enabled,false);
  assert.equal(migrated.layout.mode,'widgets','Widgets is the only layout');
  assert.deepEqual(migrated.widgets[0].items,[{id:'music-content',type:'media'}]);
  assert.equal(migrated.widgets[0].activeItemId,'music-content');
  assert.equal(migrated.widgets[0].size,'medium');
});

const card=(id,items=[{id:id+'-content',type:'clock'}],extra={})=>({id,type:'clock',title:'',enabled:true,size:'medium',items,activeItemId:items[0]?.id??null,...extra});

test('cards support tabs, repeated built-ins, empty content and a validated layout mode',()=>{
  const before=defaults();
  const items=[{id:'time',type:'clock'},{id:'weather',type:'weather',label:'Outside'}];
  const next=cleanConfig({layout:{mode:'bento'},widgets:[card('first',items,{activeItemId:'weather',size:'large',title:'  My card  '}),card('another'),card('blank',[])]},before);
  assert.equal(next.layout.mode,'widgets','Earlier layouts become Widgets');
  assert.equal(next.widgets[0].type,'weather','Canonical type follows the selected tab');
  assert.equal(next.widgets[0].title,'My card');
  assert.equal(next.widgets[0].size,'large');
  assert.equal(next.widgets[0].items[1].label,'Outside');
  assert.equal(next.widgets[1].type,'clock');
  assert.equal(next.widgets[2].type,'empty');
  assert.equal(next.widgets[2].activeItemId,null);
  next.widgets[0].activeItemId='deleted-tab';
  assert.equal(cleanConfig(next,next).widgets[0].activeItemId,'time');
  assert.throws(()=>cleanConfig({layout:{mode:'unknown'}},before),/layout/);
  assert.throws(()=>cleanConfig({widgets:[card('bad',[],{size:'huge'})]},before),/size/);
});

test('deleting Weather or every card persists without repeating migration',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deck-cards-'));
  try {
    const store=createConfigStore(dir,{});
    const original=store.publicConfig();
    store.save({widgets:original.widgets.filter(w=>w.type!=='weather')});
    const reloaded=createConfigStore(dir,{});
    assert.equal(reloaded.publicConfig().widgets.some(w=>w.type==='weather'),false);
    reloaded.save({widgets:[]});
    assert.deepEqual(createConfigStore(dir,{}).publicConfig().widgets,[]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('app references validate against the complete next launcher list and reject dangling removals',()=>{
  const before=defaults();
  const widget=card('links',[{id:'web',type:'website',launcherId:'new-web'},{id:'player',type:'app',launcherId:'spotify'}]);
  const launchers=[...before.launchers,{id:'new-web',name:'Site',target:'HTTPS://example.com/'}];
  const saved=cleanConfig({widgets:[widget],launchers},before);
  assert.equal(saved.widgets[0].items[0].launcherId,'new-web');
  assert.throws(()=>cleanConfig({launchers:before.launchers},saved),/missing app/);
  assert.equal(saved.launchers.length,3,'Rejected changes leave the previous configuration intact');
  assert.throws(()=>cleanConfig({widgets:[card('bad',[{id:'web',type:'website',launcherId:'spotify'}])]},before),/HTTPS/);
  const removed=cleanConfig({widgets:[],launchers:before.launchers},saved);
  assert.equal(removed.widgets.length,0,'An app and its referencing tab can be removed in the same save');
});

test('card IDs, tab IDs, titles, content counts and dock counts are bounded',()=>{
  const before=defaults();
  for(const widget of [card('bad id'),card('x'.repeat(81)),card('title',[],{title:'x'.repeat(61)}),card('dupe',[{id:'one',type:'clock'},{id:'one',type:'weather'}]),card('many',Array.from({length:7},(_,i)=>({id:'i'+i,type:'clock'}))),card('unknown',[{id:'one',type:'not-real'}])]) {
    assert.throws(()=>cleanConfig({widgets:[widget]},before));
  }
  const sixteen=Array.from({length:40},(_,i)=>card('card-'+i));
  const dock={id:'dock',type:'launchers',title:'Apps',enabled:true};
  assert.equal(cleanConfig({widgets:[...sixteen,dock]},before).widgets.length,41);
  assert.throws(()=>cleanConfig({widgets:[...sixteen,card('extra')]},before),/40 widgets/);
  assert.throws(()=>cleanConfig({widgets:[dock,{...dock,id:'second-dock'}]},before),/40 widgets/);
  assert.throws(()=>cleanConfig({launchers:[before.launchers[0],before.launchers[0]]},before),/unique/);
});

test('a legacy sixteen-card dashboard migrates once without dropping its seventeenth weather card',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deck-legacy-cards-'));
  try {
    const legacy={...defaults(),widgets:Array.from({length:16},(_,i)=>({id:'old-'+i,type:'clock',title:'Legacy '+i,enabled:i!==3}))};
    delete legacy.layout;
    fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify(legacy));
    const store=createConfigStore(dir,{}), migrated=store.publicConfig();
    assert.equal(migrated.warning,null);
    assert.equal(migrated.widgets.length,17);
    assert.equal(migrated.widgets.find(w=>w.id==='old-3').enabled,false);
    migrated.layout.mode='focus';
    store.save(migrated);
    assert.equal(createConfigStore(dir,{}).publicConfig().widgets.length,17);
    const deleted=store.publicConfig().widgets.filter(w=>w.type!=='weather');
    store.save({widgets:deleted});
    assert.equal(createConfigStore(dir,{}).publicConfig().widgets.length,16);
    store.save({widgets:[...deleted,card('new-seventeenth')]});
    assert.equal(createConfigStore(dir,{}).publicConfig().widgets.length,17,'Pages hold more than sixteen widgets');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('legacy card migration and layout saves preserve connection secrets, weather, music and clock preferences',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deck-layout-preserve-'));
  const crypto={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  try {
    const source=createConfigStore(dir,crypto);
    source.save({clock24:false});
    source.savePrinter({id:'h2d',model:'H2D',host:'192.168.1.23',serial:'TEST123',accessCode:'printer-test-secret',allowSelfSigned:true,controlAccess:true});
    source.saveSpotify({clientId:'a'.repeat(32)});
    source.saveSpotifyTokens({clientId:'a'.repeat(32),accessToken:'spotify-test-token',refreshToken:'refresh-test-token',expiresAt:123456789});
    source.saveWeather({location:{id:'760844',name:'Kraków',country:'Poland',latitude:52.78152,longitude:20.1177,timezone:'Europe/Warsaw'}});
    source.savePlaylist({name:'Saved songs',uri:'spotify:playlist:1234567890ABCDEFGHIJKL'});
    const file=path.join(dir,'settings.json');
    const legacy=JSON.parse(fs.readFileSync(file,'utf8'));
    delete legacy.layout;
    legacy.widgets=legacy.widgets.filter(w=>w.type!=='weather').map(({items,activeItemId,size,...widget})=>widget);
    const original=JSON.stringify(legacy);
    fs.writeFileSync(file,original);
    const migrated=createConfigStore(dir,crypto);
    assert.equal(fs.readFileSync(file,'utf8'),original,'Reading migration does not overwrite the existing file');
    migrated.save({layout:{mode:'bento'}});
    const stored=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const key of ['spotify','printers','weather','music','clock24','launchers'])assert.deepEqual(stored[key],legacy[key],key);
    assert.equal(migrated.privatePrinters()[0].accessCode,'printer-test-secret');
    assert.equal(migrated.spotifyConfig().tokens.accessToken,'spotify-test-token');
    assert.doesNotMatch(JSON.stringify(migrated.publicConfig()),/printer-test-secret|spotify-test-token|encryptedTokens|encryptedAccessCode/);
    fs.mkdirSync(file+'.tmp');
    assert.throws(()=>migrated.save({layout:{mode:'focus'},widgets:[]}));
    assert.equal(migrated.publicConfig().layout.mode,'widgets');
    assert.ok(migrated.publicConfig().widgets.length>0);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).layout.mode,'widgets');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('weather and saved playlists require dedicated validation and survive reload',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deck-weather-config-'));
  try {
    const store=createConfigStore(dir,{});
    const location={id:'760844',name:'Kraków',country:'Poland',countryCode:'PL',region:'Lesser Poland',latitude:52.78152,longitude:20.1177,timezone:'Europe/Warsaw'};
    store.saveWeather({location,units:'metric'});
    const uri='spotify:playlist:1234567890ABCDEFGHIJKL';
    const first=store.savePlaylist({name:'My songs',uri});
    const renamed=store.savePlaylist({name:'Renamed',uri:'https://open.spotify.com/playlist/1234567890ABCDEFGHIJKL?si=share'});
    assert.equal(first.id,renamed.id);assert.equal(store.publicConfig().music.savedPlaylists.length,1);
    store.save({weather:{location:null},music:{savedPlaylists:[]}});
    assert.equal(store.publicConfig().weather.location.name,'Kraków');assert.equal(store.publicConfig().music.savedPlaylists.length,1);
    const loaded=createConfigStore(dir,{});assert.equal(loaded.publicConfig().weather.location.timezone,'Europe/Warsaw');assert.equal(loaded.publicConfig().music.savedPlaylists[0].name,'Renamed');
    for(const invalid of [{location:{...location,latitude:91}},{location:{...location,longitude:'20'}},{location:{...location,timezone:'Wrong/Zone'}},{units:'kelvin'},{url:'https://localhost'}])assert.throws(()=>loaded.saveWeather(invalid));
    assert.throws(()=>loaded.savePlaylist({name:'',uri}));assert.throws(()=>loaded.removePlaylist('unknown'));
    loaded.removePlaylist(first.id);assert.equal(loaded.publicConfig().music.savedPlaylists.length,0);
    loaded.saveWeather({location:null});assert.equal(loaded.publicConfig().weather.location,null);
    fs.mkdirSync(path.join(dir,'settings.json.tmp'));
    assert.throws(()=>loaded.saveWeather({location}));assert.equal(loaded.publicConfig().weather.location,null);
    assert.throws(()=>loaded.savePlaylist({name:'Cannot save',uri}));assert.equal(loaded.publicConfig().music.savedPlaylists.length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('playlist links accept only Spotify playlist IDs and canonicalize share parameters',()=>{
  const id='1234567890ABCDEFGHIJKL';
  assert.equal(normalizePlaylistUri('https://open.spotify.com/playlist/'+id+'?si=abc'),'spotify:playlist:'+id);
  for(const value of ['https://evil.test/playlist/'+id,'http://open.spotify.com/playlist/'+id,'https://user:password@open.spotify.com/playlist/'+id,'spotify:track:'+id,'spotify:playlist:short','javascript:alert(1)'])assert.throws(()=>normalizePlaylistUri(value));
});
test('renderer settings cannot replace printer credentials',()=>{
  const original=defaults();original.printers[0].encryptedAccessCode='protected';
  assert.deepEqual(cleanConfig({...original,printers:[]},original).printers,original.printers);
});
test('widget types and duplicates are validated',()=>{
  const config=defaults();
  assert.throws(()=>cleanConfig({...config,widgets:[{id:'x',type:'arbitrary'}]},config));
  assert.throws(()=>cleanConfig({...config,widgets:[config.widgets[0],config.widgets[0]]},config));
});
test('settings survive a new store instance and secrets never enter public config',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deck-test-'));
  const crypto={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  try {
    const first=createConfigStore(dir,crypto), config=first.publicConfig();
    config.widgets[0].enabled=false;config.clock24=false;first.save(config);
    first.savePrinter({id:'h2d',name:'H2D',model:'H2D',host:'192.168.1.23',serial:'SERIAL123',accessCode:'test-secret'});
    first.saveSpotify({clientId:'a'.repeat(32)});first.saveSpotifyTokens({clientId:'a'.repeat(32),accessToken:'spotify-access-secret',refreshToken:'spotify-refresh-secret',expiresAt:123456789});
    const second=createConfigStore(dir,crypto);
    assert.equal(second.publicConfig().widgets[0].enabled,false);
    assert.equal(second.publicConfig().clock24,false);
    assert.equal(second.privatePrinters()[0].accessCode,'test-secret');
    assert.equal(JSON.stringify(second.publicConfig()).includes('test-secret'),false);
    assert.equal(JSON.stringify(second.publicConfig()).includes('encryptedAccessCode'),false);
    assert.equal(second.spotifyConfig().tokens.accessToken,'spotify-access-secret');
    assert.doesNotMatch(JSON.stringify(second.publicConfig()),/spotify-access-secret|spotify-refresh-secret|encryptedTokens/);
    assert.throws(()=>second.saveSpotify({clientId:'invalid'}));assert.equal(second.spotifyConfig().tokens.accessToken,'spotify-access-secret');
    assert.throws(()=>second.savePrinter({id:'p1s',model:'P1S',host:'example.com',serial:'abcd',accessCode:'fake'}));
  } finally {
    const resolved=path.resolve(dir), expected=path.join(path.resolve(os.tmpdir()),'edge-deck-test-');
    if(!resolved.startsWith(expected) || path.dirname(resolved)!==path.resolve(os.tmpdir()))throw Error('Unexpected temporary directory.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('cards are grouped into pages; older settings become one Home page', () => {
  const base = defaults();
  const migrated = cleanConfig({ widgets: base.widgets, layout: base.layout }, base);
  assert.deepEqual(migrated.pages, [{ id: 'home', name: 'Home' }]);
  assert.ok(migrated.widgets.filter(w => w.type !== 'launchers').every(w => w.page === 'home'));
  const pages = [{ id: 'home', name: 'Home' }, { id: 'shop', name: 'Workshop' }];
  const widgets = migrated.widgets.map(w => w.type === 'printers' ? { ...w, page: 'shop' } : w.type === 'media' ? { ...w, page: 'missing' } : w);
  const next = cleanConfig({ widgets, pages }, migrated);
  assert.equal(next.widgets.find(w => w.type === 'printers').page, 'shop');
  assert.equal(next.widgets.find(w => w.type === 'media').page, 'home', 'An unknown page falls back to the first page');
  assert.throws(() => cleanConfig({ pages: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) }, next), /six pages/);
  assert.equal(cleanConfig({ pages: [{ id: 'a', name: '' }] }, next).pages[0].name, 'Page');
});

test('single-purpose widgets keep their reading, control, printer and length, with safe defaults',()=>{
  const before=defaults();
  const saved=cleanConfig({widgets:[card('one',[{id:'g',type:'gauge',metric:'gpu'},{id:'t',type:'switch',control:'bluetooth'},{id:'p',type:'machine',printerId:'p1s'},{id:'m',type:'timer',minutes:25}])]},before);
  assert.deepEqual(saved.widgets[0].items,[{id:'g',type:'gauge',metric:'gpu'},{id:'t',type:'switch',control:'bluetooth'},{id:'p',type:'machine',printerId:'p1s'},{id:'m',type:'timer',minutes:25}]);
  const plain=cleanConfig({widgets:[card('two',[{id:'g',type:'gauge'},{id:'t',type:'switch'},{id:'p',type:'machine',printerId:'gone'},{id:'m',type:'timer',minutes:0}])]},before);
  assert.deepEqual(plain.widgets[0].items,[{id:'g',type:'gauge',metric:'cpu'},{id:'t',type:'switch',control:'wifi'},{id:'p',type:'machine'},{id:'m',type:'timer'}]);
  assert.throws(()=>cleanConfig({widgets:[card('bad',[{id:'g',type:'gauge',metric:'disk'}])]},before),/gauge/);
  assert.throws(()=>cleanConfig({widgets:[card('bad',[{id:'t',type:'switch',control:'volume'}])]},before),/quick control/);
  assert.equal(cleanConfig({widgets:[card('old',[{id:'g',type:'gauge',metric:'disk'}])]},before,{loading:true}).widgets[0].items[0].metric,'cpu');
});

test('earlier layouts move to Widgets: sizes come from the widget and the cards spread over pages so each fits',()=>{
  const before={...defaults(),layout:{mode:'overview'}};
  const cards=['media','stats','printers','tasks','weather','clock','actions','media','stats'].map((type,i)=>({id:'c'+i,type,title:'',enabled:true,size:'wide',items:[{id:'c'+i+'-v',type}],activeItemId:'c'+i+'-v'}));
  const migrated=cleanConfig({...before,widgets:cards},before,{loading:true});
  assert.equal(migrated.layout.mode,'widgets');
  assert.deepEqual(migrated.widgets.map(w=>w.size),['large','large','medium','medium','medium','small','tall','large','large']);
  assert.ok(migrated.pages.length>=2,'The widgets need more than one page');
  const {packWidgets}=require('../src/layout-engine.js');
  for(const page of migrated.pages)assert.deepEqual(packWidgets(migrated.widgets.filter(w=>w.page===page.id),{columns:8,rows:2}).overflow,[],page.id);
  const again=cleanConfig(migrated,migrated);
  assert.deepEqual(again.widgets.map(w=>w.page),migrated.widgets.map(w=>w.page),'Saving again keeps the pages');
});
test('clock and city options fall back to defaults',()=>{
  const before=defaults();
  const saved=cleanConfig({widgets:[card('a',[{id:'d',type:'dial',face:'bars'},{id:'c',type:'city',city:'tokyo',face:'numbers'},{id:'w',type:'world-clock',cities:['paris','nowhere','seoul']}])]},before);
  assert.deepEqual(saved.widgets[0].items,[{id:'d',type:'dial',face:'bars'},{id:'c',type:'city',face:'numbers',city:'tokyo'},{id:'w',type:'world-clock',cities:['paris','seoul']}]);
  const plain=cleanConfig({widgets:[card('b',[{id:'d',type:'dial'},{id:'c',type:'city'},{id:'w',type:'world-clock'}])]},before);
  assert.deepEqual(plain.widgets[0].items.map(i=>[i.face,i.city,i.cities]),[['digital',undefined,undefined],['digital','cupertino',undefined],[undefined,undefined,['new-york','london','tokyo','sydney']]]);
});

test('Time & weather becomes Clock digital and Forecast, and what no longer fits moves to the next page',()=>{
  const before=defaults();
  const today={id:'tw',type:'today',title:'',enabled:true,size:'medium',page:'home',items:[{id:'tw-v',type:'today'}],activeItemId:'tw-v'};
  const split=cleanConfig({...before,widgets:[today,...before.widgets]},before,{loading:true});
  const clock=split.widgets.find(w=>w.id==='tw'),forecast=split.widgets.find(w=>w.id==='tw-weather');
  assert.deepEqual([clock.type,clock.size,clock.items[0].face],['dial','small','digital']);
  assert.deepEqual([forecast.type,forecast.size,forecast.page],['weather','small','home']);
  assert.ok(!split.widgets.some(w=>w.type==='today'));
  const {packWidgets}=require('../src/layout-engine.js');
  for(const page of split.pages)assert.deepEqual(packWidgets(split.widgets.filter(w=>w.page===page.id&&w.type!=='launchers'),{columns:8,rows:2}).overflow,[],page.id);
  const stacked=cleanConfig({widgets:[card('mix',[{id:'a',type:'clock'},{id:'b',type:'today'}])]},before);
  assert.deepEqual(stacked.widgets[0].items.map(i=>i.type),['clock','weather'],'A card with several views shows the forecast instead');
});
