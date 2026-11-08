// Runs on plain Node.js (the dashboard itself is an Edge window). lib/runtime.cjs
// supplies the few desktop services Electron used to provide.
const {createApp,createScreen,createSafeStorage,shell,fileIcon,chooseFile}=require('./lib/runtime.cjs');
const app=createApp(),screen=createScreen(),safeStorage=createSafeStorage(()=>app.getPath('userData'));
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {createConfigStore,validTarget,normalizePlaylistUri}=require('./lib/config.cjs');
const {createMediaBridge}=require('./lib/media.cjs');
const {createTaskBridge,readTail}=require('./lib/tasks.cjs');
const {isDeepStrictEqual}=require('node:util');
const {createPrinterBridge}=require('./lib/printers.cjs');
const {createSpotifyBridge}=require('./lib/spotify.cjs');
const {createCameraBridge,findFfmpeg}=require('./lib/camera.cjs');
const {createThumbnailStore,findPicture}=require('./lib/print-thumbnail.cjs');
const {createBambuCloud}=require('./lib/bambu-cloud.cjs');
const {createSpotifyCanvas}=require('./lib/spotify-canvas.cjs');
const {createTray}=require('./lib/tray.cjs');
const {createUpdater,repoFrom}=require('./lib/updater.cjs');
const {createNotifier}=require('./lib/notifier.cjs');
const {createToastLines}=require('./lib/toast.cjs');
let notifier=null,notifyTimer=null;
const packageInfo=require('./package.json');
let tray=null,updater=null;
const {createWindowsIntegration}=require('./lib/windows-integration.cjs');
const {createWeatherBridge}=require('./lib/weather.cjs');
const {createAppIcons,ICON_ID}=require('./lib/app-icons.cjs');
const {powerState}=require('./lib/power.cjs');
const {createApprovalBroker}=require('./lib/agent-approvals.cjs');
const claudeHook=require('./lib/claude-hook-settings.cjs');
let approvals=null;
// "Approve Claude Code here": Edge Deck's PermissionRequest hook in the user's
// Claude Code settings. Verification only flips an in-memory value.
const claudeSettingsFile=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'settings.json');
let claudeApprovals={installed:false,error:null};
function refreshClaudeApprovals(){if(!verify)claudeApprovals=claudeHook.status(claudeSettingsFile);}
async function setClaudeApprovals(enabled){
  if(typeof enabled!=='boolean')throw Error('Choose whether to answer Claude Code requests here.');
  if(verify)claudeApprovals={installed:enabled,error:null};
  else if(enabled){
    const node=await claudeHook.findNode();
    if(!node)throw Error('Node.js was not found. Install Node.js, then try again.');
    claudeApprovals=claudeHook.install(claudeSettingsFile,{node,script:path.join(__dirname,'scripts','claude-permission-hook.cjs')});
  } else claudeApprovals=claudeHook.uninstall(claudeSettingsFile);
  broadcast();return state();
}
const verifyBrowser=process.argv.includes('--verify-browser');
const verify=process.argv.includes('--verify-ui') || verifyBrowser;
if(verify) app.setPath('userData',path.join(os.tmpdir(),'edge-deck-verification'));
else app.setPath('userData',path.join(app.getPath('appData'),'Edge Deck'));
app.setName('Edge Deck');
let printerNames=new Map();
let win,config,media,printers,tasks,spotify,weather,cameras,thumbnails=null,bambuCloud=null,canvasClient=null,canvasState={trackUri:null,url:null},timer,spotifyTimer,weatherTimer,playerTimer,browserHost,dashboardWindow,windowsIntegration,busy=false,spotifyBusy=false,weatherBusy=false;
let lastWindowsRefresh=0;
let mediaState={connected:false,volume:null,error:'Connecting to Windows media…'};
let taskState={connected:false,items:[]};
let spotifyState={connected:false,clientIdConfigured:false,playlists:[]};
let weatherState={status:'unconfigured',location:null,units:'metric',current:null,hourly:[],daily:[],updatedAt:null,error:null};
let ffmpegAvailable=false;
app.requestSingleInstanceLock(verify?`edge-deck-verify-${process.pid}`:'edge-deck').then(first=>{if(!first)return process.exit(0);return app.whenReady().then(start);})
  .catch(e=>{console.error(e);approvals?.close();media?.close();printers?.close();app.exit(1);});
app.on('second-instance',()=>{dashboardWindow?.setFullscreen(true).then(()=>verify?null:dashboardWindow?.hideFromTaskbar()).then(()=>dashboardWindow?.activate()).catch(error=>console.error(error.message));});
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,()=>app.quit());
app.on('before-quit',()=>{tray?.close();approvals?.close();for(const watcher of taskWatchers)watcher.close();for(const wake of [...stateWaiters])wake();clearInterval(timer);clearInterval(spotifyTimer);clearTimeout(playerTimer);clearInterval(weatherTimer);media?.close();printers?.close();spotify?.close();weather?.close();cameras?.close();browserHost?.close();dashboardWindow?.close();});
function state() {
  const publicConfig=config.publicConfig();
  const printerStates=printers.getState().map(printer=>{
    const configured=publicConfig.printers.find(p=>p.id===printer.id)?.configured;
    const expectedCamera=printer.model==='P1S'?'local':'rtsps';
    const cameraReason=!configured?'Add the printer connection first.':['disabled','none'].includes(printer.camera?.protocol)?'Enable LAN Only Liveview on the printer first.':printer.camera?.protocol&&printer.camera.protocol!==expectedCamera?'This camera mode is not supported; use Bambu Studio.':printer.model==='H2D'&&!ffmpegAvailable?'FFmpeg is required for the H2D camera.':'';
    // The picture of the model being printed, fetched from the printer once per job.
    if(thumbnails)thumbnails.update(printer.id,configured?config.privatePrinters().find(p=>p.id===printer.id):null,printers.jobFor?.(printer.id)||null);
    // The name you gave the printer in Bambu Handy, when signed in to Bambu.
    const serial=config.privatePrinters().find(p=>p.id===printer.id)?.serial;
    return{...printer,accountName:(serial&&printerNames.get(serial))||null,thumbnail:thumbnails?.version(printer.id)||null,capabilities:{...printer.capabilities,camera:!cameraReason},capabilityReasons:{...printer.capabilityReasons,camera:cameraReason}};
  });
  // Verification stays deterministic: a game in front must not change the UI under test.
  const presence=verify?'normal':['fullscreen','away'].includes(mediaState.presence)?mediaState.presence:'normal';
  return {config:publicConfig,media:mediaState,spotify:spotifyState,weather:weatherState,tasks:taskState,printers:printerStates,bambuCloud:bambuCloud?.state()||{connected:false},update:updater?.state()||{state:'idle',current:packageInfo.version},spotifyCanvas:{...(canvasClient?.state()||{connected:false}),trackUri:canvasState.trackUri,url:canvasState.url},power:powerState(publicConfig.power?.mode,presence),approvals:approvals?approvals.list():[],system:{presence,claudeApprovals,hostname:os.hostname(),fullscreen:Boolean(dashboardWindow?.isFullScreen?.() || win?.isFullScreen()),windowsIntegration:windowsIntegration.getState()},updatedAt:new Date().toISOString()};
}
async function pollSpotify(){if(spotifyBusy)return;spotifyBusy=true;try{spotifyState={...await spotify.getState(),player:spotifyState.player??null};broadcast();}catch{spotifyState={...spotifyState,error:'Spotify connection is unavailable.'};}finally{spotifyBusy=false;}}
// Spotify's player state is polled faster while music plays so progress,
// track changes and changes made on other devices appear promptly.
let playerError=null;
async function pollPlayer(){
  clearTimeout(playerTimer);
  try{const player=await spotify.getPlayer();spotifyState={...spotifyState,player,playerError:null};playerError=null;broadcast();updateCanvas(player?.track?.uri);}
  catch(error){playerError=error.message;spotifyState={...spotifyState,playerError};}
  finally{const playing=spotifyState.player?.isPlaying;playerTimer=setTimeout(pollPlayer,playerError?15000:playing?2500:spotifyState.player?6000:10000);}
}
// The Canvas video of the playing song (when signed in for Canvas).
function updateCanvas(trackUri){
  if(!canvasClient?.state().connected){if(canvasState.trackUri){canvasState={trackUri:null,url:null};broadcast();}return;}
  if(!trackUri||canvasState.trackUri===trackUri)return;
  canvasState={trackUri,url:null,looking:true};
  canvasClient.forTrack(trackUri).then(url=>{if(canvasState.trackUri!==trackUri)return;canvasState={trackUri,url};broadcast();},()=>{});
}
// Update checks: asked for (tray or Customize) ones always report back.
async function checkForUpdate(asked){
  if(!updater)return null;
  const status=await updater.check();
  if(asked)tray?.send(status.state==='available'?`update ${status.latest}`:status.state==='current'?`notice Edge Deck ${packageInfo.version} is up to date.`:`notice Could not check for updates. ${status.error||''}`);
  return status;
}
async function installUpdate(){
  if(!updater)throw Error('Updates are not available here.');
  try{const result=await updater.install();tray?.send(`notice Installing Edge Deck ${result.version}. It restarts in a moment.`);return result;}
  catch(error){tray?.send(`failed ${error.message}`);throw error;}
}
async function spotifyPlayer(action,value){
  if(verify)throw Error('Spotify playback is disabled during verification.');
  const player=await spotify.playerCommand(action,value);
  spotifyState={...spotifyState,player,playerError:null};
  clearTimeout(playerTimer);playerTimer=setTimeout(pollPlayer,player?.isPlaying?2500:6000);
  return state();
}
async function spotifyBrowse(kind,value){
  if(verify)throw Error('Spotify browsing is disabled during verification.');
  if(kind==='devices')return spotify.devices();
  if(kind==='queue')return spotify.queue();
  if(kind==='playlist')return spotify.playlistTracks(value);
  if(kind==='album')return spotify.albumTracks(value);
  if(kind==='liked')return spotify.likedTracks();
  if(kind==='home')return spotify.home(value===true);
  if(kind==='search')return spotify.search(value);
  throw Error('Unknown Spotify view.');
}
async function pollWeather(){if(weatherBusy)return;weatherBusy=true;try{weatherState=await weather.getState();broadcast();}catch{weatherState={...weatherState,status:weatherState.updatedAt?'stale':'error',stale:Boolean(weatherState.updatedAt),error:'Weather is unavailable. Try again shortly.'};}finally{weatherBusy=false;}}
async function saveWeather(input){config.saveWeather(input);weatherState=await weather.getState();broadcast();return state();}
async function refreshWeather(){weatherState=await weather.refresh();broadcast();return state();}
let appIcons;
// Dock icons: only for saved apps; verification never reads real files or sites.
function iconSource(){
  return appIcons??=createAppIcons({getFileIcon:file=>fileIcon(file),
    readShortcutLink:file=>shell.readShortcutLink(file),cacheFile:path.join(app.getPath('userData'),'app-icons.json')});
}
async function appIcon(target,id){
  const launchers=validTarget(target)?config.publicConfig().launchers:[];
  const launcher=launchers.find(l=>l.id===id&&l.target===target)||launchers.find(l=>l.target===target);
  if(!launcher)throw Error('Save this app in Customize first.');
  if(verify)return null;
  return iconSource().icon(target,{name:launcher.name,override:launcher.icon||''});
}
// Icon picker: matching white icons for a typed name (from the Iconify API).
async function searchIcons(query){
  if(typeof query!=='string'||query.trim().length<2||query.length>60)return [];
  if(verify)return [];
  try{return await iconSource().search(query);}
  catch{throw Error('Icon search is unavailable. Check your internet connection and try again.');}
}
async function openPlaylist(input){const uri=normalizePlaylistUri(input);if(!uri || !config.publicConfig().music.savedPlaylists.some(item=>item.uri===uri))throw Error('Save this playlist before opening it.');if(verify)throw Error('Opening Spotify playlists is disabled during verification.');await shell.openExternal(uri);return{opened:true,message:'Opened playlist in Spotify. Start playback there.'};}
// Every change bumps a version; dashboard pages wait for the next version
// (long-poll) instead of polling, so updates appear as soon as they happen.
let stateVersion=0;const stateWaiters=new Set();
function broadcast() {
  stateVersion++;for(const wake of [...stateWaiters])wake();
  // Notifications look at the state once a burst of changes has settled.
  if(notifier&&!notifyTimer)notifyTimer=setTimeout(()=>{notifyTimer=null;try{notifier.update(state());}catch(error){console.error(error.message);}},800);
}
function waitForState(version){
  return new Promise(resolve=>{
    if(version!==stateVersion){resolve({version:stateVersion,state:state()});return;}
    const wake=()=>{clearTimeout(timeout);stateWaiters.delete(wake);resolve({version:stateVersion,state:state()});};
    const timeout=setTimeout(wake,20000);stateWaiters.add(wake);
  });
}
// Agent logs are watched, so a new tool call or answer shows within a moment
// rather than at the next poll. Bursts of writes collapse into one read.
let taskRead=null,taskReadAgain=false,taskReadTimer=null;const taskWatchers=[];
let taskSeq=0,taskApplied=0;
function readTasks(){
  const seq=++taskSeq;
  return tasks.getState().then(next=>{if(seq>taskApplied){taskApplied=seq;taskState=next;}},()=>{if(seq>taskApplied){taskApplied=seq;taskState={connected:false,items:[],error:'Task activity is unavailable.'};}})
    .then(()=>reconcileApprovals());
}
function refreshTasks(){
  if(taskRead){taskReadAgain=true;return;}
  taskRead=readTasks().then(()=>broadcast()).finally(()=>{taskRead=null;if(taskReadAgain){taskReadAgain=false;refreshTasks();}});
}
// When a chat's log shows the requested tool ran, or the person sent a new
// message or interrupted (an answer given in the Claude app), the request on
// the dashboard is out of date: drop it.
async function reconcileApprovals(){
  if(!approvals)return;
  for(const item of approvals.pending()){
    if(!item.transcript||!/\.jsonl$/i.test(item.transcript))continue;
    let rows;
    try{rows=(await readTail(item.transcript,262144)).split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);}catch{continue;}
    const at=row=>Date.parse(row.timestamp||'');
    let useId=null,matched=false;
    for(const row of rows){
      if(row.type!=='assistant'||!Array.isArray(row.message?.content))continue;
      for(const part of row.message.content)if(part?.type==='tool_use'&&part.name===item.tool){
        const exact=isDeepStrictEqual(part.input,item.toolInput);
        if(exact||!matched){useId=part.id;matched=exact;}
      }
    }
    const moved=rows.some(row=>row.type==='user'&&at(row)>=item.createdAt-1000&&(
      (Array.isArray(row.message?.content)&&row.message.content.some(part=>part?.type==='tool_result'&&useId&&part.tool_use_id===useId))||
      (!row.isMeta&&!row.isSidechain&&typeof row.message?.content==='string'&&row.message.content.trim()&&!/^<(?:command-|local-command|system-reminder)/.test(row.message.content))||
      (Array.isArray(row.message?.content)&&row.message.content.some(part=>part?.type==='text'&&/^\[Request interrupted by user/.test(part.text||'')))));
    if(moved)approvals.dismiss(item.id);
  }
}
function watchAgentLogs(){
  for(const directory of [path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'projects'),path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions')]){
    try{
      const watcher=fs.watch(directory,{recursive:true},(event,name)=>{
        if(name&&!String(name).endsWith('.jsonl'))return;
        if(event==='rename'||!name)tasks.invalidate();
        if(!taskReadTimer)taskReadTimer=setTimeout(()=>{taskReadTimer=null;refreshTasks();},150);
      });
      watcher.on('error',()=>{});taskWatchers.push(watcher);
    }catch{/* the 3 s poll still covers this folder */}
  }
}
async function poll() {
  if(busy)return;busy=true;
  try {
    const refreshWindows=Date.now()-lastWindowsRefresh>30000;
    if(refreshWindows){lastWindowsRefresh=Date.now();refreshClaudeApprovals();}
    const results=await Promise.allSettled([media.getState(),readTasks(),refreshWindows?windowsIntegration.refresh():Promise.resolve()]);
    mediaState=results[0].status==='fulfilled'?results[0].value:{connected:false,volume:null,error:'Windows media is unavailable.'};
    broadcast();
  } finally {busy=false;}
}
function displays() {return screen.getAllDisplays().map(d=>({id:d.id,label:d.label||`Display ${d.id}`,width:d.size.width,height:d.size.height,scaleFactor:d.scaleFactor,isEdge:/xeneon|edge/i.test(d.label)||Math.abs(d.size.width/d.size.height-2560/720)<0.08}));}
async function start() {
  if(verify) {
    // Browser verification never reads or writes the real Desktop/Startup folders.
    let fixture={supported:true,startupEnabled:false,startupShortcutPresent:false,startupStatus:'disabled',desktopShortcutPresent:false,message:''};
    windowsIntegration={getState:()=>({...fixture}),refresh:async()=>({...fixture}),
      async setStartup(enabled){if(typeof enabled!=='boolean')throw Error('Choose whether to start with Windows.');fixture={...fixture,startupEnabled:enabled,startupShortcutPresent:enabled,startupStatus:enabled?'enabled':'disabled'};return{...fixture};},
      async createDesktopShortcut(){fixture={...fixture,desktopShortcutPresent:true};return{...fixture};}};
  } else windowsIntegration=createWindowsIntegration({app,shell,root:__dirname});
  await windowsIntegration.refresh().catch(()=>{});lastWindowsRefresh=Date.now();
  config=createConfigStore(app.getPath('userData'),safeStorage);
  media=createMediaBridge();tasks=createTaskBridge();printers=createPrinterBridge();
  spotify=createSpotifyBridge({webApi:pathname=>canvasClient?.web(pathname)??null,getConfig:()=>config.spotifyConfig(),saveTokens:tokens=>config.saveSpotifyTokens(tokens),openExternal:url=>shell.openExternal(url)});
  weather=createWeatherBridge({getConfig:()=>config.publicConfig().weather,...(verify?{fetchImpl:require('./scripts/weather-fixture.cjs').fetchWeatherFixture}:{})});
  const weatherConfig=config.publicConfig().weather;
  weatherState={...weatherState,location:weatherConfig.location,configured:Boolean(weatherConfig.location),units:{system:weatherConfig.units,temperature:weatherConfig.units==='imperial'?'°F':'°C',windSpeed:weatherConfig.units==='imperial'?'mph':'km/h',precipitation:weatherConfig.units==='imperial'?'in':'mm'},status:weatherConfig.location?'loading':'unconfigured'};
  // Bambu cloud sign-in: only the access token is kept, encrypted like the other credentials.
  const cloudFile=path.join(app.getPath('userData'),'bambu-cloud.json');
  bambuCloud=createBambuCloud({storage:{
    read(){try{const saved=JSON.parse(fs.readFileSync(cloudFile,'utf8'));return saved?.encrypted?JSON.parse(safeStorage.decryptString(Buffer.from(saved.encrypted,'base64'))):null;}catch{return null;}},
    write(value){if(!value){try{fs.rmSync(cloudFile,{force:true});}catch{}return;}if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable.');
      fs.writeFileSync(cloudFile,JSON.stringify({encrypted:safeStorage.encryptString(JSON.stringify(value)).toString('base64')}));},
  }});
  const canvasFile=path.join(app.getPath('userData'),'spotify-canvas.json');
  canvasClient=createSpotifyCanvas({storage:{
    read(){try{const saved=JSON.parse(fs.readFileSync(canvasFile,'utf8'));return saved?.encrypted?safeStorage.decryptString(Buffer.from(saved.encrypted,'base64')):null;}catch{return null;}},
    write(value){if(!value){try{fs.rmSync(canvasFile,{force:true});}catch{}return;}if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable.');
      fs.writeFileSync(canvasFile,JSON.stringify({encrypted:safeStorage.encryptString(value).toString('base64')}));},
  }});
  // Printer names from the Bambu account, refreshed every ten minutes.
  const refreshNames=()=>bambuCloud?.state().connected?bambuCloud.printerNames().then(found=>{const changed=JSON.stringify([...found])!==JSON.stringify([...printerNames]);printerNames=found;if(changed)broadcast();},()=>{}):null;
  if(!verify){refreshNames();setInterval(refreshNames,600000).unref?.();}
  if(!verify)thumbnails=createThumbnailStore({onChange:()=>broadcast(),lookup:require('./lib/printers.cjs').lanLookup,fetch:(printer,job,options)=>findPicture(printer,job,{...options,cloud:bambuCloud})});
  cameras=createCameraBridge({getPrinterConfig:id=>config.privatePrinters().find(p=>p.id===id),getPrinterState:id=>printers.getState().find(p=>p.id===id)});
  ffmpegAvailable=Boolean(await findFfmpeg());
  if(!verify)printers.configure(config.privatePrinters());
  else printers.configure(config.publicConfig().printers);
  return startBrowser();
}
async function startBrowser() {
  const {createBrowserHost}=require('./lib/browser-host.cjs');
  const {createDashboardWindow}=require('./lib/browser-window.cjs');
  const operations={
    'state:get':()=>state(),
    'state:wait':version=>waitForState(Number.isInteger(version)?version:-1),
    // Allow or Deny a Claude Code permission request shown on the dashboard.
    'claude:approvals':setClaudeApprovals,
    'agent:decide':(id,decision)=>{if(!approvals)throw Error('Agent approvals are not running.');approvals.decide(id,decision);broadcast();return state();},
    'config:save':input=>{config.save(input);return state();},
    'printer:save':input=>{config.savePrinter(input);printers.configure(config.privatePrinters());return state();},
    'media:command':async(action,value)=>{if(verify)throw Error('Physical media controls are disabled during verification.');mediaState=await media.command(action,value);return mediaState;},
    'spotify:save':async input=>{const previous=config.publicConfig().spotify.clientId;config.saveSpotify(input);if(config.publicConfig().spotify.clientId!==previous)await spotify.disconnect();spotifyState=await spotify.getState();return state();},
    'spotify:player':spotifyPlayer,
    'spotify:browse':spotifyBrowse,
    'spotify:action':async(action,value)=>{
      if(verify && ['connect','play'].includes(action))throw Error('Spotify sign-in and playback are disabled during verification.');
      const player=spotifyState.player??null;
      if(action==='connect')spotifyState={...await spotify.authenticate(),player};
      else if(action==='refresh'){spotifyState={...await spotify.getState({refresh:true}),player};void pollPlayer();}
      else if(action==='disconnect')spotifyState={...await spotify.disconnect(),player:null};
      else if(action==='play')return spotify.playPlaylist(value);
      else throw Error('Unknown Spotify action.');
      return spotifyState;
    },
    'printer:command':async(id,action,params)=>{if(verify)throw Error('Printer actions are disabled during verification.');return printers.command(id,action,params);},
    'printer:thumbnail':async id=>thumbnails?.get(String(id))||null,
    'bambu:signin':async input=>{if(verify)throw Error('Cloud sign-in is disabled during verification.');const result=await bambuCloud.signIn(input||{});if(result.status==='signed-in')thumbnails?.reset();broadcast();return {...result,state:state()};},
    'bambu:verify':async input=>{if(verify)throw Error('Cloud sign-in is disabled during verification.');const result=await bambuCloud.verify(input||{});thumbnails?.reset();bambuCloud.printerNames().then(found=>{printerNames=found;broadcast();},()=>{});broadcast();return {...result,state:state()};},
    'canvas:save':async value=>{if(verify)throw Error('Canvas sign-in is disabled during verification.');canvasClient.save(value);canvasState={trackUri:null,url:null};spotify.getState({refresh:true}).then(next=>{spotifyState={...next,player:spotifyState.player??null};broadcast();},()=>{});updateCanvas(spotifyState.player?.track?.uri);broadcast();return state();},
    'canvas:remove':async()=>{canvasClient?.remove();canvasState={trackUri:null,url:null};broadcast();return state();},
    'update:check':async()=>{if(verify)throw Error('Update checks are disabled during verification.');await checkForUpdate(false);return state();},
    'update:install':async()=>{if(verify)throw Error('Updates are disabled during verification.');await installUpdate();return state();},
    'update:notes':async()=>{const page=updater?.state().page;if(!page||!page.startsWith(`https://github.com/${repoFrom(packageInfo)}/`))throw Error('No release notes to open.');await shell.openExternal(page);return {opened:true};},
    'bambu:signout':async()=>{bambuCloud?.signOut();thumbnails?.reset();broadcast();return {state:state()};},
    'printer:camera':async id=>{if(verify)throw Error('Physical camera connections are disabled during verification.');return cameras.getFrame(id);},
    'displays:get':()=>displays(),
    'system:startup':async enabled=>{await windowsIntegration.setStartup(enabled);return state();},
    'system:desktop-shortcut':async()=>{await windowsIntegration.createDesktopShortcut();return{created:true,windowsIntegration:windowsIntegration.getState()};},
    'weather:search':query=>weather.searchLocations(query),
    'weather:save':saveWeather,
    'weather:refresh':refreshWeather,
    'music:save-playlist':input=>{config.savePlaylist(input);return state();},
    'music:remove-playlist':id=>{config.removePlaylist(id);return state();},
    'music:open-playlist':openPlaylist,
    'window:display':async id=>{const d=screen.getAllDisplays().find(d=>String(d.id)===String(id));if(!d)throw Error('Display is no longer connected.');return dashboardWindow.move({...d,nativeBounds:screen.dipToScreenRect(null,d.bounds)});},
    'window:fullscreen':()=>dashboardWindow.fullscreen().then(result=>{if(!verify)dashboardWindow.hideFromTaskbar().catch(()=>{});return result;}),
    'app:icon':appIcon,
    'icons:search':searchIcons,
    'app:choose':async()=>{const result=await chooseFile('Choose an app or shortcut');if(result.canceled)return null;const file=result.filePaths[0];return{path:file,name:path.basename(file,path.extname(file))};},
    'app:open':async target=>{if(!validTarget(target)||!config.publicConfig().launchers.some(l=>l.target===target))throw Error('Save this app in Customize before opening it.');if(target==='spotify:'||target.startsWith('https:'))await shell.openExternal(target);else{const error=await shell.openPath(target);if(error)throw Error(error);}return true;}
  };
  browserHost=await createBrowserHost({root:__dirname,handle:(operation,args)=>operations[operation](...args)});
  await poll();timer=setInterval(poll,3000);
  if(!verify)watchAgentLogs();
  refreshClaudeApprovals();
  approvals=createApprovalBroker({directory:app.getPath('userData'),onChange:()=>broadcast()});
  await approvals.start().catch(error=>{console.error('Agent approvals unavailable:',error.message);approvals=null;});
  const display=screen.getAllDisplays().find(d=>/xeneon/i.test(d.label)||Math.abs(d.size.width/d.size.height-2560/720)<0.08)||screen.getPrimaryDisplay();
  const profile=path.join(app.getPath('userData'),verifyBrowser?`BrowserProfile-test-${Date.now()}`:'BrowserProfile');
  dashboardWindow=createDashboardWindow({url:browserHost.url,profile,display:{...display,nativeBounds:screen.dipToScreenRect(null,display.bounds)},inspect:verifyBrowser||process.argv.includes('--inspect-dashboard'),onClose:()=>app.quit()});
  await dashboardWindow.ready();
  // The icon in the taskbar's notification area: show, leave full screen, quit.
  if(!verify){
    // Edge Deck lives in the tray: no taskbar button for the dashboard window.
    const tuck=()=>dashboardWindow?.hideFromTaskbar().catch(error=>console.error(error.message));
    tuck();
    tray=createTray({onAction:word=>{
      if(word==='quit')return app.quit();
      if(word==='check')return checkForUpdate(true);
      if(word==='update')return installUpdate();
      dashboardWindow?.setFullscreen(word==='show').then(tuck).then(()=>word==='show'&&dashboardWindow?.activate()).catch(error=>console.error(error.message));
    }});
    const toastLine=createToastLines({directory:app.getPath('userData'),picture:id=>thumbnails?.picture(id)||null});
    notifier=createNotifier({send:note=>tray?.send(toastLine(note)),settings:()=>config.publicConfig().notifications});
    // Updates from GitHub releases: a minute after start, then every six hours.
    updater=createUpdater({root:__dirname,version:packageInfo.version,repo:repoFrom(packageInfo),onChange:status=>{
      if(status.state==='available')tray?.send(`update ${status.latest}`);else if(status.state==='current')tray?.send('current');
      broadcast();
    }});
    setTimeout(()=>checkForUpdate(false),60000).unref?.();
    setInterval(()=>checkForUpdate(false),6*3600000).unref?.();
  }
  void pollSpotify();spotifyTimer=setInterval(pollSpotify,5000);
  if(!verify)void pollPlayer();
  void pollWeather();weatherTimer=setInterval(pollWeather,60000);
  if(verifyBrowser){
    try {await require('./scripts/verify-browser.cjs').verifyBrowser({profile,dashboardWindow});console.log('Browser verification passed.');process.exitCode=0;}
    catch(error){console.error(error);process.exitCode=1;}
    finally{clearInterval(timer);clearInterval(spotifyTimer);clearInterval(weatherTimer);media.close();printers.close();spotify.close();weather.close();cameras?.close();browserHost.close();dashboardWindow.close();app.exit(process.exitCode||0);}
  }
}
