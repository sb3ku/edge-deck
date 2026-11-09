const fs = require('node:fs');
const path = require('node:path');
const {randomUUID}=require('node:crypto');
const {isLanHost}=require('./printers.cjs');
const {normalizeWeatherConfig}=require('./weather.cjs');
const {POWER_MODES,DEFAULT_POWER_MODE}=require('./power.cjs');
const {WIDGET_DEFAULTS,CITIES,WORLD_CLOCK_DEFAULT,fitSize,spreadOverPages,packWidgets}=require('./layout.cjs');
const CITY_IDS=new Set(CITIES.map(city=>city.id));
const ICON_ID=/^(?:simple-icons|ri|mdi|cib|fa6-brands):[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_TYPES = new Set(['today', 'clock', 'weather', 'tasks', 'printers', 'media', 'actions', 'stats', 'app', 'website', 'empty', 'gauge', 'switch', 'timer', 'machine', 'rain-wind', 'daily-forecast', 'sun-path', 'dial', 'city', 'world-clock']);
// Single-purpose widgets: one reading, one quick control, one countdown, one printer.
const GAUGE_METRICS = new Set(['cpu', 'gpu', 'memory', 'vram', 'cpu-temp', 'gpu-temp']);
const TOGGLE_CONTROLS = new Set(['wifi', 'bluetooth', 'sound', 'mic', 'dark', 'night']);
const SIZES = new Set(['small', 'medium', 'wide', 'tall', 'large']);
// Widgets is the only layout; older settings name one of the earlier layouts.
const MODES = new Set(['widgets', 'auto', 'overview', 'bento', 'focus']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const TITLES = {clock:'Clock',dial:'Clock',weather:'Weather',tasks:'Agent chats',printers:'Printers',media:'Now playing',actions:'Quick actions',stats:'PC stats',launchers:'Apps'};
// The first Home screen: 15 of the 16 cells on the deck.
const DEFAULT_SIZES = {weather:'medium',dial:'small',media:'large',printers:'medium',tasks:'medium',stats:'medium',actions:'tall',launchers:null};
const defaults = () => ({
  theme: 'dark', clock24: true,
  layout: {mode:'widgets'},
  power: {mode:DEFAULT_POWER_MODE},
  notifications: {printers:true,agents:true},
  spotify: {clientId:''},
  weather: {location:null,units:'metric'}, music: {savedPlaylists:[]},
  widgets: Object.entries(DEFAULT_SIZES).map(([type,size]) => type==='launchers'
    ? {id:type,type,title:TITLES[type],enabled:true}
    : {id:type,type,title:TITLES[type],enabled:true,size,items:[{id:type+'-content',type}],activeItemId:type+'-content'}),
  printers: [{id:'h2d', name:'Bambu Lab H2D', model:'H2D',host:'',serial:''},{id:'p1s',name:'Bambu Lab P1S',model:'P1S',host:'',serial:''}],
  launchers: [{id:'chatgpt',name:'ChatGPT',target:'https://chatgpt.com/'},{id:'spotify',name:'Spotify',target:'spotify:'}]
});
function normalizePlaylistUri(input) {
  if(typeof input!=='string' || input.length>2048 || /[\r\n\0]/.test(input))throw Error('Paste a Spotify playlist link or URI.');
  input=input.trim();
  if(/^spotify:playlist:[A-Za-z0-9]{22}$/.test(input))return input;
  try {
    const url=new URL(input);
    const match=/^\/playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
    if(url.protocol==='https:' && url.hostname==='open.spotify.com' && !url.port && !url.username && !url.password && match)return 'spotify:playlist:'+match[1];
  } catch {}
  throw Error('Paste a Spotify playlist link or URI.');
}
function cleanSavedPlaylists(input) {
  if(!Array.isArray(input)||input.length>50)throw Error('Save up to 50 playlists.');
  const ids=new Set(),uris=new Set();
  return input.map(item=>{
    if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>80||/[\u0000-\u001f\u007f]/.test(item.name))throw Error('Choose a playlist name of up to 80 characters.');
    const uri=normalizePlaylistUri(item.uri);if(uris.has(uri))throw Error('This playlist is already saved.');
    ids.add(item.id);uris.add(uri);return{id:item.id,name:item.name.trim(),uri};
  });
}
function withWeather(widgets) {
  if(widgets.some(widget=>widget.type==='weather'))return widgets;
  let id='weather',suffix=2;while(widgets.some(widget=>widget.id===id))id='weather-'+suffix++;
  const index=widgets.findIndex(widget=>widget.type==='clock');
  const result=widgets.slice();result.splice(index<0?0:index+1,0,{id,type:'weather',title:'Weather',enabled:true});return result;
}
function validTarget(target) {
  if (typeof target !== 'string' || target.length > 2048 || /[\r\n\0]/.test(target)) return false;
  if (target === 'spotify:') return true;
  try { const u = new URL(target); if (u.protocol === 'https:' && !u.username && !u.password) return true; } catch {}
  return path.win32.isAbsolute(target) && ['.exe','.lnk'].includes(path.extname(target).toLowerCase()) && !path.win32.normalize(target).startsWith('\\\\');
}
function cleanLabel(value, fallback = '', legacy = false) {
  if(value===undefined || value===null)return fallback;
  if(typeof value!=='string' || /[\u0000-\u001f\u007f]/.test(value))throw Error('Use a name of up to 60 characters.');
  const label=value.trim();
  if(label.length>60 && !legacy)throw Error('Use a name of up to 60 characters.');
  return label.slice(0,60);
}
function cleanConfig(input, previous, {loading = false} = {}) {
  if (!input || typeof input !== 'object') throw Error('Invalid settings.');
  if(input.widgets!==undefined && !Array.isArray(input.widgets))throw Error('Choose a valid card layout.');
  let widgets = input.widgets ?? previous.widgets;
  const legacy=Array.isArray(input.widgets) && input.widgets.length>0 && !input.layout && input.widgets.every(w=>w && !Object.hasOwn(w,'items'));
  // The one-time old-format migration adds Weather. Once cards have items and
  // layout settings, removing Weather (including all cards) stays intentional.
  if(legacy)widgets=withWeather(widgets);
  if(widgets.length>41)throw Error('Use up to 40 widgets and one app dock.');
  const ids = widgets.map(w => w?.id);
  if(ids.some(id=>typeof id!=='string'||!ID.test(id)) || new Set(ids).size!==ids.length)throw Error('Card IDs must be valid and unique.');
  const dockCount=widgets.filter(w=>w.type==='launchers').length;
  const oldCards=(previous.widgets||[]).filter(w=>w.type!=='launchers');
  const grandfathered=widgets.length===41 && !dockCount && (loading || (oldCards.length===41 && widgets.every(w=>oldCards.some(old=>old.id===w.id))));
  if(dockCount>1 || (widgets.length-dockCount>40 && !grandfathered))throw Error('Use up to 40 widgets and one app dock.');
  if(input.launchers!==undefined && !Array.isArray(input.launchers))throw Error('Choose valid saved apps.');
  const launchers = Array.isArray(input.launchers) ? input.launchers : previous.launchers;
  if (launchers.length > 30 || launchers.some(l => !l || !validTarget(l.target) || typeof l.name !== 'string' || !l.name.trim())) throw Error('Choose an app or enter a valid HTTPS address.');
  const launcherIds=new Set();
  const nextLaunchers=launchers.map(l=>{
    if(typeof l.id!=='string'||!ID.test(l.id)||launcherIds.has(l.id))throw Error('Saved app IDs must be valid and unique.');
    launcherIds.add(l.id);
    // An optional chosen dock icon (an Iconify id such as simple-icons:spotify).
    if(l.icon!==undefined&&l.icon!==''&&(typeof l.icon!=='string'||!ICON_ID.test(l.icon))&&!loading)throw Error('Choose an icon from the icon search.');
    return{id:l.id,name:cleanLabel(l.name,'',legacy),target:l.target,...(typeof l.icon==='string'&&ICON_ID.test(l.icon)?{icon:l.icon}:{})};
  });
  // Pages: up to six named screens; every card is on one. Older settings have
  // none, so their cards become the "Home" page.
  if(input.pages!==undefined&&!Array.isArray(input.pages))throw Error('Choose valid pages.');
  const pageInput=Array.isArray(input.pages)?input.pages:Array.isArray(previous.pages)?previous.pages:[];
  const pageIds=new Set();
  const pages=pageInput.filter(page=>page&&typeof page.id==='string'&&ID.test(page.id)&&!pageIds.has(page.id)&&pageIds.add(page.id)).slice(0,6)
    .map(page=>({id:page.id,name:cleanLabel(page.name,'',false).slice(0,24)||'Page'}));
  if(!pages.length)pages.push({id:'home',name:'Home'});
  if(Array.isArray(input.pages)&&input.pages.length>6&&!loading)throw Error('Use up to six pages.');
  // Time & weather is now two widgets, like iOS: Clock digital and Forecast.
  let splitToday=false;
  widgets=widgets.flatMap(w=>{
    const items=Array.isArray(w?.items)?w.items:null;
    const today=w&&w.type!=='launchers'&&(items?items.length===1&&items[0]?.type==='today':w.type==='today');
    if(!today||typeof w.id!=='string')return[w];
    splitToday=true;
    let id=(w.id.slice(0,70)+'-weather');while(widgets.some(other=>other?.id===id))id+='x';
    const big=['large','tall'].includes(w.size);
    return[{...w,type:'dial',size:'small',items:[{id:w.id.slice(0,72)+'-clock',type:'dial',face:'digital'}],activeItemId:w.id.slice(0,72)+'-clock'},
      {...w,id,type:'weather',title:'',size:big?'medium':'small',items:[{id:id.slice(0,72)+'-view',type:'weather'}],activeItemId:id.slice(0,72)+'-view'}];
  }).map(w=>{
    // A card with several views that included Time & weather shows the forecast instead.
    if(!Array.isArray(w?.items)||!w.items.some(item=>item?.type==='today'))return w;
    splitToday=true;return{...w,items:w.items.map(item=>item?.type==='today'?{...item,type:'weather'}:item)};
  });
  if(widgets.length>41)widgets=widgets.slice(0,41);
  const nextWidgets=widgets.map(w=>{
    const title=cleanLabel(w.title,'',legacy);
    if(w.type==='launchers')return{id:w.id,type:'launchers',title:title||'Apps',enabled:w.enabled!==false};
    let size=w.size??'medium';if(!SIZES.has(size))throw Error('Choose a supported card size.');
    let items=w.items;
    if(items===undefined){
      if(!CONTENT_TYPES.has(w.type))throw Error('Unknown card content.');
      items=w.type==='empty'?[]:[{id:w.id.slice(0,72)+'-content',type:w.type}];
    }
    if(!Array.isArray(items)||items.length>6)throw Error('Use up to six content tabs in each card.');
    const itemIds=new Set();
    items=items.map(item=>{
      if(!item||typeof item.id!=='string'||!ID.test(item.id)||itemIds.has(item.id))throw Error('Content tab IDs must be valid and unique within their card.');
      if(!CONTENT_TYPES.has(item.type))throw Error('Unknown card content.');
      itemIds.add(item.id);
      const next={id:item.id,type:item.type};
      const label=cleanLabel(item.label);if(label)next.label=label;
      if(item.type==='app'||item.type==='website'){
        const launcher=nextLaunchers.find(l=>l.id===item.launcherId);
        if(!launcher)throw Error('This card uses a missing app. Remove its content tab before deleting the saved app.');
        if(item.type==='website'&&!/^https:/i.test(launcher.target))throw Error('Website cards require a saved HTTPS address.');
        next.launcherId=launcher.id;
      }
      if(item.type==='gauge'){if(item.metric!==undefined&&!GAUGE_METRICS.has(item.metric)&&!loading)throw Error('Choose a supported gauge reading.');next.metric=GAUGE_METRICS.has(item.metric)?item.metric:'cpu';}
      if(item.type==='switch'){if(item.control!==undefined&&!TOGGLE_CONTROLS.has(item.control)&&!loading)throw Error('Choose a supported quick control.');next.control=TOGGLE_CONTROLS.has(item.control)?item.control:'wifi';}
      // A printer widget keeps working (it shows the first printer) when its printer is removed.
      if(item.type==='machine'&&typeof item.printerId==='string'&&ID.test(item.printerId)&&(!Array.isArray(previous?.printers)||previous.printers.some(p=>p.id===item.printerId)))next.printerId=item.printerId;
      if(item.type==='timer'){const minutes=Number(item.minutes);if(Number.isInteger(minutes)&&minutes>=1&&minutes<=720)next.minutes=minutes;}
      // Clock faces and cities: unknown values fall back to the default.
      if(item.type==='dial')next.face=['digital','numbers','bars','quarters'].includes(item.face)?item.face:'digital';
      if(item.type==='city'){next.face=['digital','numbers','bars','quarters'].includes(item.face)?item.face:'digital';next.city=CITY_IDS.has(item.city)?item.city:'cupertino';}
      if(item.type==='world-clock'){const cities=Array.isArray(item.cities)?item.cities.filter(id=>CITY_IDS.has(id)).slice(0,4):[];next.cities=cities.length?cities:[...WORLD_CLOCK_DEFAULT];}
      return next;
    });
    // Each widget offers only its own sizes; coming from an earlier layout, it starts at the size that suits it.
    const fromOldLayout=(input.layout?.mode??previous.layout?.mode??'overview')!=='widgets';
    const types=items.length?items.map(item=>item.type):['empty'];
    size=fitSize(types,fromOldLayout&&items.length===1?(WIDGET_DEFAULTS[items[0].type]||size):size);
    const activeItemId=itemIds.has(w.activeItemId)?w.activeItemId:items[0]?.id??null;
    const type=items.find(item=>item.id===activeItemId)?.type??'empty';
    const page=pages.some(p=>p.id===w.page)?w.page:pages[0].id;
    return{id:w.id,type,title,enabled:w.enabled!==false,size,items,activeItemId,page};
  });
  // An unreadable saved power mode falls back quietly; an invalid change is rejected.
  let power=previous.power&&POWER_MODES.has(previous.power.mode)?{mode:previous.power.mode}:{mode:DEFAULT_POWER_MODE};
  if(input.power!==undefined){
    if(input.power&&typeof input.power==='object'&&POWER_MODES.has(input.power.mode))power={mode:input.power.mode};
    else if(!loading)throw Error('Choose Off, Automatic or On for low-power mode.');
  }
  // Tray notifications: each kind is on unless turned off.
  const notifications={printers:previous.notifications?.printers!==false,agents:previous.notifications?.agents!==false};
  if(input.notifications!==undefined){
    if(!input.notifications||typeof input.notifications!=='object'||Array.isArray(input.notifications)){if(!loading)throw Error('Choose which notifications to show.');}
    else for(const key of ['printers','agents'])if(input.notifications[key]!==undefined)notifications[key]=input.notifications[key]!==false;
  }
  const requested=input.layout?.mode??previous.layout?.mode??'overview';
  if(input.layout!==undefined && (!input.layout || typeof input.layout!=='object' || Array.isArray(input.layout)))throw Error('Choose a valid layout mode.');
  if(!MODES.has(requested))throw Error('Choose a valid layout mode.');
  const mode='widgets';
  // Leaving an earlier layout: spread the cards over pages so every widget fits.
  // After the split, widgets that no longer fit their page move to one with room.
  if(splitToday&&requested==='widgets'){
    const byPage=new Map(pages.map(page=>[page.id,[]]));
    for(const widget of nextWidgets)if(widget.type!=='launchers'&&widget.enabled!==false)(byPage.get(widget.page)||byPage.get(pages[0].id)).push(widget);
    const fits=list=>!packWidgets(list.map(w=>({id:w.id,size:w.size})),{columns:8,rows:2}).overflow.length;
    for(const page of [...pages]){
      const list=byPage.get(page.id);
      while(list.length&&!fits(list)){
        const moving=list.pop();
        let target=pages.find(other=>other.id!==page.id&&fits([...byPage.get(other.id),moving]));
        if(!target&&pages.length<6){let id=`page-${pages.length+1}`;while(pages.some(other=>other.id===id))id+='x';target={id,name:`Page ${pages.length+1}`};pages.push(target);byPage.set(id,[]);}
        if(!target){list.push(moving);break;}
        moving.page=target.id;byPage.get(target.id).push(moving);
      }
    }
  }
  if(requested!=='widgets'){
    const spread=spreadOverPages(nextWidgets,pages.map(page=>page.id),{newPageId:index=>{let id=`page-${index+1}`;while(pages.some(page=>page.id===id))id+='x';return id;}});
    for(const id of spread.pages)if(!pages.some(page=>page.id===id))pages.push({id,name:`Page ${pages.length+1}`});
    for(const widget of nextWidgets)if(spread.assigned[widget.id])widget.page=spread.assigned[widget.id];
  }
  return {...previous, theme:'dark', clock24: input.clock24===undefined?previous.clock24:input.clock24!==false,
    layout:{mode},power,notifications,pages,widgets:nextWidgets,launchers:nextLaunchers};
}
function createConfigStore(directory, safeStorage) {
  const file = path.join(directory, 'settings.json');
  fs.mkdirSync(directory,{recursive:true});
  let config = defaults();
  let warning = null;
  try {
    const loaded = JSON.parse(fs.readFileSync(file,'utf8'));
    config = cleanConfig(loaded, config, {loading:true});
    if (Array.isArray(loaded.printers)) config.printers = config.printers.map(p => ({...p,...loaded.printers.find(x => x.id === p.id)}));
    if(loaded.spotify && /^[a-f0-9]{32}$/i.test(loaded.spotify.clientId || ''))config.spotify={clientId:loaded.spotify.clientId,encryptedTokens:typeof loaded.spotify.encryptedTokens==='string'?loaded.spotify.encryptedTokens:undefined};
    if(loaded.weather){try{config.weather=normalizeWeatherConfig(loaded.weather);}catch{warning='Saved weather settings were invalid. Choose a city again.';}}
    if(loaded.music?.savedPlaylists){try{config.music={savedPlaylists:cleanSavedPlaylists(loaded.music.savedPlaylists)};}catch{warning='Saved playlist settings were invalid. The original file is unchanged until you save.';}}
  } catch(e) { if(e.code !== 'ENOENT') warning='Saved settings could not be loaded. Defaults are shown; the original file is untouched until you save.'; }
  const persist = () => {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(config,null,2));
    fs.renameSync(temporary,file);
  };
  return {
    publicConfig: () => ({...config,warning,spotify:{clientId:config.spotify?.clientId||''},printers:config.printers.map(({encryptedAccessCode,...p}) => ({...p,configured:Boolean(p.host && p.serial && encryptedAccessCode)}))}),
    saveWeather: input => {
      const next=normalizeWeatherConfig(input,config.weather);const old=config;config={...config,weather:next};
      try{persist();}catch(error){config=old;throw error;}
    },
    savePlaylist: input => {
      const uri=normalizePlaylistUri(input?.uri);
      const current=config.music.savedPlaylists.find(item=>item.uri===uri);
      const next={id:current?.id||randomUUID(),name:input?.name,uri};
      const savedPlaylists=cleanSavedPlaylists(current?config.music.savedPlaylists.map(item=>item.id===current.id?next:item):[...config.music.savedPlaylists,next]);
      const old=config;config={...config,music:{savedPlaylists}};try{persist();}catch(error){config=old;throw error;}return next;
    },
    removePlaylist: id => {
      if(typeof id!=='string'||!config.music.savedPlaylists.some(item=>item.id===id))throw Error('Saved playlist was not found.');
      const old=config;config={...config,music:{savedPlaylists:config.music.savedPlaylists.filter(item=>item.id!==id)}};try{persist();}catch(error){config=old;throw error;}
    },
    spotifyConfig: () => {
      let tokens=null;try{if(config.spotify?.encryptedTokens)tokens=JSON.parse(safeStorage.decryptString(Buffer.from(config.spotify.encryptedTokens,'base64')));}catch{}
      return{clientId:config.spotify?.clientId||'',tokens};
    },
    saveSpotify: input => {
      const clientId=String(input?.clientId||'').trim();if(clientId&&!/^[a-f0-9]{32}$/i.test(clientId))throw Error('Enter the 32-character Spotify app Client ID.');
      const old=config;config={...config,spotify:clientId===config.spotify?.clientId?config.spotify:{clientId}};
      try{persist();}catch(error){config=old;throw error;}
    },
    saveSpotifyTokens: tokens => {
      if(tokens && !safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable.');
      const old=config;config={...config,spotify:{...config.spotify,encryptedTokens:tokens?safeStorage.encryptString(JSON.stringify(tokens)).toString('base64'):undefined}};
      try{persist();}catch(error){config=old;throw error;}
    },
    privatePrinters: () => config.printers.map(({encryptedAccessCode,...p}) => {
      let accessCode = '';
      try { if(encryptedAccessCode) accessCode=safeStorage.decryptString(Buffer.from(encryptedAccessCode,'base64')); } catch {}
      return {...p,accessCode};
    }),
    save: input => { const old=config; config=cleanConfig(input,config); try {persist();warning=null;} catch(e){config=old;throw e;} },
    savePrinter: input => {
      const current=config.printers.find(p=>p.id===input?.id);
      if(!current) throw Error('Unknown printer.');
      const host=String(input.host || '').trim(), serial=String(input.serial || '').trim();
      if(host && !isLanHost(host)) throw Error('Enter a private LAN IP address or local hostname, without a URL or port.');
      if(serial && !/^[a-zA-Z0-9_-]{4,64}$/.test(serial)) throw Error('Enter a valid printer serial number (4–64 letters, numbers, underscores or hyphens).');
      if(!['H2D','P1S'].includes(input.model)) throw Error('Choose H2D or P1S.');
      const next={...current,name:String(input.name||current.name).slice(0,60),model:input.model,host,serial,allowSelfSigned:input.allowSelfSigned===true,controlAccess:input.controlAccess===true};
      if(input.accessCode) {
        if(!safeStorage.isEncryptionAvailable()) throw Error('Windows credential encryption is unavailable.');
        if(typeof input.accessCode !== 'string' || input.accessCode.length>128 || /[\u0000-\u001f]/.test(input.accessCode)) throw Error('Invalid access code.');
        next.encryptedAccessCode=safeStorage.encryptString(input.accessCode).toString('base64');
      }
      const old=config;
      config={...config,printers:config.printers.map(p=>p.id===next.id?next:p)};
      try {persist();} catch(e){config=old;throw e;}
    }
  };
}
module.exports={defaults,validTarget,cleanConfig,createConfigStore,normalizePlaylistUri,GAUGE_METRICS,TOGGLE_CONTROLS};
