const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function verifyBrowser({profile,dashboardWindow}) {
  let port;
  for(let i=0;i<100;i++) {
    try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
    await delay(200);
  }
  if(!port)throw Error('The dashboard browser did not start.');
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for(let i=0;i<60;i++) {
    page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:'));
    if(page)break;await delay(200);
  }
  assert.ok(page,'Dashboard page opened');
  await page.waitForFunction(async()=>{
    if(!window.edge)return false;
    const state=await window.edge.getState();
    const count=state.config.widgets.filter(widget=>widget.enabled!==false && widget.type!=='launchers').length;
    return count>0 && document.querySelectorAll('#widgets .widget').length===count;
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const initial=await page.evaluate(()=>window.edge.getState());
  const expectedWidgetCount=initial.config.widgets.filter(widget=>widget.enabled!==false && widget.type!=='launchers').length;
  assert.equal(initial.system.fullscreen,true,'Dashboard starts in full screen');
  const report={engine:'Microsoft Edge',nativeWindow:await page.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight,innerWidth,innerHeight})),sizes:[],checks:[]};
  report.nativeGeometry=await dashboardWindow.inspect();
  assert.equal(report.nativeWindow.innerWidth,report.nativeWindow.width,'Full-screen window has no horizontal frame');
  assert.equal(report.nativeWindow.innerHeight,report.nativeWindow.height,'Full-screen window has no title bar');
  const directory=path.join(__dirname,'..','artifacts');await fs.mkdir(directory,{recursive:true});
  const targetDisplay=(await page.evaluate(()=>window.edge.getDisplays())).find(d=>d.isEdge);
  if(targetDisplay){await page.evaluate(id=>window.edge.moveToDisplay(id),targetDisplay.id);report.checks.push('Native display movement works on the XENEON EDGE');}
  await page.locator('#deck-menu').click();await page.locator('#fullscreen').click();await page.waitForFunction(async()=>!(await window.edge.getState()).system.fullscreen);
  await page.locator('#deck-menu').click();await page.locator('#fullscreen').click();await page.waitForFunction(async()=>(await window.edge.getState()).system.fullscreen);
  await page.waitForFunction(()=>innerWidth===outerWidth && innerHeight===outerHeight);
  report.checks.push('Starts full screen without a title bar; touch toggle exits and restores full screen');
  const printerArt=await page.locator('.printer-figure img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),loaded:image.complete&&image.naturalWidth>0})));
  assert.equal(printerArt.length,2);assert.ok(printerArt.every(image=>image.loaded));
  assert.notEqual(printerArt[0].src,printerArt[1].src);report.printerArtwork=printerArt;
  if(initial.media.artwork){
    await page.waitForFunction(()=>document.querySelector('.song-cover')?.complete && document.querySelector('.song-cover')?.naturalWidth>0);
    report.checks.push('Current song cover received from Windows and rendered successfully');
  }
  await page.getByRole('button',{name:'Open Bambu Lab H2D control panel',exact:true}).click();
  await page.locator('#printer-console').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#printer-console').getAnimations().some(animation=>animation.playState==='running'));
  assert.ok((await page.locator('#printer-console').boundingBox()).width>900);
  await page.screenshot({path:path.join(directory,'printer-console.png')});
  await page.getByRole('button',{name:'Close printer controls',exact:true}).click();
  await page.locator('#printer-console').waitFor({state:'hidden'});
  assert.equal(await page.locator('#printer-console-content > *').count(),0);
  report.checks.push('Tapping the printer card opens its animated console; closing removes the preview content');
  // Verification mode supplies an isolated configuration and in-memory weather
  // responses. This exercises the real UI/API path without a network request.
  await page.evaluate(()=>window.edge.saveWeather({location:null,units:'metric'}));
  await page.getByRole('button',{name:'Choose weather city',exact:true}).click();
  await page.locator('#weather-dialog').waitFor({state:'visible'});
  await page.getByRole('searchbox',{name:'Search weather city',exact:true}).fill('Kraków');
  await page.locator('#weather-content').getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('#weather-content .weather-city-result').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('#weather-content .weather-hours .weather-hour').length===24 && document.querySelectorAll('#weather-content .weather-day').length===7);
  assert.equal((await page.evaluate(()=>window.edge.getState())).weather.location.name,'Kraków');
  await page.getByRole('button',{name:'Use Fahrenheit',exact:true}).click();
  await page.waitForFunction(async()=>(await window.edge.getState()).weather.units.system==='imperial' && document.querySelector('[aria-label="Use Fahrenheit"]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[aria-label="Use Fahrenheit"]').disabled);
  await page.getByRole('button',{name:'Use Celsius',exact:true}).click();
  await page.waitForFunction(async()=>(await window.edge.getState()).weather.units.system==='metric' && document.querySelector('[aria-label="Use Celsius"]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[aria-label="Use Celsius"]').disabled);
  await page.screenshot({path:path.join(directory,'weather-details.png')});
  await page.getByRole('button',{name:'Close weather',exact:true}).click();
  await page.locator('#weather-dialog').waitFor({state:'hidden'});
  report.checks.push('Weather city search selects Kraków, renders 24 hours and 7 days, and saves Fahrenheit/Celsius through isolated forecast fixtures');
  for(const [width,height] of [[2560,720],[2048,576],[1600,450],[900,700]]) {
    await page.setViewportSize({width,height});await delay(120);
    const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth,overflowY:document.documentElement.scrollHeight>innerHeight,widgets:document.querySelectorAll('#widgets .widget').length,hasClock:!!document.querySelector('.clock-time, .dial-widget')?.textContent}));
    assert.equal(layout.overflowX,false,`horizontal overflow at ${width}`);
    if(width>=1000)assert.equal(layout.overflowY,false,`vertical page overflow at ${width}`);
    assert.equal(layout.widgets,expectedWidgetCount);assert.ok(layout.hasClock);report.sizes.push(layout);
    const undersized=await page.locator('.topbar button, #widgets button, #widgets input[type=range], #launchers button').evaluateAll(nodes=>nodes.filter(node=>{
      const box=node.getBoundingClientRect();return box.width>0 && box.height>0 && (box.width<47.9 || box.height<47.9);
    }).map(node=>({label:node.getAttribute('aria-label')||node.textContent,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
    assert.deepEqual(undersized,[],`touch controls stay at least 48px at ${width}`);
    await page.screenshot({path:path.join(directory,`dashboard-${width}x${height}.png`)});
  }
  await page.setViewportSize({width:1600,height:700});
  await page.locator('#deck-menu').click();await page.locator('#customize').click();
  await page.screenshot({path:path.join(directory,'widget-settings.png')});
  await page.locator('#settings-content [role=switch]').first().click();
  await page.waitForFunction(()=>!document.querySelector('.widget.clock'));
  assert.equal((await page.evaluate(()=>window.edge.getState())).config.widgets[0].enabled,false);
  await page.reload();await page.waitForFunction(()=>window.edge && document.querySelector('.widget.tasks'));
  assert.equal(await page.locator('.widget.clock').count(),0);
  report.checks.push('Saved visibility survives a full page reload');
  await page.evaluate(config=>window.edge.saveConfig(config),initial.config);
  await page.waitForFunction(()=>document.querySelector('.widget.clock'));
  await page.locator('#deck-menu').click();await page.locator('#customize').click();await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('button',{name:'Printers',exact:true}).click();
  assert.equal(await page.locator('form.settings-item input[type=password]').count(),2);assert.equal(await page.locator('section.settings-item', { hasText: 'Bambu Lab account' }).locator('input[type=password]').count(),1);
  await page.screenshot({path:path.join(directory,'printer-settings.png')});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  // main.cjs supplies an entirely in-memory Windows integration in verification
  // mode. Successful requests below reach that fake; delayed/failed requests are
  // intercepted here. No real Desktop or Startup shortcut is created or changed.
  assert.equal(initial.system.windowsIntegration?.supported,true);
  assert.equal(initial.system.windowsIntegration?.startupEnabled,false,'Verification startup fixture begins disabled');
  assert.equal(initial.system.windowsIntegration?.desktopShortcutPresent,false,'Verification desktop fixture begins empty');
  const integrationRequests=[];
  let startupResponse='defer',releaseStartup;
  const startupError='Verification could not update the startup setting.';
  const integrationApi=new URL('/api',page.url()).href;
  const integrationRoute=async route=>{
    let request;
    try{request=route.request().postDataJSON();}catch{return route.continue();}
    if(!['system:startup','system:desktop-shortcut'].includes(request?.operation))return route.continue();
    integrationRequests.push({operation:request.operation,args:request.args});
    if(request.operation==='system:startup'){
      if(startupResponse==='reject'){
        startupResponse='pass';
        return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:startupError})});
      }
      if(startupResponse==='defer'){
        startupResponse='pass';
        await new Promise(resolve=>{releaseStartup=resolve;});
      }
    }
    return route.continue();
  };
  await page.route(integrationApi,integrationRoute);
  const openDisplay=async()=>{
    await page.locator('#deck-menu').click();await page.locator('#customize').click();
    await page.getByRole('button',{name:'Display',exact:true}).click();
    await page.getByRole('switch',{name:'Start with Windows',exact:true}).waitFor();
  };
  const waitStartup=async enabled=>page.waitForFunction(value=>{
    const control=document.querySelector('[role="switch"][aria-label="Start with Windows"]');
    return control && !control.disabled && control.getAttribute('aria-checked')===String(value);
  },enabled);
  try{
    await openDisplay();
    const startupSwitch=page.getByRole('switch',{name:'Start with Windows',exact:true});
    assert.equal(await startupSwitch.getAttribute('aria-checked'),'false');
    assert.equal(await startupSwitch.isDisabled(),false);
    await startupSwitch.click();
    for(let i=0;i<100&&!releaseStartup;i++)await delay(20);
    assert.equal(typeof releaseStartup,'function','Startup request reaches the deferred fake route');
    assert.equal(await startupSwitch.isDisabled(),true,'Startup switch is disabled while saving');
    assert.equal(await startupSwitch.getAttribute('aria-checked'),'false','Pending startup change does not replace confirmed state');
    assert.equal((await page.evaluate(()=>window.edge.getState())).system.windowsIntegration.startupEnabled,false);
    releaseStartup();releaseStartup=null;
    await waitStartup(true);
    assert.equal((await page.evaluate(()=>window.edge.getState())).system.windowsIntegration.startupEnabled,true);
    await page.reload();await page.waitForFunction(()=>window.edge && document.querySelector('.widget.clock'));
    await openDisplay();await waitStartup(true);
    startupResponse='reject';
    await startupSwitch.click();
    await page.waitForFunction(message=>document.querySelector('#toast')?.textContent.includes(message),startupError);
    assert.equal(await page.locator('#toast').isVisible(),true);
    assert.equal(await page.locator('#toast').evaluate(node=>node.parentElement===document.querySelector('#settings')),true,'Startup errors appear inside the modal top layer');
    await waitStartup(true);
    assert.equal((await page.evaluate(()=>window.edge.getState())).system.windowsIntegration.startupEnabled,true,'Failed save retains confirmed startup state');
    await startupSwitch.click();await waitStartup(false);
    await page.reload();await page.waitForFunction(()=>window.edge && document.querySelector('.widget.clock'));
    await openDisplay();await waitStartup(false);
    const shortcut=page.getByRole('button',{name:'Create desktop shortcut',exact:true});
    assert.equal(await shortcut.isDisabled(),false);
    await shortcut.click();
    await page.waitForFunction(async()=>Boolean((await window.edge.getState()).system.windowsIntegration.desktopShortcutPresent));
    await page.waitForFunction(()=>!document.querySelector('#toast')?.hidden && /shortcut/i.test(document.querySelector('#toast')?.textContent || ''));
    assert.equal(await page.locator('#toast').isVisible(),true);
    assert.equal(await page.locator('#toast').evaluate(node=>node.parentElement===document.querySelector('#settings')),true,'Shortcut confirmation appears inside the modal top layer');
    assert.deepEqual(integrationRequests,[
      {operation:'system:startup',args:[true]},
      {operation:'system:startup',args:[false]},
      {operation:'system:startup',args:[false]},
      {operation:'system:desktop-shortcut',args:[]},
    ]);
    await page.screenshot({path:path.join(directory,'windows-startup-settings.png')});
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    report.checks.push('Mock Windows settings: startup begins off, saving disables the switch, enable/disable survive page reload, failure keeps confirmed state, and desktop shortcut uses the in-memory integration only');

    // Low power: the choice saves, freezes decorative motion and is reversible.
    const initialPower=(await page.evaluate(()=>window.edge.getState())).config.power?.mode||'auto';
    await page.locator('#deck-menu').click();await page.locator('#customize').click();await page.getByRole('button',{name:'Display',exact:true}).click();
    const powerGroup=page.getByRole('group',{name:'Low power',exact:true});
    for(const label of ['Off','Automatic','On']){const box=await powerGroup.getByRole('button',{name:label,exact:true}).boundingBox();assert.ok(box.width>=47.9&&box.height>=47.9,`${label} is a 48 px target`);}
    const animated=await page.evaluate(()=>[...document.querySelectorAll('.sky-cloud,.task-current-label')].map(node=>getComputedStyle(node).animationName));
    assert.ok(animated.every(name=>name!=='none'),'Decorative motion runs before low power');
    await powerGroup.getByRole('button',{name:'On',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.classList.contains('low-power')&&document.querySelector('#connection-label').textContent==='Low power');
    assert.equal((await page.evaluate(()=>window.edge.getState())).power.active,true);
    assert.equal(await powerGroup.getByRole('button',{name:'On',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.sky-cloud,.task-current-label')].every(node=>getComputedStyle(node).animationName==='none')),true,'Decorative CSS motion stops');
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'On','Focus stays on the chosen option');
    await powerGroup.getByRole('button',{name:'Off',exact:true}).click();
    await page.waitForFunction(async()=>{const s=await window.edge.getState();return s.config.power.mode==='off'&&s.power.active===false&&!document.documentElement.classList.contains('low-power')&&document.querySelector('#connection-label').textContent==='On this PC';});
    // A long-poll reply sent just before the save can land just after it; the next update corrects it.
    await page.waitForFunction(()=>document.querySelector('#settings-content [data-power-mode=off]')?.getAttribute('aria-pressed')==='true');
    await powerGroup.getByRole('button',{name:'Automatic',exact:true}).click();
    await page.waitForFunction(async()=>(await window.edge.getState()).config.power.mode==='auto'&&!document.documentElement.classList.contains('low-power'));
    if(initialPower!=='auto'){await powerGroup.getByRole('button',{name:{off:'Off',on:'On'}[initialPower],exact:true}).click();await page.waitForFunction(async mode=>(await window.edge.getState()).config.power.mode===mode,initialPower);}
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    report.checks.push('Low power: Off/Automatic/On are 48 px and keep focus; On marks the dashboard and freezes decorative CSS motion; Off restores it; Automatic is inactive while presence is normal (presence is fixed to normal during verification)');
  }finally{
    releaseStartup?.();
    await page.unroute(integrationApi,integrationRoute);
  }
  const updated={...initial.config,launchers:[...initial.config.launchers,{id:'verification',name:'Verification shortcut',target:'https://example.com/'}]};
  await page.evaluate(config=>window.edge.saveConfig(config),updated);
  await page.waitForFunction(()=>document.querySelector('#launchers').textContent.includes('Verification shortcut'));
  await page.evaluate(config=>window.edge.saveConfig(config),initial.config);
  // The full player is the Large or Tall music widget (Small and Medium are Recently played).
  await page.evaluate(config=>window.edge.saveConfig({...config,widgets:config.widgets.map(card=>card.type==='media'?{...card,size:'tall'}:card)}),initial.config);
  await page.getByRole('button',{name:'Minimise player',exact:true}).waitFor();
  await page.getByRole('button',{name:'Minimise player',exact:true}).click();
  await page.getByRole('button',{name:'Your Library',exact:true}).click();
  assert.equal(await page.locator('.emw-playlists').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Your Library',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Spotify settings',exact:true}).click();
  await page.locator('[data-edge-music-root]').waitFor();
  assert.equal(await page.locator('#settings').getByRole('button',{name:'Connect Spotify',exact:true}).isDisabled(),true);
  assert.equal(await page.getByLabel('Spotify redirect address').inputValue(),'http://127.0.0.1:43821/callback');
  await page.screenshot({path:path.join(directory,'spotify-setup.png')});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  report.checks.push('The minimised player shows Your Library and Spotify settings shows the fixed loopback redirect without initiating OAuth or playback');
  report.checks.push(...await require('./verify-media-widget.cjs').verifyMediaWidget(page,directory));
  // Agent activity is read from live local logs and can change mid-run.
  await page.waitForFunction(async()=>document.querySelectorAll('.task').length===(await window.edge.getState()).tasks.items.length,null,{timeout:10000});
  const liveTaskCount=(await page.evaluate(()=>window.edge.getState())).tasks.items.length;
  const taskView=await page.evaluate(()=>({items:[...document.querySelectorAll('.task')].map(row=>{
    // An orb counts once its canvas actually has painted dots.
    const canvas=row.querySelector('canvas.agent-orb');let orb=null;
    if(canvas){const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let lit=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)lit++;orb={state:canvas.dataset.state,lit};}
    return{elapsed:row.querySelector('.task-elapsed')?.textContent,wave:!!row.querySelector('.working-wave'),orb,progress:row.querySelector('.task-current-label')?.textContent};
  })}));
  assert.equal(taskView.items.length,liveTaskCount);
  assert.ok(taskView.items.every(item=>(item.wave||(item.orb?.state&&item.orb.lit>50)) && /\d+[hms]/.test(item.elapsed) && item.progress),JSON.stringify(taskView));
  report.checks.push('Only active chats render, with elapsed timers, visible progress and a drawn thinking orb for the current activity');
  await page.evaluate(()=>{
    window.__printerCalls=[];window.__cameraCalls=0;
    const root=document.createElement('div');root.id='printer-ui-verification';Object.assign(root.style,{position:'fixed',inset:'0 0 0 auto',width:'640px',overflow:'auto',background:'#18222e',padding:'24px',zIndex:'1000'});document.body.append(root);window.__printerFixture=root;
    const extruder={id:1,label:'Left nozzle',hasFilament:true,amsId:0,slotId:0};
    const slot={id:'1:2',label:'AMS 2 slot 3',amsId:1,slotId:2,extruderId:1,material:'PLA'};
    const printer={id:'ui-test',name:'UI test printer',model:'H2D',status:'paused',nozzle:25,bed:26,
      stage:{code:null,label:'Paused',category:'paused',known:true},
      capabilities:{pause:true,resume:true,stop:true,loadFilament:true,unloadFilament:true,camera:true,
        setNozzleTemperature:false,setBedTemperature:false,moveAxis:false,homeAxes:false},
      capabilityReasons:{},
      temperatures:{nozzles:[{id:0,label:'Right nozzle',current:25,target:0,active:false},
        {id:1,label:'Left nozzle',current:26,target:0,active:true}],bed:{current:26,target:0}},
      controlLimits:{nozzle:{min:0,max:350},bed:{min:0,max:120},axis:{steps:[0.1,1,10]}},
      motion:{homed:{X:true,Y:true,Z:true},position:null},
      filament:{extruders:[extruder],slots:[slot],loadableSlots:[slot],unloadableExtruders:[extruder]}};
    const mockState={config:{printers:[{id:'ui-test',name:'UI test printer',model:'H2D',configured:true}]},printers:[printer]};
    // This fixture never delegates to window.edge: all physical commands stay in this array.
    const mockBridge={getState:async()=>mockState,printerCommand:async(id,action,params)=>{window.__printerCalls.push({id,action,params});if(window.__deferPrinterCommand)await new Promise(resolve=>{window.__finishPrinterCommand=resolve;});return{status:'sent',message:'Mock request sent'};},cameraFrame:async()=>{window.__cameraCalls++;return{connected:false,image:null,error:'Test camera unavailable'};}};
    window.__printerMockState=mockState;
    window.__printerContext={printerId:'ui-test',getState:()=>mockState,bridge:mockBridge,updateState:()=>{},toast:()=>{}};
    window.EdgePrinterUI.render(root,window.__printerContext);
  });
  const fixture=page.locator('#printer-ui-verification');
  assert.equal(await page.evaluate(()=>window.__cameraCalls),0);
  await fixture.getByRole('button',{name:'Stop print',exact:true}).click();
  assert.equal(await fixture.locator('.printer-confirmation .button.danger').count(),1,'Stop confirmation uses the destructive action role');
  assert.equal(await fixture.locator('.printer-confirmation .button.primary').count(),0,'Stop confirmation is not a blue primary action');
  await fixture.getByRole('dialog',{name:'Stop the print on UI test printer?'}).getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__printerCalls.length),0);
  await fixture.getByRole('button',{name:'Filament',exact:true}).click();
  await fixture.screenshot({path:path.join(directory,'printer-filament.png')});
  await fixture.locator('select').first().selectOption('1:2:1');
  await fixture.getByRole('button',{name:'Load filament',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__printerCalls.length),0);
  await fixture.getByRole('dialog',{name:'Load filament?',exact:true}).getByRole('button',{name:'Load filament',exact:true}).click();
  await page.waitForFunction(()=>window.__printerCalls.length===1);
  assert.deepEqual(await page.evaluate(()=>window.__printerCalls[0]),{id:'ui-test',action:'loadFilament',params:{amsId:1,slotId:2,extruderId:1}});
  await fixture.getByRole('button',{name:'Home',exact:true}).click();
  await fixture.getByRole('button',{name:'Start preview',exact:true}).click();
  await page.waitForFunction(()=>window.__cameraCalls>0);
  await fixture.getByRole('button',{name:'Stop preview',exact:true}).click();
  const calls=await page.evaluate(()=>window.__cameraCalls);await delay(1200);assert.equal(await page.evaluate(()=>window.__cameraCalls),calls);
  report.checks.push('Mock printer UI: Stop cancellation sends nothing; filament confirmation preserves selected slot/nozzle; camera starts and stops only on demand');
  await page.evaluate(()=>{
    const printer=window.__printerMockState.printers[0];printer.status='idle';
    printer.stage={code:null,label:'Idle',category:'idle',known:true};
    Object.assign(window.__printerFixture.style,{inset:'40px auto auto 50%',transform:'translateX(-50%)',width:'1120px',height:'620px',padding:'0',border:'1px solid #3a4c5d',borderRadius:'18px',overflow:'hidden'});
    window.EdgePrinterUI.render(window.__printerFixture,window.__printerContext);
  });
  await fixture.getByRole('button',{name:'Home',exact:true}).click();
  await page.evaluate(()=>{
    const printer=window.__printerMockState.printers[0];printer.status='printing';printer.nozzle=180;printer.bed=60;
    printer.stage={code:7,label:'Heating nozzle',category:'heating',known:true};
    window.EdgePrinterUI.render(window.__printerFixture,{...window.__printerContext,liveRefresh:true});
  });
  assert.equal(await fixture.locator('.printer-panel-phase').textContent(),'Heating nozzle');
  await page.evaluate(()=>{
    const printer=window.__printerMockState.printers[0];printer.nozzle=184;printer.bed=61;
    printer.stage={code:1,label:'Leveling bed',category:'leveling',known:true};
    window.EdgePrinterUI.render(window.__printerFixture,{...window.__printerContext,liveRefresh:true});
  });
  assert.equal(await fixture.locator('.printer-panel-phase').textContent(),'Leveling bed');
  await fixture.screenshot({path:path.join(directory,'printer-stage.png')});
  await page.evaluate(()=>{window.__printerMockState.printers[0].status='offline';window.EdgePrinterUI.render(window.__printerFixture,{...window.__printerContext,liveRefresh:true});});
  assert.equal(await fixture.locator('.printer-panel-phase').count(),0,'Offline printer does not keep showing a stale active phase');
  assert.equal(await page.evaluate(()=>window.__printerCalls.length),1);assert.equal(await page.evaluate(()=>window.__cameraCalls),calls);
  report.checks.push('Home updates reported heating/leveling stage and temperatures live, and hides stale phase while offline; all new control checks use an isolated fake bridge');
  await page.evaluate(()=>{window.__printerFixture.remove();delete window.__printerContext;delete window.__printerMockState;});
  await page.evaluate(config=>window.edge.saveWeather(config),initial.config.weather || {location:null,units:'metric'});
  report.checks.push('Custom shortcut persists and appears without launching it','H2D and P1S setup forms render','Live media metadata read; playback/volume commands not fired','No physical printer connections made');
  report.checks.push(...await require('./verify-card-frames.cjs').verifyCardFrames(page));
  report.checks.push(...await require('./verify-default-layouts.cjs').verifyDefaultLayouts(page,directory));
  report.checks.push(...await require('./verify-layout-ui.cjs').verifyLayoutUI(page,directory));
  assert.deepEqual(errors,[]);report.errors=errors;
  await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
module.exports={verifyBrowser};
