'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const preview = !window.edge;
const widgetCatalog = { today: ['Time & weather', 'Clock, date and live weather in one card'], clock: ['Clock & date', 'Your local time and date'], weather: ['Weather', 'Current conditions and forecasts for your city'], tasks: ['Agent chats', 'Working Codex and Claude Code chats'], printers: ['3D printers', 'Bambu Lab H2D and P1S'], media: ['Music', 'Now playing and Spotify playlists'], actions: ['Quick actions', 'Audio output, microphone and mute'], launchers: ['App shortcuts', 'Your apps along the bottom'] };
const defaultConfig = {
  clock24: true, theme: 'dark', layout: {mode:'overview'},
  weather: { location: null, units: 'metric' }, music: { savedPlaylists: [] },
  widgets: Object.keys(widgetCatalog).map(type => ({ id: type, type, title: widgetCatalog[type][0], enabled: true, ...(type==='launchers'?{}:{size:'medium',items:[{id:type+'-content',type}],activeItemId:type+'-content'}) })),
  printers: [{ id: 'h2d', name: 'H2D', model: 'H2D', host: '', serial: '', configured: false }, { id: 'p1s', name: 'P1S', model: 'P1S', host: '', serial: '', configured: false }],
  launchers: []
};
let cachedPreview;
try { cachedPreview = JSON.parse(localStorage.getItem('edge-deck-preview')); } catch {}
let state = {
  config: cachedPreview || structuredClone(defaultConfig),
  media: { connected: false, volume: null, error: preview ? 'Open the desktop app to connect Windows media.' : '' },
  tasks: { connected: false, items: [], source: 'Local agent activity' },
  printers: [], system: { hostname: '' }
};
if (preview) state.printers = state.config.printers.map(p => ({ ...p, status: 'not_configured' }));
const bridge = window.edge || {
  async getState() { return state; },
  async saveConfig(config) { localStorage.setItem('edge-deck-preview', JSON.stringify(config)); state.config = config; return state; },
  async media() { throw new Error('Media controls are available in the desktop app.'); },
  async openApp(target) { if (/^https:\/\//i.test(target)) window.open(target, '_blank', 'noopener,noreferrer'); else throw new Error('Open the desktop app to launch installed apps.'); },
  async chooseApp() { throw new Error('Choose installed apps from the desktop version.'); },
  async savePrinter() { throw new Error('Connect printers from the desktop version.'); },
  async fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); },
  async getDisplays() { return []; },
  async moveToDisplay() {},
  onState() {}
};

const paths = {
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  settings: '<path d="m10 3 4 0 1 3 3 1 3-1 2 4-2 2v4l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-4l-2-2 2-4 3 1 3-1z" transform="translate(1 -1) scale(.91)"/><circle cx="12" cy="12" r="3"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  exitFullscreen: '<path d="M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tasks: '<path d="M6 3h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-5 3V5a2 2 0 0 1 2-2Z"/><path d="m8 11 3 3 5-6"/>',
  printer: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z"/><path d="M17 11h1"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  playlists: '<path d="M3 5h15M3 10h15M3 15h8m5-1 5 3-5 3z"/>',
  previous: '<path d="M5 5v14M19 5 8 12l11 7z"/>',
  next: '<path d="M19 5v14M5 5l11 7-11 7z"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  volume: '<path d="M11 4 6 8H2v8h4l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  app: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  folder: '<path d="M3 5h7l2 3h9v12H3z"/>',
  nozzle: '<path d="M7 3h10v7l-3 4v4l-2 3-2-3v-4l-3-4Z"/><path d="M7 7h10"/>',
  bed: '<path d="M3 14h18l-3 6H6Z"/><path d="M7 3c-3 3 3 4 0 7M12 3c-3 3 3 4 0 7M17 3c-3 3 3 4 0 7"/>'
};
function icon(name) {
  const box = document.createElement('span');
  box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.app}</svg>`;
  return box.firstElementChild;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function button(text, fn, options = {}) {
  const node = el('button', options.className || 'button');
  node.type = 'button';
  if (options.icon) node.append(icon(options.icon));
  if (text) node.append(document.createTextNode(text));
  if (options.label) { node.setAttribute('aria-label', options.label); node.title = options.label; }
  if (options.disabled) node.disabled = true;
  node.addEventListener('click', async () => { try { await fn(); } catch (error) { toast(error.message || 'Something went wrong. Please try again.'); } });
  return node;
}
function badge(text, tone = '') { return el('span', `badge ${tone}`, text); }
function toast(message) {
  const node = $('#toast');
  const activeDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  const parent = activeDialog || document.body;
  if (node.parentElement !== parent) parent.append(node);
  node.textContent = String(message); node.hidden = false;
  clearTimeout(toast.timeout); toast.timeout = setTimeout(() => { node.hidden = true; }, 5500);
}
function updateState(next) {
  if (!next || !next.config) return;
  state = { ...state, ...next, config: { ...defaultConfig, ...next.config } };
  if (!Array.isArray(state.config.widgets)) state.config.widgets = structuredClone(defaultConfig.widgets);
  if (state.config.warning && state.config.warning !== updateState.lastWarning) { toast(state.config.warning); updateState.lastWarning = state.config.warning; }
  render();
}
async function saveConfig(config) {
  const next = await bridge.saveConfig(config);
  if (next?.config) updateState(next); else updateState({ ...state, config: next || config });
}
function newConfig() { return structuredClone(state.config); }
function isEnabled(widget) { return widget.enabled !== false; }
let launcherKey = '', activeTab = 'layout', activePrinterId = null, musicSignature = '';
const panelCache = new Map();
// Low power stills decorative motion (agent orbs only slow down); the service
// decides when Automatic applies (a full-screen app in front or the PC locked).
// What the tasks card shows: not elapsed seconds (counted here every second) or
// updatedAt, which every log line moves. Rebuilding for those restarted the
// activity shimmer so often that the card looked frozen.
function taskRenderValue(tasks) { return tasks && { ...tasks, usage: Boolean(tasks.usage?.codex || tasks.usage?.claude), items: (tasks.items || []).map(({ updatedAt, elapsedSeconds, ...item }) => item).sort((a, b) => String(a.id).localeCompare(String(b.id))) }; }
// The chat row at the top of the list and how far into it the list was scrolled.
function taskScroll(body) {
  const list = body.querySelector('.task-list'); if (!list || !list.scrollTop) return null;
  const row = [...list.children].find(node => node.offsetTop + node.offsetHeight > list.scrollTop);
  return { id: row?.dataset.id, offset: row ? list.scrollTop - row.offsetTop : 0, top: list.scrollTop };
}
function restoreTaskScroll(body, saved) {
  const list = body.querySelector('.task-list'); if (!list || !saved) return;
  const row = saved.id ? [...list.children].find(node => node.dataset.id === saved.id) : null;
  list.scrollTop = row ? row.offsetTop + saved.offset : saved.top;
}
function powerInfo() {
  const mode = state.power?.mode || state.config.power?.mode || 'auto';
  return { mode, active: state.power ? state.power.active === true : mode === 'on', reason: state.power?.reason || (mode === 'on' ? 'manual' : null) };
}
function powerStatusText(power) {
  if (power.active) return power.reason === 'manual' ? 'Low power is on.' : power.reason === 'away' ? 'Low power is on while the PC is locked.' : 'Low power is on while a full-screen app is in front.';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'Animations are already still because Windows animation effects are off.';
  return power.mode === 'auto' ? 'Animations run normally. Low power starts automatically when needed.' : 'Animations run normally.';
}
// Updates the Display pane's power row in place, so focus stays on the chosen
// option and the status line follows Automatic as it switches.
function syncPowerControls() {
  const power = powerInfo();
  for (const choice of document.querySelectorAll('#settings-content [data-power-mode]')) {
    const pressed = String(choice.dataset.powerMode === power.mode);
    if (choice.getAttribute('aria-pressed') !== pressed) choice.setAttribute('aria-pressed', pressed);
  }
  const status = document.querySelector('#settings-content .power-status');
  if (status) { const text = powerStatusText(power); if (status.textContent !== text) status.textContent = text; status.classList.toggle('is-active', power.active); }
}
function applyPower() {
  const { active } = powerInfo();
  document.documentElement.classList.toggle('low-power', active);
  window.EdgeWeatherSky?.setLowPower(active); window.EdgeAgentOrbs?.setLowPower(active); window.EdgeMediaWidget?.setLowPower(active);
  syncPowerControls();
}
function render() {
  applyPower();
  $('#connection-label').textContent = preview ? 'Browser preview' : state.system?.hostname === 'Service disconnected' ? 'Disconnected' : powerInfo().active ? 'Low power' : 'On this PC';
  $('#connection-label').title = state.system?.hostname || '';
  $('#connection-label').dataset.notice = String(preview || state.system?.hostname === 'Service disconnected');
  const fullScreen = Boolean(state.system?.fullscreen || document.fullscreenElement);
  const fullScreenButton = $('#fullscreen'); fullScreenButton.setAttribute('aria-pressed', String(fullScreen));
  fullScreenButton.title = fullScreen ? 'Exit full screen' : 'Enter full screen'; fullScreenButton.setAttribute('aria-label', fullScreenButton.title);
  fullScreenButton.replaceChildren(icon(fullScreen ? 'exitFullscreen' : 'fullscreen'));
  renderLaunchers(); renderCards(); renderApprovals(); updateClock(); updateTaskUsage();
  if (typeof dialog !== 'undefined' && dialog.open && activeTab === 'music') {
    const signature = JSON.stringify(state.spotify || {});
    if (signature !== musicSignature && !$('#settings-content input:focus')) { musicSignature = signature; renderSettings(); }
  }
  if (typeof printerConsole !== 'undefined' && printerConsole.open && !printerConsoleClosing && !$('#printer-console-content input:focus, #printer-console-content select:focus')) {
    const signature = printerConsoleStateKey();
    if (signature !== printerConsoleSignature) renderPrinterConsole(true);
  }
  if (typeof weatherDialog !== 'undefined' && weatherDialog.open) {
    const signature=JSON.stringify([state.weather,state.config.weather]);
    if(signature!==weatherSignature && window.EdgeWeatherUI.renderDetails($('#weather-content'),weatherContext(true))!==false)weatherSignature=signature;
  }
}
let editingLayout=false;
function cardItems(card){return Array.isArray(card.items)?card.items:card.type==='empty'?[]:[{id:card.id+'-content',type:card.type}];}
function cardTitle(card){return card.title || widgetCatalog[card.type]?.[0] || 'Card';}
function renderCards(){
  const container=$('#widgets');
  const mode=state.config.layout?.mode || 'overview';
  container.dataset.layout=mode; container.classList.toggle('is-editing',editingLayout);
  $('.workspace-name').textContent={overview:'Overview',bento:'Bento',focus:'Focus'}[mode]||'Overview';
  const visible=state.config.widgets.filter(w=>isEnabled(w)&&w.type!=='launchers');
  const ids=new Set(visible.map(w=>w.id));
  for(const child of [...container.children])if(!ids.has(child.dataset.id))child.remove();
  for(const card of visible){
    let panel=[...container.children].find(p=>p.dataset.id===card.id);
    if(!panel){panel=el('section','widget container-card');panel.dataset.id=card.id;panel.dataset.cardId=card.id;container.append(panel);}
    const items=cardItems(card), active=items.find(i=>i.id===card.activeItemId)||items[0],type=active?.type||'empty';
    panel.className=`widget container-card ${type}`;panel.dataset.widget=type;panel.dataset.size=card.size||'medium';panel.setAttribute('aria-label',cardTitle(card));
    panel.dataset.cardTitle=cardTitle(card);
    let toolbar=$('.card-toolbar',panel);
    const chromeKey=JSON.stringify([card.title,items,items.map(item=>state.config.launchers.find(app=>app.id===item.launcherId)?.name),editingLayout]);
    if(!toolbar){toolbar=el('div','card-toolbar');panel.prepend(toolbar);}
    if(!$(':scope > .card-reveal',panel)){const reveal=el('div','card-reveal');reveal.setAttribute('aria-hidden','true');panel.prepend(reveal);}
    if(toolbar.dataset.key!==chromeKey){
      toolbar.dataset.key=chromeKey;toolbar.replaceChildren();
      const handle=button('',()=>toast('Hold this handle, then drag to move the card.'),{className:'quiet-button card-drag-handle',icon:'grip',label:`Move ${cardTitle(card)}`});handle.title='Hold and drag to move';
      const title=el('h2','card-title',cardTitle(card));
      toolbar.append(handle,title,button('',()=>showCardEditor(card.id),{className:'quiet-button card-edit-button',icon:'settings',label:`Edit ${cardTitle(card)} card`}));
      $('.card-tabs',panel)?.remove();
      if(items.length>1){
        const tabs=el('div','card-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',`${cardTitle(card)} views`);
        for(const item of items){
          const label=item.label||widgetCatalog[item.type]?.[0]||state.config.launchers.find(a=>a.id===item.launcherId)?.name||'View';
          const tab=button(label,async()=>{const cfg=newConfig();cfg.widgets.find(w=>w.id===card.id).activeItemId=item.id;await saveConfig(cfg);},{className:'card-tab'});
          tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(item.id===active.id));tab.id=`tab-${card.id}-${item.id}`;tab.setAttribute('aria-controls',`view-${card.id}-${item.id}`);tab.tabIndex=item.id===active.id?0:-1;
          tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const all=[...tabs.children],i=all.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?all.length-1:(i+(event.key==='ArrowRight'?1:-1)+all.length)%all.length;all[next].focus();all[next].click();});tabs.append(tab);
        }toolbar.after(tabs);
      }
    }
    for(const tab of panel.querySelectorAll(':scope > .card-tabs > .card-tab')){const selected=tab.id===`tab-${card.id}-${active?.id}`;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
    const bodyIds=new Set(items.map(i=>i.id));if(!items.length)bodyIds.add('empty');
    for(const body of panel.querySelectorAll(':scope > .card-body'))if(!bodyIds.has(body.dataset.itemId))body.remove();
    for(const body of panel.querySelectorAll(':scope > .card-body'))body.hidden=body.dataset.itemId!==(active?.id||'empty');
    let body=[...panel.children].find(n=>n.classList.contains('card-body')&&n.dataset.itemId===(active?.id||'empty'));
    if(!body){body=el('div','card-body');body.dataset.itemId=active?.id||'empty';body.id=`view-${card.id}-${active?.id||'empty'}`;panel.append(body);}
    body.hidden=false;body.setAttribute('role',items.length>1?'tabpanel':'group');body.setAttribute('aria-label',cardTitle(card));
    if(items.length>1)body.setAttribute('aria-labelledby',`tab-${card.id}-${active.id}`);else body.removeAttribute('aria-labelledby');
    const value=type==='clock'?state.config.clock24:type==='today'?[state.weather,state.config.weather,state.config.clock24]:type==='weather'?[state.weather,state.config.weather]:type==='tasks'?[taskRenderValue(state.tasks),(state.approvals||[]).map(request=>request.session)]:type==='printers'?[state.printers,state.config.printers]:type==='media'?[state.media,state.spotify,state.config.music,state.spotifyCanvas]:type==='actions'?[state.media?.audio,state.media?.volume]:[active,state.config.launchers.find(app=>app.id===active?.launcherId)];
    const key=JSON.stringify([type,value]);
    if(body.dataset.renderKey!==key && !(['media','actions'].includes(type)&&body.contains(document.activeElement)&&document.activeElement?.matches('input[type="range"]')&&!document.activeElement.closest('[data-edge-media-root]'))){
      // Live widgets keep their DOM (animations, drafts, focus) and update in place.
      body.dataset.renderKey=key;
      const scroll=type==='tasks'?taskScroll(body):null;
      try{
        if(!['media','actions','today'].includes(type))body.replaceChildren();
        if(type==='app'||type==='website')renderAppContent(body,active);
        else if(type==='empty'){emptyContent(body,'plus','Your space, your way','Add a widget, an app or a website to this card.');body.append(button('Add content',()=>showCardEditor(card.id),{icon:'plus'}));}
        else ({clock:renderClock,today:renderToday,weather:renderWeather,tasks:renderTasks,printers:renderPrinters,media:renderMedia,actions:renderActions})[type]?.(body);
        if(scroll)restoreTaskScroll(body,scroll);
      }catch(error){delete body.dataset.renderKey;console.error('A card could not be displayed; it will be redrawn on the next update.',error);} // a half-built card is retried
    }
  }
  visible.forEach((card,index)=>{const panel=[...container.children].find(p=>p.dataset.id===card.id);if(container.children[index]!==panel){const before=container.children[index]||null;if(typeof container.moveBefore==='function')container.moveBefore(panel,before);else container.insertBefore(panel,before);}});
  if(!visible.length&&!container.children.length){const empty=el('div','all-hidden');empty.append(el('h2','','Make room for what matters'),el('p','','Add cards and choose what goes inside.'),button('Add cards',()=>showSettings('layout'),{icon:'plus'}));container.append(empty);}
  applyCardLayout();
}
function renderAppContent(body,item){
  const app=state.config.launchers.find(a=>a.id===item.launcherId);
  if(!app){emptyContent(body,'app','Choose an app','Edit this card to choose a saved shortcut.');return;}
  const hero=el('div','app-card-summary');const visual=el('span','app-card-icon');visual.append(icon(item.type==='website'?'link':'app'));hero.append(visual,el('h3','',app.name));
  hero.append(el('p','muted',item.type==='website'?new URL(app.target).hostname:'Windows app'),button(item.type==='website'?'Open website':'Open app',()=>bridge.openApp(app.target),{className:'button primary',icon:item.type==='website'?'link':'app'}));body.append(hero);
  if(item.type==='website'&&/^https:\/\//i.test(app.target)){
    const note=el('p','website-note','Website preview. If the site blocks embedding or needs sign-in, use Open website.');body.append(note);
    const frame=el('iframe','website-preview');frame.title=app.name+' website preview';frame.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-same-origin');frame.referrerPolicy='no-referrer';frame.loading='lazy';frame.src=app.target;body.append(frame);
  }
}
function applyCardLayout(){
  const container=$('#widgets'),mode=container.dataset.layout,panels=[...container.querySelectorAll(':scope > .container-card')];
  panels.forEach(p=>{p.style.gridColumn='';p.style.gridRow='';p.style.flexGrow='';});
  container.style.removeProperty('--card-rows');container.style.removeProperty('--card-row-height');
  if(mode==='overview'){panels.forEach(p=>{if(p.dataset.size!=='medium')p.style.flexGrow=({small:.65,wide:1.6,tall:1.1,large:1.9})[p.dataset.size]||1;});return;}
  const columns=innerWidth<600?1:innerWidth<1000?4:12;
  const cards=panels.map((panel,index)=>({id:panel.dataset.id,size:mode==='focus'?(index===0?'large':'medium'):panel.dataset.size}));
  const plan=window.EdgeLayout.packCards(cards,{columns});
  const rows=Math.max(plan.rows,mode==='focus'?2:1);
  container.style.setProperty('--card-columns',columns);container.style.setProperty('--card-rows',rows);
  const available=container.clientHeight;
  const rowHeight=innerWidth<1000?300:Math.max(220,Math.floor((available-16*(Math.min(rows,2)-1))/Math.min(rows,2)));
  container.style.setProperty('--card-row-height',rowHeight+'px');
  for(const placement of plan.cards){const panel=panels.find(p=>p.dataset.id===placement.id);panel.style.gridColumn=`${placement.column} / span ${placement.columnSpan}`;panel.style.gridRow=`${placement.row} / span ${placement.rowSpan}`;}
}
function layoutContext(){return{getState:()=>state,bridge,updateState,toast,onEditCard:showCardEditor,onChooseApp:()=>{$('#layout-editor').close();showSettings('apps');},onClose:()=>$('#layout-editor').close()};}
function showCardEditor(id){window.EdgeLayoutUI.renderEditor($('#layout-editor-content'),{...layoutContext(),cardId:id});const editor=$('#layout-editor');if(!editor.open){editor.showModal();renderApprovals();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)editor.animate([{opacity:0,transform:'translateX(24px)'},{opacity:1,transform:'none'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});}}
async function moveCard(id,targetId,after){
  const cfg=newConfig(),from=cfg.widgets.findIndex(w=>w.id===id);if(from<0||id===targetId)return;
  const positions=new Map([...$('#widgets').children].map(p=>[p.dataset.id,p.getBoundingClientRect()]));
  const [card]=cfg.widgets.splice(from,1),index=cfg.widgets.findIndex(w=>w.id===targetId);if(index<0)return;cfg.widgets.splice(index+(after?1:0),0,card);await saveConfig(cfg);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const panel of $('#widgets').children){const old=positions.get(panel.dataset.id);if(!old)continue;const next=panel.getBoundingClientRect();panel.animate([{transform:`translate(${old.left-next.left}px,${old.top-next.top}px)`},{transform:'none'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});}
  toast(`${cardTitle(card)} moved`);
}
function weatherContext(liveRefresh=false){return{getState:()=>state,bridge,updateState,toast,liveRefresh,onOpen:showWeather,clock24:state.config.clock24!==false};}
function renderToday(panel){
  if(window.EdgeWeatherUI?.renderToday)return window.EdgeWeatherUI.renderToday(panel,weatherContext());
  panel.replaceChildren();renderClock(panel);
}
function renderWeather(panel){if(window.EdgeWeatherUI)window.EdgeWeatherUI.renderWidget(panel,weatherContext());}
function header(panel, name, symbol, status) {
  const head = el('div', 'widget-header'); const title = el('h2', 'widget-title'); title.append(icon(symbol), document.createTextNode(name)); head.append(title); if (status) head.append(status); panel.append(head);
}
function renderClock(panel) {
  panel.append(el('p', 'clock-day'), el('p', 'clock-time'), el('p', 'clock-date'));
  const bottom = el('div', 'clock-bottom'); bottom.append(icon('clock'), document.createTextNode(Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' '))); panel.append(bottom);
}
function updateClock() {
  for (const card of document.querySelectorAll('.today-card')) window.EdgeWeatherUI?.tickToday(card, state.config.clock24 !== false);
  const now = new Date();
  for (const panel of document.querySelectorAll('.widget.clock .card-body:not([hidden])')) {
    $('.clock-day', panel).textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(now);
    $('.clock-date', panel).textContent = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !state.config.clock24 }).formatToParts(now);
    const time = $('.clock-time', panel); time.replaceChildren();
    for (const part of parts) { if (part.type === 'dayPeriod') time.append(el('span', '', part.value)); else time.append(document.createTextNode(part.value)); }
  }
}
function emptyContent(panel, symbol, title, message) {
  const empty = el('div', 'empty-content'); const visual = el('span', 'empty-symbol'); visual.append(icon(symbol)); empty.append(visual, el('h3', '', title), el('p', '', message)); panel.append(empty);
}
function renderTasks(panel) {
  const tasks = state.tasks || { items: [] };
  const items = (tasks.items || []).filter(item => item.status === 'working' || item.status === 'background')
    .sort((a, b) => (b.status === 'working') - (a.status === 'working') || (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
  const working = items.filter(x => x.status === 'working').length, waiting = items.length - working;
  header(panel, 'Working chats', 'tasks', badge(working ? `${working} working` : waiting ? `${waiting} in background` : tasks.connected ? 'No active chats' : 'Not connected', items.length ? 'working' : ''));
  if (!items.length) emptyContent(panel, 'tasks', tasks.connected ? 'Nothing running' : 'Your work, in view', tasks.connected ? 'Codex, Claude Code and ChatGPT chats appear here while they work.' : 'Local Codex, Claude Code and ChatGPT chats will appear here when activity is available.');
  else {
    const list = el('div', 'task-list');
    for (const item of items.slice(0, 12)) {
      const row = el('article', 'task'); row.dataset.agent = item.agent === 'Claude Code' ? 'claude' : item.agent === 'ChatGPT' ? 'chatgpt' : 'codex'; row.dataset.id = String(item.id || '');
      const asking = Boolean(item.approval) || (item.agent === 'Claude Code' && (state.approvals || []).some(request => `claude-${request.session}` === item.id));
      const background = Array.isArray(item.background) ? item.background : [];
      const activity = asking ? 'Waiting for your approval' : item.status === 'background' ? 'Running in the background' : item.activityLabel;
      row.classList.toggle('is-asking', asking);
      // The orb shows what the agent is doing right now (thinking, running, writing…).
      const orb = window.EdgeAgentOrbs?.create({ activity, agent: row.dataset.agent, size: 64 });
      if (orb) { const visual = el('div', 'task-orb'); visual.append(orb); row.append(visual); row.classList.add('has-orb'); }
      const content = el('div', 'task-content'); row.append(content);
      const heading = el('div', 'task-heading'); heading.append(el('span', 'task-agent', item.agent || 'Codex'));
      if (item.project) heading.append(el('span', 'task-project', item.project));
      content.append(heading, el('p', 'task-name', item.title || 'Untitled chat'));
      const progress = el('div', 'task-progress');
      if (!orb) {
        const wave = el('span', 'working-wave'); wave.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 4; i++) { const bar = el('i'); bar.style.animationDelay = `${i * 120}ms`; wave.append(bar); }
        progress.append(wave);
      }
      const label = el('span', 'task-current-label', activity || 'Working'); label.style.animationDelay = `-${Math.round(performance.now() % 3000)}ms`;
      progress.append(label); content.append(progress);
      if (item.approval) {
        // Codex approvals cannot be answered from here: say where to answer.
        const box = el('div', 'task-approval');
        box.append(el('p', 'task-approval-title', item.approval.certain ? `${item.agent || 'Codex'} is waiting for your approval` : `${item.agent || 'Codex'} may be waiting for your approval`));
        if (item.approval.detail) box.append(el('code', 'task-approval-detail', item.approval.detail));
        if (item.approval.reason) box.append(el('p', 'task-approval-reason', item.approval.reason));
        box.append(el('p', 'task-approval-hint', `Approve or deny it in ${item.agent || 'Codex'}.`));
        content.append(box);
      } else if (item.progressText) content.append(el('p', 'task-progress-message', item.progressText));
      if (Array.isArray(item.steps) && item.steps.length) content.append(taskSteps(item.steps, item.status === 'working'));
      if (background.length) content.append(taskBackground(background));
      const meta = el('div', 'task-meta'); meta.append(el('span', '', item.status === 'background' ? 'In the background for' : 'Working for'));
      const timer = el('span', 'task-elapsed'); timer.dataset.startedAt = item.startedAt || ''; timer.dataset.estimated = String(item.startedAtEstimated === true);
      timer.title = item.startedAt ? `Started ${new Date(item.startedAt).toLocaleString()}` : 'Start time unavailable'; meta.append(timer);
      content.append(meta); list.append(row);
    }
    panel.append(list);
  }
  if (tasks.error) { const note = el('p', 'widget-footnote', tasks.error); note.title = tasks.message || ''; panel.append(note); }
  if (tasks.usage?.codex || tasks.usage?.claude) { const usage = el('div', 'task-usage'); usage.setAttribute('role', 'group'); usage.setAttribute('aria-label', 'Usage'); panel.append(usage); }
  updateTaskTimers(); updateTaskUsage();
}
// Plan usage at the foot of the card, in each agent's colour. Codex records how
// much of each limit window is used; Claude Code's logs only record activity, and
// a limit when one is reached.
function resetText(iso) {
  const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
  const hours = (at - Date.now()) / 3600000;
  if (hours <= 0) return 'resets now';
  if (hours < 24) return `resets in ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`}`;
  return `resets ${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !state.config?.clock24 })}`;
}
function compactCount(value) { return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value); }
function updateTaskUsage() {
  const box = document.querySelector('.task-usage'); if (!box) return;
  const { codex, claude } = state.tasks?.usage || {}, rows = [];
  if (codex) for (const window of codex.windows || []) rows.push({ agent: 'codex', name: 'Codex', label: `${window.label} limit`, percent: window.usedPercent,
    value: `${Math.round(window.usedPercent)}%`, detail: resetText(window.resetsAt) });
  if (claude) {
    if (claude.limit) rows.push({ agent: 'claude', name: 'Claude', label: `${claude.limit.type === 'seven_day' ? 'Weekly' : '5-hour'} limit reached`, percent: 100, value: '100%', detail: resetText(claude.limit.resetsAt) });
    else rows.push({ agent: 'claude', name: 'Claude', label: 'Today', value: `${compactCount(claude.today.requests)} ${claude.today.requests === 1 ? 'reply' : 'replies'}`, detail: `${compactCount(claude.today.output)} tokens written` });
  }
  const key = JSON.stringify(rows); if (box.dataset.key === key) return; box.dataset.key = key;
  box.replaceChildren(...rows.map(row => {
    const line = el('div', 'task-usage-row'); line.dataset.agent = row.agent;
    const top = el('div', 'task-usage-top'); top.append(el('span', 'task-usage-name', row.name), el('span', 'task-usage-label', row.label));
    if (row.detail) top.append(el('span', 'task-usage-detail', row.detail));
    top.append(el('span', 'task-usage-value', row.value));
    line.append(top);
    if (Number.isFinite(row.percent)) {
      const meter = el('div', 'task-usage-meter'); meter.setAttribute('role', 'meter'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(Math.round(row.percent))); meter.setAttribute('aria-label', `${row.name} ${row.label}`);
      const fill = el('i'); fill.style.width = `${row.percent}%`; meter.append(fill); line.append(meter);
    }
    return line;
  }));
}
// A chat's step list, drawn like the Claude app's task list: a card of steps,
// each with a dashed circle (not started), a spinning ring (in progress) or a
// filled check (done, its text dimmed).
function taskSteps(steps, live) {
  const done = steps.filter(step => step.status === 'completed').length;
  const box = el('div', 'task-steps'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', `Steps, ${done} of ${steps.length} done`);
  // The card has little room: at most eight steps, from two before the current one.
  const current = steps.findIndex(step => step.status !== 'completed');
  const start = Math.max(0, Math.min((current < 0 ? steps.length : current) - 2, steps.length - 8)), end = Math.min(steps.length, start + 8);
  const list = el('ol', 'task-step-list');
  if (start) list.append(el('li', 'task-step-more', `${start} earlier ${start === 1 ? 'step' : 'steps'} done`));
  for (const step of steps.slice(start, end)) {
    const running = step.status === 'in_progress';
    const row = el('li', `task-step is-${step.status === 'completed' ? 'done' : running ? 'current' : 'pending'}`);
    const mark = el('span', `task-step-mark${running && live ? ' is-live' : ''}`); mark.setAttribute('aria-hidden', 'true');
    row.append(mark, el('span', 'task-step-text', running && step.active || step.text),
      el('span', 'visually-hidden', `, ${step.status === 'completed' ? 'done' : running ? (live ? 'in progress' : 'stopped') : 'not started'}`));
    if (running) row.setAttribute('aria-current', 'step');
    list.append(row);
  }
  if (end < steps.length) list.append(el('li', 'task-step-more', `${steps.length - end} more ${steps.length - end === 1 ? 'step' : 'steps'}`));
  box.append(list);
  return box;
}
// Work the chat left running, drawn like the activity group in the Claude app:
// a header with the agent's animated dots, then the tasks in a bordered list.
function taskBackground(tasks) {
  const box = el('div', 'task-background'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', `Background tasks, ${tasks.length} running`);
  const head = el('p', 'task-bg-head'); const dots = el('span', 'task-bg-dots'); dots.setAttribute('aria-hidden', 'true'); dots.append(el('i'), el('i'), el('i'));
  head.append(dots, el('span', '', `${tasks.length} background ${tasks.length === 1 ? 'task' : 'tasks'}`)); box.append(head);
  const list = el('ul', 'task-bg-list');
  for (const task of tasks.slice(0, 4)) {
    const label = task.label || 'Background task';
    const row = el('li', 'task-bg'); row.setAttribute('aria-label', `Background task: ${label}`);
    const time = el('span', 'task-bg-time'); time.dataset.startedAt = task.startedAt || ''; time.dataset.estimated = 'false'; time.dataset.short = 'true';
    const main = el('span', 'task-bg-main'); main.append(el('span', 'task-bg-label', label), time); row.append(main);
    if (task.progress?.total) { const running = task.progress.total - task.progress.done; row.append(el('span', 'task-bg-sub', `${task.progress.total} ${task.progress.total === 1 ? 'task' : 'tasks'}${running ? ` · ${running} running` : ''}`)); }
    list.append(row);
  }
  if (tasks.length > 4) list.append(el('li', 'task-bg task-bg-more', `${tasks.length - 4} more`));
  box.append(list);
  return box;
}
// Claude Code permission requests appear over the Agent chats card (or at the
// top of the screen when that card is not shown) with Allow and Deny. If no
// one answers in time, Claude Code shows its own prompt instead.
// A request's buttons arm only after it has been on screen for a moment, so a
// tap (or double tap) meant for one request can never answer the next one.
const APPROVAL_ARM_MS = 800;
let approvalBusy = '', approvalShown = { id: '', at: 0 }, approvalArmTimer = 0;
function renderApprovals() {
  const requests = state.approvals || [];
  let sheet = document.getElementById('approval-sheet');
  if (!requests.length) { sheet?.remove(); approvalShown = { id: '', at: 0 }; clearTimeout(approvalArmTimer); return; }
  // Shown inside an open dialog (which blocks the rest of the page), else over
  // the Agent chats card, else floating at the top.
  const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
  const card = document.querySelector('#widgets > .container-card.tasks');
  if (!sheet) { sheet = el('section', 'approval-sheet'); sheet.id = 'approval-sheet'; sheet.setAttribute('role', 'region'); sheet.setAttribute('aria-label', 'Permission request'); }
  const host = modal || card || document.body;
  if (sheet.parentElement !== host) host.append(sheet);
  sheet.classList.toggle('is-floating', !modal && !card); sheet.classList.toggle('in-dialog', Boolean(modal));
  const request = requests[0];
  if (approvalShown.id !== request.id) approvalShown = { id: request.id, at: performance.now() };
  const wait = APPROVAL_ARM_MS - (performance.now() - approvalShown.at);
  const locked = Boolean(approvalBusy) || wait > 0;
  clearTimeout(approvalArmTimer);
  if (wait > 0) approvalArmTimer = setTimeout(renderApprovals, wait + 20);
  const key = JSON.stringify([request.id, requests.length, approvalBusy, locked]);
  if (sheet.dataset.key === key) return;
  const fresh = sheet.dataset.id !== request.id;
  sheet.dataset.key = key; sheet.dataset.id = request.id; sheet.replaceChildren();
  if (fresh && !matchMedia('(prefers-reduced-motion: reduce)').matches) sheet.animate([{ opacity: 0, translate: '0 16px' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
  const head = el('div', 'approval-head');
  const orb = window.EdgeAgentOrbs?.create({ activity: 'Waiting for your reply', agent: 'claude', size: 32 });
  if (orb) { const visual = el('span', 'approval-orb'); visual.append(orb); head.append(visual); }
  const titles = el('div', 'approval-titles');
  titles.append(el('h3', 'approval-title', `${request.agent || 'Claude Code'} needs your permission`), el('p', 'approval-subtitle', [request.project, `wants to ${request.action}`].filter(Boolean).join(' · ')));
  head.append(titles);
  if (requests.length > 1) head.append(el('span', 'approval-count', `1 of ${requests.length}`));
  sheet.append(head);
  if (request.detail) { const detail = el('pre', 'approval-detail', request.detail); sheet.append(detail); }
  if (request.note) sheet.append(el('p', 'approval-note', request.note));
  const footer = el('div', 'approval-footer');
  const countdown = el('span', 'approval-countdown'); countdown.dataset.expires = String(Date.now() + (Number(request.remainingMs) || 0));
  // Re-rendering on arming creates new buttons, so a press that began before
  // the request was armed cannot complete as a click on them.
  const deny = button('Deny', () => decideApproval(request.id, 'deny'), { className: 'button approval-deny', disabled: locked });
  const allow = button('Allow', () => decideApproval(request.id, 'allow'), { className: 'button primary approval-allow', disabled: locked });
  footer.append(countdown, deny, allow); sheet.append(footer);
  const announce = el('p', 'visually-hidden'); announce.setAttribute('role', 'status'); sheet.append(announce);
  if (fresh) setTimeout(() => { announce.textContent = `${request.agent || 'Claude Code'} needs your permission to ${request.action}.`; }, 50);
  updateApprovalCountdown();
}
function updateApprovalCountdown() {
  const countdown = document.querySelector('#approval-sheet .approval-countdown'); if (!countdown) return;
  const seconds = Math.max(0, Math.ceil((Number(countdown.dataset.expires) - Date.now()) / 1000));
  countdown.textContent = seconds ? `Answer within ${seconds} s, or in Claude Code` : 'Answer in Claude Code';
}
async function decideApproval(id, decision) {
  if (approvalBusy || id !== approvalShown.id || performance.now() - approvalShown.at < APPROVAL_ARM_MS || typeof bridge.decideApproval !== 'function') return;
  approvalBusy = id; renderApprovals();
  try {
    const next = await bridge.decideApproval(id, decision);
    if (next?.config) updateState(next);
    // An answer in the Claude app may have applied first, so do not claim the outcome.
    toast(decision === 'allow' ? 'Sent Allow to Claude Code.' : 'Sent Deny to Claude Code.');
  } catch (error) { toast(error.message || 'That request was already answered.'); }
  finally { approvalBusy = ''; renderApprovals(); }
}
function updateTaskTimers() {
  for (const timer of document.querySelectorAll('.task-elapsed, .task-bg-time')) {
    const started = Date.parse(timer.dataset.startedAt); if (!Number.isFinite(started)) { timer.textContent = timer.dataset.short ? '' : 'Time unavailable'; continue; }
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (timer.dataset.short) {
      const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
      timer.textContent = seconds < 60 ? `${seconds}s` : minutes < 5 ? `${minutes}m ${seconds % 60}s` : minutes < 60 ? `${minutes}m`
        : hours < 24 ? (minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`) : (hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`);
      continue;
    }
    const duration = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
    timer.textContent = `${timer.dataset.estimated === 'true' ? '~' : ''}${duration}`;
  }
}
const printerLabels = { not_configured: ['Set up', ''], connecting: ['Connecting', 'working'], offline: ['Offline', 'warning'], printing: ['Printing', 'working'], idle: ['Ready', 'good'], paused: ['Paused', 'warning'], finished: ['Finished', 'good'], error: ['Attention', 'error'] };
// The model being printed, as the printer's own preview of the plate. Pictures
// are fetched once per job (the version changes with the job) and kept here.
const printerPictures = new Map();
function printerPicture(id, version, box) {
  const saved = printerPictures.get(id);
  if (saved?.version === version && saved.url) return saved.url;
  if (saved?.version === version) return null;
  const entry = { version, url: null }; printerPictures.set(id, entry);
  bridge.printerThumbnail?.(id).then(url => {
    if (typeof url !== 'string' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 8000000) return null;
    return cropToModel(url);
  }).then(url => {
    if (!url || printerPictures.get(id) !== entry) return;
    entry.url = url;
    const figure = document.querySelector(`.printer[data-printer-id="${CSS.escape(id)}"] .printer-figure`);
    if (figure) showPicture(figure, url, version.endsWith(':project'));
  }).catch(() => {});
  return null;
}
// Plate pictures are 512 px squares with the model somewhere inside a lot of
// transparency: crop to the model (with a small margin) so it fills the tile.
async function cropToModel(url) {
  try {
    const image = new Image(); image.src = url; await image.decode();
    const w = image.naturalWidth, h = image.naturalHeight, canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return url;
    const margin = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06);
    x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin); x1 = Math.min(w - 1, x1 + margin); y1 = Math.min(h - 1, y1 + margin);
    const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch { return url; }
}
// A picture from the saved project may differ from what was sent (copies added
// before sending), so it is labelled.
function showPicture(box, url, approximate = false) {
  const image = el('img', 'printer-model-picture'); image.src = url; image.alt = ''; image.decoding = 'async'; image.draggable = false;
  box.classList.add('has-model'); box.replaceChildren(image);

  if (approximate) { const note = el('span', 'printer-model-note', 'Saved project'); box.title = 'From the saved project in Bambu Studio; the printer does not share its copy (insert a USB drive in the printer for the exact picture).'; box.append(note); }
}
function printerFigure(model, data = {}) {
  const box = el('div', 'printer-figure'); box.setAttribute('aria-hidden', 'true');
  if (data.status === 'finished') box.classList.add('is-finished');
  if (data.thumbnail && ['printing', 'paused', 'finished'].includes(data.status)) {
    const url = printerPicture(data.id, data.thumbnail, box);
    if (url) { showPicture(box, url, String(data.thumbnail).endsWith(':project')); return box; }
  }
  // Product photos of the printers themselves.
  const sources = { H2D: 'assets/printers/h2d-photo.png', P1S: 'assets/printers/p1s-photo.png' };
  const source = Object.hasOwn(sources, model) ? sources[model] : null;
  if (source) {
    // Printer photos are not shipped (Bambu Lab's images); without one, an icon.
    const image = el('img', 'printer-artwork'); image.alt = ''; image.decoding = 'async'; image.draggable = false;
    image.addEventListener('error', () => { if (!image.isConnected || box.classList.contains('has-model')) return; box.replaceChildren(icon('printer')); box.classList.add('no-photo'); }, { once: true });
    image.src = source; box.append(image);
  } else box.append(icon('printer'));
  return box;
}
// Progress laid out like the H2D's own screen: the percentage on the left,
// "layer/total | -time left" on the right, a thick lime bar, then the status
// (and the finish time, which the screen does not show but is handy here).
function printProgress(name, data) {
  const progress = Math.max(0, Math.min(100, data.progress));
  const box = el('div', `print-progress${data.status === 'paused' ? ' is-paused' : ''}`);
  const top = el('div', 'print-progress-top');
  top.append(el('span', 'print-progress-percent', `${Math.round(progress)}%`));
  const facts = [];
  if (Number.isFinite(data.totalLayers) && data.totalLayers > 0) facts.push(`${Math.min(data.layer || 0, data.totalLayers)}/${data.totalLayers}`);
  if (Number.isFinite(data.remainingMinutes) && data.status !== 'finished') {
    const hours = Math.floor(data.remainingMinutes / 60), minutes = Math.round(data.remainingMinutes % 60);
    facts.push(`-${hours ? `${hours}h${minutes}m` : `${minutes}m`}`);
  }
  if (facts.length) top.append(el('span', 'print-progress-left', facts.join(' | ')));
  const track = el('div', 'print-progress-track'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `${name} print progress`);
  track.setAttribute('aria-valuenow', String(Math.round(progress))); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
  const fill = el('span'); fill.style.width = `${progress}%`; track.append(fill);
  const bottom = el('div', 'print-progress-facts');
  bottom.append(el('span', 'print-progress-status', data.status === 'paused' ? 'Paused' : data.status === 'finished' ? 'Finished' : data.stage?.label || 'Printing'));
  if (Number.isFinite(data.remainingMinutes) && data.status === 'printing' && data.remainingMinutes > 0) {
    const done = new Date(Date.now() + data.remainingMinutes * 60000);
    const day = done.toDateString() === new Date().toDateString() ? '' : `${done.toLocaleDateString([], { weekday: 'short' })} `;
    bottom.append(el('span', '', `Done ${day}${done.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !state.config?.clock24 })}`));
  }
  box.append(top, track, bottom);
  return box;
}
// Printers: a photo of each printer (or the model it prints, at the same
// size) beside its state: progress while printing, a finished summary, and
// the loaded filament while it waits.
function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.round(ms / 60000), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function agoText(iso) {
  const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
// Idle: the spools loaded in the AMS, in their real colours; the one feeding
// the nozzle is ringed.
function filamentSpools(data) {
  const filament = data.filament || {}; const slots = Array.isArray(filament.slots) ? filament.slots.slice(0, 8) : [];
  const box = el('div', 'printer-spools'); box.setAttribute('role', 'list'); box.setAttribute('aria-label', 'Loaded filament');
  const loaded = new Set((filament.extruders || []).filter(item => Number.isInteger(item.amsId) && Number.isInteger(item.slotId)).map(item => `${item.amsId}:${item.slotId}`));
  for (const slot of slots) {
    const color = /^[0-9A-F]{6}([0-9A-F]{2})?$/i.test(slot.color || '') ? `#${slot.color.slice(0, 6)}` : '#5a5a5e';
    const item = el('span', `printer-spool${loaded.has(slot.id) ? ' is-loaded' : ''}`); item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `${slot.material || 'Filament'}, ${slot.label}${loaded.has(slot.id) ? ', loaded' : ''}`);
    const swatch = el('i'); swatch.style.setProperty('--spool', color); item.append(swatch, el('span', '', (slot.material || '—').slice(0, 7)));
    box.append(item);
  }
  return slots.length ? box : null;
}
const PRINTER_FINISHED_MS = 5 * 60000;
function renderPrinters(panel) {
  const configured = state.config.printers || [];
  header(panel, '3D printers', 'printer', badge(`${configured.length} printers`));
  const list = el('div', 'printer-list');
  for (const config of configured) {
    const raw = (state.printers || []).find(p => p.id === config.id) || { status: config.configured ? 'connecting' : 'not_configured' };
    const finishedFor = raw.status === 'finished' ? Date.now() - Date.parse(raw.finishedAt || raw.finishedSeenAt || '') : NaN;
    const data = raw.status === 'finished' && finishedFor > PRINTER_FINISHED_MS ? { ...raw, status: 'idle', thumbnail: null } : raw;
    const active = ['printing', 'paused'].includes(data.status);
    const row = el('article', `printer is-rich${active ? ' is-job' : ''}`); row.dataset.printerId = config.id; row.dataset.status = data.status;
    const displayName = data.accountName || data.name || config.name;
    row.append(button('', () => showPrinterConsole(config.id, row), { className: 'printer-open', label: `Open ${displayName} control panel` }), printerFigure(config.model, { ...data, id: config.id }));
    const detail = el('div', 'printer-details'); const top = el('div', 'printer-topline');
    top.append(el('h3', 'printer-name', displayName), badge(...(printerLabels[data.status] || ['Unknown', '']))); detail.append(top);
    const modelName = `Bambu Lab ${config.model || ''}`.trim();
    if (String(displayName).trim().toLowerCase() !== modelName.toLowerCase()) detail.append(el('p', 'printer-model', modelName));
    if (data.status === 'not_configured') {
      detail.append(el('p', 'printer-note', 'Connect over your local network.'), button('Connect printer', () => showSettings('printers'), { className: 'button subtle' }));
    } else if (active) {
      if (data.jobName) { const job = el('p', 'printer-job', data.jobName); job.title = data.jobName; detail.append(job); }
      if (Number.isFinite(data.progress)) detail.append(printProgress(displayName, data));
    } else if (data.status === 'finished') {
      // Finished: a clear done state, what was printed, when and how long it took.
      if (data.jobName) { const job = el('p', 'printer-job', data.jobName); job.title = data.jobName; detail.append(job); }
      const done = el('div', 'printer-done');
      const head = el('div', 'printer-done-head'); const title = el('span', 'printer-done-title'); title.append(icon('check'), document.createTextNode('Done'));
      head.append(title, el('span', 'printer-done-percent', '100%'));
      const bar = el('div', 'printer-done-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `${displayName} print finished`); bar.setAttribute('aria-valuenow', '100'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.append(el('span'));
      const took = data.jobStartedAt && data.finishedAt ? durationText(Date.parse(data.finishedAt) - Date.parse(data.jobStartedAt)) : '';
      const meta = el('div', 'printer-done-meta'); meta.append(el('span', '', [data.finishedAt ? `Finished ${agoText(data.finishedAt)}` : 'Print finished', took ? `took ${took}` : ''].filter(Boolean).join(' · ')), el('span', '', 'Clear the plate'));
      done.append(head, bar, meta); detail.append(done);
    } else if (data.status === 'idle') {
      // Ready: a calm status line and the loaded filament.
      const ready = el('p', 'printer-ready'); ready.append(el('i', 'printer-ready-dot'), document.createTextNode('Ready to print')); detail.append(ready);
      const spools = filamentSpools(data); if (spools) detail.append(spools);
    } else {
      if (data.message) detail.append(el('p', 'printer-note', data.message));
    }
    const disclosure = el('span', 'printer-disclosure'); disclosure.setAttribute('aria-hidden', 'true'); disclosure.append(icon('right'));
    row.append(detail, disclosure); list.append(row);
  }
  if (!configured.length) emptyContent(panel, 'printer', 'Your print room', 'Add your printer connections in Customize.'); else panel.append(list);
}
function renderActions(panel){
  if(window.EdgeQuickActions)return window.EdgeQuickActions.render(panel,{getState:()=>state,bridge,updateState,toast});
  emptyContent(panel,'app','Quick actions unavailable','Reopen Edge Deck to load quick actions.');
}
function renderMedia(panel) {
  if(window.EdgeMediaWidget)return window.EdgeMediaWidget.render(panel,{getState:()=>state,bridge,updateState,toast,onSetup:()=>showSettings('music')});
  panel.replaceChildren();
  const media = state.media || {};
  header(panel, 'Now playing', 'music', badge(media.connected ? (media.playing ? 'Playing' : 'Paused') : 'Waiting', media.playing ? 'good' : ''));
  const info = el('div', 'media-information'); const art = el('div', 'media-art');
  if (media.connected && typeof media.artwork === 'string' && /^data:image\/(?:jpeg|png|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(media.artwork) && media.artwork.length <= 3000000) {
    const image = el('img', 'song-cover'); image.alt = `Cover for ${media.title || 'the current track'}`; image.decoding = 'async';
    image.addEventListener('error', () => { art.classList.remove('has-artwork'); art.replaceChildren(icon('music')); }, { once: true });
    image.src = media.artwork; art.classList.add('has-artwork'); art.append(image);
  } else art.append(icon('music'));
  info.append(art);
  const copy = el('div', 'media-copy');
  copy.append(el('h3', 'media-title', media.connected ? (media.title || 'Untitled track') : 'Put something on'), el('p', 'media-artist', media.connected ? (media.artist || media.source || 'Windows media') : 'Open Spotify or another media app'));
  info.append(copy);
  panel.append(info);
  const controls = el('div', 'media-controls');
  controls.append(button('', () => sendMedia('previous'), { className: 'icon-button', icon: 'previous', label: 'Previous track', disabled: !media.connected || !media.canPrevious }));
  controls.append(button('', () => sendMedia('play-pause'), { className: 'icon-button play-button', icon: media.playing ? 'pause' : 'play', label: media.playing ? 'Pause playback' : 'Play', disabled: !media.connected || !(media.playing ? media.canPause : media.canPlay) }));
  controls.append(button('', () => sendMedia('next'), { className: 'icon-button', icon: 'next', label: 'Next track', disabled: !media.connected || !media.canNext })); panel.append(controls);
  controls.append(button('', () => showSettings('music'), { className: 'icon-button playlist-button', icon: 'playlists', label: 'Choose Spotify playlist' }));
  const volume = el('div', 'volume-control'); volume.append(icon('volume'));
  const input = el('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = Number.isFinite(media.volume) ? String(media.volume) : '0'; input.disabled = !Number.isFinite(media.volume); input.setAttribute('aria-label', 'System volume');
  input.style.setProperty('--volume', `${input.value}%`);
  const value = el('span', 'volume-value', Number.isFinite(media.volume) ? `${Math.round(media.volume)}%` : '—');
  input.addEventListener('input', () => { value.textContent = `${input.value}%`; input.style.setProperty('--volume', `${input.value}%`); });
  input.addEventListener('change', async () => { try { await sendMedia('volume', Number(input.value)); } catch (error) { toast(error.message); } finally { input.blur(); panelCache.delete(panel.dataset.id); render(); } });
  const volumeStatus = media.volumeError ? `System volume: ${media.volumeError}` : `System volume · ${media.source || 'Windows media'}`;
  volume.append(input, value); panel.append(volume, el('p', 'media-status', [volumeStatus, media.error].filter(Boolean).join('. ')));
}
async function sendMedia(action, value) {
  const next = await bridge.media(action, value);
  if (next?.config) updateState(next); else if (next) { state.media = next; render(); }
}
// Dock icons: each app's own icon, redrawn as a white glyph. Icons on a
// background tile keep what differs from the tile; icons on transparency keep
// the main shape and cut out strongly contrasting details (like Spotify's arcs).
const appIcons = new Map();
function whiteGlyph(source) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      try {
        const size = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size), px = pixels.data;
        const lum = i => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
        const corners = [0, (size - 1) * 4, size * (size - 1) * 4, (size * size - 1) * 4];
        const tile = corners.every(i => px[i + 3] > 200);
        let reference = 0, weight = 0;
        if (tile) reference = corners.reduce((sum, i) => sum + lum(i), 0) / 4;
        else { for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; reference += lum(i) * a; weight += a; } reference = weight ? reference / weight : 0; }
        let visible = 0;
        for (let i = 0; i < px.length; i += 4) {
          const difference = Math.abs(lum(i) - reference);
          const keep = tile ? smooth(0.12, 0.3, difference) : 1 - smooth(0.25, 0.42, difference);
          px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(px[i + 3] * keep); if (px[i + 3] > 40) visible++;
        }
        if (visible < 20) { resolve(null); return; }
        ctx.putImageData(pixels, 0, 0); resolve(canvas.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}
// Downloaded icons are already clean white vectors; only an app's own icon
// (the fallback) is redrawn as a white glyph.
const iconKey = app => `${app.target}|${app.name}|${app.icon || ''}`;
function loadAppIcon(app, retry = false) {
  const key = iconKey(app);
  if ((appIcons.has(key) && !retry) || typeof bridge.appIcon !== 'function') return;
  if (!appIcons.has(key)) appIcons.set(key, null);
  bridge.appIcon(app.target, app.id).then(result => {
    // Offline: keep whatever is shown and try again in a few minutes.
    if (result?.retry) setTimeout(() => loadAppIcon(app, true), 300000);
    if (!result || (typeof result === 'object' && !result.image)) return null;
    if (typeof result === 'string') return whiteGlyph(result);
    return result.monochrome ? result.image : whiteGlyph(result.image);
  }).catch(() => null).then(glyph => {
    if (!glyph) return;
    appIcons.set(key, glyph); launcherKey = ''; renderLaunchers();
    // The Apps settings preview follows too (keys hold paths, so compare values).
    for (const node of document.querySelectorAll('#settings-content .app-row-icon')) if (node.dataset.iconKey === key) node.replaceChildren(launcherIcon(app));
  });
}
function launcherIcon(app) {
  const glyph = appIcons.get(iconKey(app));
  if (!glyph) return icon(/^https:/i.test(app.target) ? 'link' : 'app');
  const image = el('img', 'launcher-glyph'); image.src = glyph; image.alt = ''; image.draggable = false; return image;
}
function renderLaunchers() {
  const enabled = state.config.widgets.some(w => w.type === 'launchers' && isEnabled(w));
  for (const app of state.config.launchers || []) loadAppIcon(app);
  const key = JSON.stringify([enabled, state.config.launchers, [...appIcons.values()].filter(Boolean).length]); if (key === launcherKey) return; launcherKey = key;
  const strip = $('#launchers'); strip.replaceChildren(); strip.hidden = !enabled; strip.style.display = enabled ? '' : 'none'; if (!enabled) return;
  strip.append(el('span', 'launchers-label', 'Apps'));
  const dock = el('div', 'launcher-dock');
  for (const app of state.config.launchers || []) { const launch = button(app.name, () => bridge.openApp(app.target), { className: 'launcher' }); launch.prepend(launcherIcon(app)); dock.append(launch); }
  dock.append(button('Add app', () => showSettings('apps'), { className: 'launcher add', icon: 'plus' }));
  strip.append(dock);
}

const dialog = $('#settings');
const printerConsole = $('#printer-console');
const weatherDialog = $('#weather-dialog');
let weatherSignature='';
function showWeather(){
  weatherSignature=JSON.stringify([state.weather,state.config.weather]);
  window.EdgeWeatherUI.renderDetails($('#weather-content'),weatherContext());
  if(!weatherDialog.open){weatherDialog.showModal();renderApprovals();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)weatherDialog.animate([{opacity:0,transform:'translateY(16px) scale(.98)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});}
}
let printerConsoleOrigin = null, printerConsoleClosing = false, printerConsoleSignature = '';
function printerConsoleStateKey() {
  const printer = (state.printers || []).find(p => p.id === activePrinterId);
  if (!printer) return '';
  const { lastSeen, connection, ...meaningful } = printer;
  return JSON.stringify(meaningful);
}
function renderPrinterConsole(liveRefresh = false) {
  const signature = printerConsoleStateKey();
  const rendered = window.EdgePrinterUI.render($('#printer-console-content'), { printerId: activePrinterId, getState: () => state, bridge, updateState, toast, liveRefresh, onSetup: async () => { await closePrinterConsole(); showSettings('printers'); } });
  if (rendered !== false) printerConsoleSignature = signature;
}
function consoleMotion(origin, closing = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const box = printerConsole.getBoundingClientRect();
  const source = origin || box;
  const dx = source.left + source.width / 2 - (box.left + box.width / 2), dy = source.top + source.height / 2 - (box.top + box.height / 2);
  const sx = Math.max(.28, Math.min(.92, source.width / box.width)), sy = Math.max(.28, Math.min(.92, source.height / box.height));
  const small = { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` };
  const full = { opacity: 1, transform: 'translate(0px, 0px) scale(1, 1)' };
  return printerConsole.animate(closing ? [full, small] : [small, full], { duration: closing ? 260 : 380, easing: closing ? 'cubic-bezier(.4,0,.6,1)' : 'cubic-bezier(.16,1,.3,1)' });
}
function showPrinterConsole(id, source) {
  const printer = (state.config.printers || []).find(p => p.id === id);
  activePrinterId = id;
  printerConsoleOrigin = (source || document.querySelector(`[data-printer-id="${CSS.escape(id)}"]`))?.getBoundingClientRect() || null;
  $('#printer-console-title').textContent = printer?.name || 'Printer controls';
  renderPrinterConsole();
  if (!printerConsole.open) { printerConsole.classList.remove('is-closing'); printerConsole.classList.add('is-opening'); printerConsole.showModal(); renderApprovals(); consoleMotion(printerConsoleOrigin)?.finished.catch(() => {}); }
}
async function closePrinterConsole() {
  if (!printerConsole.open || printerConsoleClosing) return;
  printerConsoleClosing = true; printerConsole.getAnimations().forEach(animation => animation.cancel());
  printerConsole.classList.remove('is-opening'); printerConsole.classList.add('is-closing');
  const source = document.querySelector(`[data-printer-id="${CSS.escape(activePrinterId || '')}"]`)?.getBoundingClientRect() || printerConsoleOrigin;
  try { await consoleMotion(source, true)?.finished; } catch {}
  printerConsole.close(); printerConsoleClosing = false; printerConsole.classList.remove('is-closing');
}
async function showSettings(tab = 'layout') {
  activeTab = tab==='widgets'?'layout':tab; renderSettings(); if (!dialog.open) { dialog.showModal(); renderApprovals(); }
}
function renderSettings() {
  $('#settings-title').textContent = activeTab === 'control' ? ((state.config.printers || []).find(p => p.id === activePrinterId)?.name || 'Printer controls') : 'Customize your deck';
  const tabs = $('#settings-tabs'), restoreTabFocus=tabs.contains(document.activeElement), previousScroll=tabs.scrollLeft; tabs.replaceChildren();
  for (const [id, name] of [['layout','Layout'], ['apps','Apps'], ['agents','Agents'], ['music','Music'], ['weather','Weather'], ['printers','Printers'], ['display','Display']]) {
    const selected = activeTab === id || (activeTab === 'control' && id === 'printers');
    const tab = button(name, () => { activeTab = id; renderSettings(); }, { className: `tab${selected ? ' active' : ''}` }); tab.setAttribute('aria-current', selected ? 'page' : 'false'); tabs.append(tab);
  }
  tabs.scrollLeft=previousScroll;
  if(restoreTabFocus)tabs.querySelector('[aria-current=page]')?.focus({preventScroll:true});
  const content = $('#settings-content'); content.replaceChildren();
  ({ layout: content=>window.EdgeLayoutUI.renderSettings(content,layoutContext()), widgets: settingsWidgets, apps: settingsApps, agents: settingsAgents, music: settingsMusic, weather: settingsWeather, printers: settingsPrinters, control: settingsPrinterControls, display: settingsDisplay })[activeTab](content);
}
function settingsAgents(content) {
  content.append(el('p', 'intro', 'See what Codex and Claude Code are doing, and answer Claude Code permission requests from this screen.'));
  const info = state.system?.claudeApprovals || { installed: false, error: null };
  const available = !preview && typeof bridge.setClaudeApprovals === 'function';
  const row = el('div', 'settings-row'); const copy = el('div');
  copy.append(el('p', 'settings-row-title', 'Approve Claude Code here'), el('small', '', 'Permission requests appear in Agent chats with Allow and Deny. In the Claude app you can still answer there; whichever answers first applies. If nobody answers here within about a minute, Claude Code asks you itself.'));
  const toggle = button('', async () => {
    toggle.disabled = true;
    try {
      const next = await bridge.setClaudeApprovals(!(state.system?.claudeApprovals?.installed === true));
      updateState(next); renderSettings();
      toast(next?.system?.claudeApprovals?.installed ? 'Claude Code requests will appear on Edge Deck' : 'Claude Code requests stay in Claude Code');
    } finally { if (toggle.isConnected) toggle.disabled = !available; }
  }, { className: 'toggle', label: 'Approve Claude Code here', disabled: !available });
  toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(info.installed === true));
  row.append(copy, toggle); content.append(row);
  if (info.error) content.append(el('p', 'form-error', info.error));
  content.append(el('div', 'notice', 'This adds Edge Deck\'s hook to your Claude Code settings (~/.claude/settings.json, backed up first); turning it off removes only that hook. Restart Claude Code sessions or the Claude app to apply it. In the terminal version, Claude Code may wait up to a minute for an answer here before asking itself.'));
  content.append(el('div', 'notice', 'Codex approvals can\'t be answered from Edge Deck. When a Codex chat waits for approval, Agent chats tells you to answer it in Codex.'));
}
function settingsWeather(content){content.append(el('p','intro','Choose your city and temperature units in Weather.'));content.append(button('Open Weather',()=>{dialog.close();showWeather();},{icon:'monitor'}));}
function settingsMusic(content) {
  musicSignature = JSON.stringify(state.spotify || {});
  if (window.EdgeMusicUI) window.EdgeMusicUI.render(content, { getState: () => state, bridge, updateState, toast });
  else content.append(el('p', 'notice', 'Music setup is unavailable. Reopen Edge Deck.'));
  settingsCanvas(content);
}
// Spotify Canvas: the looping videos behind songs in Spotify's apps. Not in
// Spotify's public API, so it uses the user's own web-player sign-in cookie.
function settingsCanvas(content) {
  const canvas = state.spotifyCanvas || { connected: false };
  const block = el('section', 'settings-item canvas-settings'); block.append(el('h3', '', 'Spotify Canvas videos'));
  block.append(el('p', 'settings-help', 'Plays the looping video some songs have in the Spotify app behind the music card. Canvas is not in Spotify\u2019s public API, so it uses your web player sign-in (the sp_dc cookie). It is unofficial and may stop working if Spotify changes it. The cookie is kept encrypted on this PC.'));
  if (canvas.connected) {
    const row = el('div', 'settings-row'); row.append(el('span', 'settings-row-title', canvas.error ? `Connected, but: ${canvas.error}` : 'Connected'));
    row.append(button('Remove', async () => { try { const next = await bridge.removeCanvas(); if (next?.config) updateState(next); renderSettings(); toast('Canvas sign-in removed'); } catch (error) { toast(error.message); } }, { className: 'button subtle' }));
    block.append(row); content.append(block); return;
  }
  const steps = el('ol', 'settings-steps');
  for (const step of ['In Edge or Chrome, sign in at open.spotify.com.', 'Press F12, open Application (in Edge it may be under the \u00BB menu), then Storage \u2192 Cookies \u2192 https://open.spotify.com.', 'Find the row named sp_dc, double-click its Value and copy it.', 'Paste it below and press Save. Close the developer tools.']) steps.append(el('li', '', step));
  block.append(steps);
  const form = el('form', 'settings-form');
  const value = field('sp_dc cookie', '', { type: 'password', required: true, autocomplete: 'off', placeholder: 'Paste the sp_dc value' });
  const submit = el('button', 'button primary', 'Save'); submit.type = 'submit'; const actions = el('div', 'form-actions'); actions.append(submit);
  form.append(value.label, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true;
    try { const next = await bridge.saveCanvas(value.input.value); value.input.value = ''; if (next?.config) updateState(next); renderSettings(); toast('Canvas connected'); }
    catch (error) { value.input.value = ''; toast(error.message); submit.disabled = false; }
  });
  block.append(form); content.append(block);
}
function settingsPrinterControls(content) {
  if (window.EdgePrinterUI) window.EdgePrinterUI.render(content, { printerId: activePrinterId, getState: () => state, bridge, updateState, toast });
  else content.append(el('p', 'notice', 'Printer controls are unavailable. Reopen Edge Deck.'));
}
function settingsWidgets(content) {
  content.append(el('p', 'intro', 'Choose what appears on your display. Move widgets left or right using the arrows; app shortcuts stay along the bottom.'));
  const widgets = state.config.widgets;
  widgets.forEach((widget, index) => {
    if (!widgetCatalog[widget.type]) return;
    const row = el('div', 'settings-row'); const label = el('div'); label.append(el('p', 'settings-row-title', widgetCatalog[widget.type][0]), el('small', '', widgetCatalog[widget.type][1])); const actions = el('div', 'row-actions');
    if (widget.type !== 'launchers') {
      const move = async direction => { const cfg = newConfig(); const other = index + direction; [cfg.widgets[index], cfg.widgets[other]] = [cfg.widgets[other], cfg.widgets[index]]; await saveConfig(cfg); renderSettings(); };
      actions.append(button('', () => move(-1), { className: 'quiet-button', icon: 'left', label: `Move ${widgetCatalog[widget.type][0]} left`, disabled: index === 0 || widgets[index - 1]?.type === 'launchers' }));
      actions.append(button('', () => move(1), { className: 'quiet-button', icon: 'right', label: `Move ${widgetCatalog[widget.type][0]} right`, disabled: index === widgets.length - 1 || widgets[index + 1]?.type === 'launchers' }));
    }
    const toggle = button('', async () => { const cfg = newConfig(); cfg.widgets[index].enabled = !isEnabled(widget); await saveConfig(cfg); renderSettings(); }, { className: 'toggle', label: `Show ${widgetCatalog[widget.type][0]}` }); toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(isEnabled(widget))); actions.append(toggle); row.append(label, actions); content.append(row);
  });
  content.append(el('div', 'notice', 'Your layout is saved automatically on this PC. You can add more app shortcuts in the Apps tab.'));
}
function field(labelText, value = '', options = {}) {
  const label = el('label', 'form-field'); label.append(el('span', '', labelText)); const input = el(options.options ? 'select' : 'input');
  if (options.options) for (const option of options.options) { const node = el('option', '', option.label || option); node.value = option.value || option; input.append(node); }
  else { input.type = options.type || 'text'; if (options.placeholder) input.placeholder = options.placeholder; input.autocomplete = options.autocomplete || 'off'; if (options.required) input.required = true; }
  input.value = value || ''; label.append(input); if (options.hint) label.append(el('small', '', options.hint)); return { label, input };
}
// Icon picker in Apps settings: search Iconify and choose an icon per app.
let iconPicker = { appId: null };
function refreshIconPicker() {
  if (!dialog.open || activeTab !== 'apps') return;
  const current = document.querySelector('#settings-content .icon-picker');
  const app = (state.config.launchers || []).find(item => item.id === iconPicker.appId);
  if (!current || !app) { renderSettings(); return; }
  const focused = current.contains(document.activeElement);
  const next = iconPickerPanel(app); current.replaceWith(next);
  if (focused) next.querySelector('input')?.focus();
}
async function searchPickerIcons() {
  const query = iconPicker.query || '';
  iconPicker.results = null; iconPicker.error = '';
  if (document.querySelector('#settings-content .icon-picker')) refreshIconPicker(); else renderSettings();
  try {
    const results = typeof bridge.searchIcons === 'function' ? await bridge.searchIcons(query) : [];
    if (iconPicker.query === query) iconPicker.results = results || [];
  } catch (error) { if (iconPicker.query === query) { iconPicker.results = []; iconPicker.error = error.message; } }
  refreshIconPicker();
}
async function chooseIcon(appId, iconId) {
  const cfg = newConfig(); const app = cfg.launchers.find(item => item.id === appId); if (!app) return;
  if (iconId) app.icon = iconId; else delete app.icon;
  await saveConfig(cfg);
  launcherKey = ''; renderLaunchers(); iconPicker = { appId: null }; renderSettings();
  toast(iconId ? `${app.name} icon updated` : `${app.name} uses its automatic icon`);
}
function iconPickerPanel(app) {
  const panel = el('div', 'icon-picker');
  const form = el('form', 'icon-picker-search'); const input = el('input'); input.type = 'search'; input.value = iconPicker.draft ?? iconPicker.query ?? '';
  input.addEventListener('input', () => { iconPicker.draft = input.value; });
  input.placeholder = 'Search icons, e.g. spotify'; input.setAttribute('aria-label', `Search icons for ${app.name}`); input.autocomplete = 'off';
  const search = el('button', 'button', 'Search'); search.type = 'submit'; form.append(input, search);
  form.addEventListener('submit', event => { event.preventDefault(); iconPicker.query = input.value.trim(); iconPicker.draft = undefined; searchPickerIcons(); });
  const grid = el('div', 'icon-picker-grid'); grid.setAttribute('aria-label', 'Icons');
  if (iconPicker.results === null) grid.append(el('p', 'empty-compact', 'Searching…'));
  else if (!iconPicker.results?.length) grid.append(el('p', 'empty-compact', iconPicker.error || 'No icons found. Try the brand or app name.'));
  else for (const result of iconPicker.results) {
    const choice = button('', () => chooseIcon(app.id, result.id), { className: 'icon-choice', label: `Use ${result.id.split(':')[1].replaceAll('-', ' ')} icon` });
    const image = el('img'); image.src = result.image; image.alt = ''; choice.append(image); choice.setAttribute('aria-pressed', String(app.icon === result.id)); grid.append(choice);
  }
  const footer = el('div', 'icon-picker-footer');
  footer.append(button('Automatic icon', () => chooseIcon(app.id, ''), { className: 'button' }), el('small', '', 'Clean white icons from the Iconify API: Simple Icons, Remix Icon and Material Design Icons.'));
  panel.append(form, grid, footer); return panel;
}
function settingsApps(content) {
  content.append(el('p', 'intro', 'Save Windows apps and websites for your cards and quick-launch dock.'));
  const dockShown=state.config.widgets.some(card=>card.type==='launchers'&&isEnabled(card));
  const dockRow=el('div','settings-row');dockRow.append(el('span','settings-row-title','Show app dock'));
  const dockToggle=button('',async()=>{const cfg=newConfig(),dock=cfg.widgets.find(card=>card.type==='launchers');if(dock)dock.enabled=!dockShown;else cfg.widgets.push({id:crypto.randomUUID(),type:'launchers',title:'Apps',enabled:true});await saveConfig(cfg);renderSettings();},{className:'toggle',label:'Show app dock'});
  dockToggle.setAttribute('role','switch');dockToggle.setAttribute('aria-checked',String(dockShown));dockRow.append(dockToggle);content.append(dockRow);
  for (const [index, app] of (state.config.launchers || []).entries()) {
    const row = el('div', 'settings-row app-row'); const preview = el('span', 'app-row-icon'); preview.dataset.iconKey = iconKey(app); preview.append(launcherIcon(app));
    const text = el('div'); text.append(el('p', 'settings-row-title', app.name), el('small', '', /^https:/i.test(app.target) ? app.target : app.target === 'spotify:' ? 'Spotify app' : 'Windows app'));
    const actions = el('div', 'row-actions');
    const change = button('Change icon', () => {
      iconPicker = iconPicker.appId === app.id ? { appId: null } : { appId: app.id, query: app.name, results: null };
      if (iconPicker.appId) searchPickerIcons(); else renderSettings();
    }, { className: 'button subtle' });
    change.setAttribute('aria-expanded', String(iconPicker.appId === app.id));
    actions.append(change, button('', async () => { const cfg = newConfig(); cfg.launchers.splice(index, 1); await saveConfig(cfg); renderSettings(); }, { className: 'quiet-button', icon: 'trash', label: `Remove ${app.name} shortcut` }));
    row.append(preview, text, actions); content.append(row);
    if (iconPicker.appId === app.id) content.append(iconPickerPanel(app));
  }
  const block = el('div', 'settings-block'); block.append(el('h3', '', 'Add an app'));
  block.append(button('Choose Windows app', async () => { const chosen = await bridge.chooseApp(); if (!chosen) return; const cfg = newConfig(); cfg.launchers.push({ id: crypto.randomUUID(), name: chosen.name || 'App', target: chosen.path }); await saveConfig(cfg); renderSettings(); toast('App added to your deck'); }, { icon: 'folder' }));
  const form = el('form', 'settings-block'); form.append(el('h3', '', 'Add a website'));
  const name = field('Name', '', { placeholder: 'e.g. ChatGPT', required: true }); const url = field('Website address', '', { type: 'url', placeholder: 'https://chatgpt.com', required: true }); form.append(name.label, url.label);
  const submit = el('button', 'button primary', 'Add website'); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', async event => {
    event.preventDefault(); const title = name.input.value.trim(); let target;
    try { target = new URL(url.input.value.trim()); } catch { toast('Enter a valid website address.'); return; }
    if (target.protocol !== 'https:' || !title) { toast('Use an HTTPS website address and enter a name.'); return; }
    submit.disabled = true;
    try { const cfg = newConfig(); cfg.launchers.push({ id: crypto.randomUUID(), name: title.slice(0, 60), target: target.href }); await saveConfig(cfg); renderSettings(); toast('Website added to your deck'); } catch (error) { toast(error.message); submit.disabled = false; }
  });
  block.append(form); content.append(block);
}
function settingsPrinters(content) {
  content.append(el('p', 'intro', 'Connect your Bambu printers on the same network. Find each printer’s IP address, serial number, and LAN access code in its network settings.'));
  if (preview) content.append(el('div', 'notice native-hint', 'This is the browser preview. Save printer connections in the desktop app.'));
  for (const config of state.config.printers || []) {
    const form = el('form', 'settings-item'); form.append(el('h3', '', config.name || config.model));
    const name = field('Printer name', config.name, { required: true });
    const model = field('Model', config.model, { options: ['H2D', 'P1S'] });
    const host = field('IP address or hostname', config.host, { placeholder: '192.168.1.100', required: true });
    const serial = field('Serial number', config.serial, { required: true });
    const access = field('LAN access code', '', { type: 'password', required: !config.configured, placeholder: config.configured ? 'Leave blank to keep the saved code' : 'Enter the printer’s access code', autocomplete: 'new-password' });
    form.append(name.label, model.label, host.label, serial.label, access.label);
    const trust = el('label', 'settings-row'); const trustLabel = el('span'); trustLabel.append(el('span', 'settings-row-title', 'Allow an unverified LAN certificate'), el('small', '', 'For a trusted local network. Certificate identity will not be verified.')); const check = el('input'); check.type = 'checkbox'; check.checked = config.allowSelfSigned === true; check.style.width = '24px'; check.style.height = '24px'; check.setAttribute('aria-label', 'Allow an unverified LAN certificate'); trust.append(trustLabel, check); form.append(trust);
    const controlRow = el('label', 'settings-row'); const controlLabel = el('span'); controlLabel.append(el('span', 'settings-row-title', 'Enable LAN controls'), el('small', '', 'Requires compatible firmware and LAN permissions. Some models require Developer Mode for remote commands.')); const control = el('input'); control.type = 'checkbox'; control.checked = config.controlAccess === true; control.style.width = '24px'; control.style.height = '24px'; controlRow.append(controlLabel, control); form.append(controlRow);
    const submit = el('button', 'button primary', config.configured ? 'Save connection' : 'Connect printer'); submit.type = 'submit'; const actions = el('div', 'form-actions'); actions.append(submit); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        const next = await bridge.savePrinter({ id: config.id, name: name.input.value.trim(), model: model.input.value, host: host.input.value.trim(), serial: serial.input.value.trim(), accessCode: access.input.value.trim(), allowSelfSigned: check.checked, controlAccess: control.checked });
        if (next?.config) updateState(next); else updateState(await bridge.getState());
        renderSettings(); toast('Printer connection saved');
      } catch (error) { toast(error.message); submit.disabled = false; }
    }); content.append(form);
  }
  content.append(el('div', 'notice', 'Available controls and camera access depend on your printer firmware, LAN permissions and current printer state.'));
  settingsBambuCloud(content);
}
// Bambu Lab account: the exact picture of each print from the cloud's print
// history, for printers that do not share their files (no storage inserted).
function settingsBambuCloud(content) {
  const cloud = state.bambuCloud || { connected: false };
  const block = el('section', 'settings-item'); block.append(el('h3', '', 'Bambu Lab account'));
  block.append(el('p', 'settings-help', 'Shows the exact picture of each print from your Bambu Lab print history, when the printer itself does not share its file. Your password goes to Bambu Lab only and is never saved; Edge Deck keeps the sign-in encrypted on this PC.'));
  if (cloud.connected) {
    const row = el('div', 'settings-row'); row.append(el('span', 'settings-row-title', `Signed in as ${cloud.account || 'your account'}`));
    row.append(button('Sign out', async () => { try { const next = await bridge.bambuSignOut(); if (next?.state) updateState(next.state); renderSettings(); toast('Signed out of Bambu Lab'); } catch (error) { toast(error.message); } }, { className: 'button subtle' }));
    block.append(row);
    if (cloud.error) block.append(el('div', 'notice', cloud.error));
    content.append(block); return;
  }
  const form = el('form', 'settings-form');
  const codeStep = cloud.awaiting === 'code' || cloud.awaiting === 'tfa';
  if (!codeStep) {
    const email = field('Email', '', { type: 'email', required: true, autocomplete: 'username' });
    const password = field('Password', '', { type: 'password', required: true, autocomplete: 'current-password' });
    const region = field('Region', 'Global', { options: ['Global', 'China'] });
    form.append(email.label, password.label, region.label);
    const submit = el('button', 'button primary', 'Sign in'); submit.type = 'submit'; const actions = el('div', 'form-actions'); actions.append(submit); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        const result = await bridge.bambuSignIn({ account: email.input.value.trim(), password: password.input.value, region: region.input.value === 'China' ? 'china' : 'global' });
        password.input.value = '';
        if (result?.state) updateState(result.state); renderSettings();
        toast(result?.status === 'signed-in' ? 'Signed in to Bambu Lab' : result?.message || 'Enter the code Bambu Lab sent you');
      } catch (error) { password.input.value = ''; toast(error.message); submit.disabled = false; }
    });
  } else {
    form.append(el('p', 'settings-help', cloud.awaiting === 'tfa' ? 'Enter the code from your authenticator app.' : 'Bambu Lab emailed you a sign-in code. Enter it here.'));
    const code = field('Code', '', { required: true, autocomplete: 'one-time-code', placeholder: '123456' }); code.input.inputMode = 'numeric';
    form.append(code.label);
    const submit = el('button', 'button primary', 'Verify'); submit.type = 'submit'; const actions = el('div', 'form-actions'); actions.append(submit); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = true;
      try { const result = await bridge.bambuVerify({ code: code.input.value.trim() }); if (result?.state) updateState(result.state); renderSettings(); toast('Signed in to Bambu Lab'); }
      catch (error) { toast(error.message); submit.disabled = false; }
    });
  }
  block.append(form); content.append(block);
}
// The version and updates from GitHub releases.
function settingsUpdates(content) {
  const update = state.update || { state: 'idle' };
  const row = el('div', 'settings-row update-row'); const copy = el('div');
  const text = { checking: 'Checking for updates…', current: 'Up to date', available: `Version ${update.latest} is available`, downloading: 'Downloading the update…', installing: 'Installing… Edge Deck restarts in a moment.', error: update.error || 'The update check failed.', idle: 'Updates are checked automatically.' }[update.state] || '';
  copy.append(el('p', 'settings-row-title', `Edge Deck ${update.current || ''}`.trim()), el('small', '', text));
  const actions = el('div', 'row-actions');
  if (update.state === 'available') {
    if (update.installable !== false) actions.append(button('Update now', async () => { try { const next = await bridge.installUpdate(); if (next?.config) updateState(next); renderSettings(); toast('Installing the update'); } catch (error) { toast(error.message); } }, { className: 'button primary' }));
    else copy.append(el('small', '', 'This copy runs from a source folder: update it with git pull.'));
    if (update.page) actions.append(button('Release notes', () => bridge.updateNotes().catch(error => toast(error.message)), { className: 'button subtle' }));
  }
  if (!['checking', 'downloading', 'installing'].includes(update.state)) actions.append(button('Check now', async () => { try { const next = await bridge.checkUpdate(); if (next?.config) updateState(next); renderSettings(); } catch (error) { toast(error.message); } }, { className: 'button subtle' }));
  row.append(copy, actions); content.append(row);
}
async function settingsDisplay(content) {
  content.append(el('p', 'intro', 'Place the deck on your XENEON EDGE, then enter full screen.'));
  settingsUpdates(content);
  const row = el('div', 'settings-row'); row.append(el('span', 'settings-row-title', '24-hour clock'));
  const toggle = button('', async () => { const cfg = newConfig(); cfg.clock24 = !cfg.clock24; await saveConfig(cfg); renderSettings(); }, { className: 'toggle', label: '24-hour clock' }); toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(state.config.clock24)); row.append(toggle); content.append(row);
  const power = powerInfo();
  const powerRow = el('div', 'settings-row'); const powerCopy = el('div');
  powerCopy.append(el('p', 'settings-row-title', 'Low power'), el('small', '', 'Stills the animated sky and text effects, and slows the agent orbs. Data keeps updating. Automatic does this while a game or other full-screen app is in front, or while the PC is locked.'));
  const powerChoices = el('div', 'power-control'); powerChoices.setAttribute('role', 'group'); powerChoices.setAttribute('aria-label', 'Low power');
  for (const [mode, label] of [['off', 'Off'], ['auto', 'Automatic'], ['on', 'On']]) {
    const choice = button(label, async () => { if (powerInfo().mode === mode) return; const cfg = newConfig(); cfg.power = { mode }; await saveConfig(cfg); syncPowerControls(); }, { className: 'button' });
    choice.dataset.powerMode = mode; choice.setAttribute('aria-pressed', String(power.mode === mode)); powerChoices.append(choice);
  }
  powerRow.append(powerCopy, powerChoices); content.append(powerRow);
  const powerStatus = el('p', `power-status${power.active ? ' is-active' : ''}`, powerStatusText(power));
  powerStatus.setAttribute('role', 'status'); content.append(powerStatus);
  const integration = state.system?.windowsIntegration || { supported: false };
  const desktopAvailable = integration.supported === true && typeof bridge.createDesktopShortcut === 'function';
  const startupAvailable = integration.supported === true && typeof bridge.setStartup === 'function';
  const startupRow = el('div', 'settings-row');
  const startupCopy = el('div'); startupCopy.append(el('p', 'settings-row-title', 'Start with Windows'), el('small', '', 'Open Edge Deck full screen when you sign in.'));
  const startupToggle = button('', async () => {
    startupToggle.disabled = true; startupToggle.setAttribute('aria-busy', 'true');
    try {
      const currentStartup = state.system?.windowsIntegration;
      const next = await bridge.setStartup(!Boolean(currentStartup?.startupShortcutPresent ?? currentStartup?.startupEnabled));
      updateState(next);
      if (dialog.open && activeTab === 'display') renderSettings();
      const saved = next?.system?.windowsIntegration;
      toast(['blocked_by_windows','unknown'].includes(saved?.startupStatus) ? saved.message : saved?.startupEnabled ? 'Edge Deck will open when you sign in' : 'Start with Windows is off');
    } finally {
      startupToggle.disabled = !startupAvailable; startupToggle.removeAttribute('aria-busy');
    }
  }, { className: 'toggle', label: 'Start with Windows', disabled: !startupAvailable });
  startupToggle.setAttribute('role', 'switch'); startupToggle.setAttribute('aria-checked', String((integration.startupShortcutPresent ?? integration.startupEnabled) === true));
  startupRow.append(startupCopy, startupToggle); content.append(startupRow);
  if (integration.message) content.append(el('p', 'notice', integration.message));
  const shortcutActions = el('div', 'form-actions');
  const shortcutButton = button('Create desktop shortcut', async () => {
    shortcutButton.disabled = true;
    try {
      const result = await bridge.createDesktopShortcut();
      if (result?.windowsIntegration) state.system = { ...state.system, windowsIntegration: result.windowsIntegration };
      toast('Edge Deck shortcut created on your desktop');
    } finally { shortcutButton.disabled = !desktopAvailable; }
  }, { icon: 'app', disabled: !desktopAvailable });
  shortcutActions.append(shortcutButton); content.append(shortcutActions);
  if (!integration.supported) content.append(el('p', 'empty-compact', 'Desktop shortcuts and startup settings are available in the Windows app.'));
  const actions = el('div', 'form-actions'); actions.append(button('Toggle full screen', () => bridge.fullscreen(), { icon: 'fullscreen' })); content.append(actions);
  const displays = el('div', 'settings-block'); displays.append(el('h3', '', 'Choose a display')); content.append(displays);
  if (preview) displays.append(el('p', 'empty-compact', 'Display selection is available in the desktop app.'));
  else {
    try {
      const available = await bridge.getDisplays(); if (!displays.isConnected) return;
      if (!available.length) displays.append(el('p', 'empty-compact', 'No displays reported. You can move this window manually.'));
      for (const display of available) {
        const choice = button('', async () => { await bridge.moveToDisplay(display.id); toast(`Moved to ${display.label || 'selected display'}`); }, { className: 'display-choice' });
        const label = el('span'); label.append(el('span', '', display.label || `Display ${display.id}`), el('small', '', `${display.width} × ${display.height}${display.isEdge ? ' · XENEON EDGE' : ''}`)); choice.append(label, icon('monitor')); displays.append(choice);
      }
    } catch (error) { displays.append(el('p', 'form-error', error.message)); }
  }
  content.append(el('div', 'notice', 'Use Esc to leave full screen. If touch controls a different monitor, assign touch input to the XENEON EDGE in Windows Tablet PC Settings.'));
}

$('#close-layout-editor').append(icon('close'));
$('#close-layout-editor').addEventListener('click',()=>$('#layout-editor').close());
$('#layout-editor').addEventListener('close',()=>{$('#layout-editor-content').replaceChildren();if(dialog.open&&activeTab==='layout')renderSettings();});
$('#edit-layout').addEventListener('click',()=>{editingLayout=!editingLayout;$('#edit-layout').textContent=editingLayout?'Done':'Edit layout';$('#edit-layout').setAttribute('aria-pressed',String(editingLayout));render();});
window.EdgeCardDrag.attach($('#widgets'),{onMove:moveCard,onError:error=>toast(error.message)});
// Card titles and options stay hidden until the top strip of a card is
// hovered with a mouse or tapped; keyboard focus and Edit layout show them too.
const chromeTimers=new WeakMap();
function showChrome(panel,hideAfter){
  panel.dataset.chrome='visible';clearTimeout(chromeTimers.get(panel));
  if(hideAfter)chromeTimers.set(panel,setTimeout(()=>{if(panel.dataset.chromeHover!=='true'&&!panel.querySelector(':scope > .card-toolbar:focus-within'))delete panel.dataset.chrome;},hideAfter));
}
const chromePanel=node=>node?.closest?.('.card-reveal,.card-toolbar')?.closest('.container-card');
$('#widgets').addEventListener('pointerover',event=>{if(event.pointerType!=='mouse')return;const panel=chromePanel(event.target);if(panel){panel.dataset.chromeHover='true';showChrome(panel);}});
$('#widgets').addEventListener('pointerout',event=>{
  if(event.pointerType!=='mouse')return;const panel=chromePanel(event.target);
  if(!panel||chromePanel(event.relatedTarget)===panel)return;
  delete panel.dataset.chromeHover;showChrome(panel,700);
});
$('#widgets').addEventListener('click',event=>{const panel=chromePanel(event.target);if(panel&&panel.dataset.chromeHover!=='true')showChrome(panel,4500);});
$('#widgets').addEventListener('focusout',event=>{const panel=chromePanel(event.target);if(panel)showChrome(panel,700);});
addEventListener('resize',()=>requestAnimationFrame(applyCardLayout));
$('#fullscreen').append(icon('fullscreen'));
$('#settings-icon').append(icon('settings'));
$('#close-settings').append(icon('close'));
$('#close-printer-console').append(icon('close'));
$('#close-weather').append(icon('close'));
$('#close-weather').addEventListener('click',()=>weatherDialog.close());
weatherDialog.addEventListener('close',()=>$('#weather-content').replaceChildren());
weatherDialog.addEventListener('click',event=>{if(event.target===weatherDialog){const bounds=weatherDialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)weatherDialog.close();}});
$('#close-printer-console').addEventListener('click', closePrinterConsole);
printerConsole.addEventListener('cancel', event => { event.preventDefault(); closePrinterConsole(); });
printerConsole.addEventListener('click', event => { if (event.target === printerConsole) { const box = printerConsole.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closePrinterConsole(); } });
printerConsole.addEventListener('close', () => $('#printer-console-content').replaceChildren());
dialog.addEventListener('close', () => $('#settings-content').replaceChildren());
for (const modal of [dialog, printerConsole, weatherDialog, $('#layout-editor')]) modal.addEventListener('close', () => { const notice = $('#toast'); if (notice?.parentElement === modal) document.body.append(notice); setTimeout(renderApprovals); });
$('#customize').addEventListener('click', () => showSettings());
$('#close-settings').addEventListener('click', () => dialog.close());
$('#fullscreen').addEventListener('click', async () => { try { await bridge.fullscreen(); } catch (error) { toast(error.message); } });
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
bridge.onState(updateState);
bridge.getState().then(updateState).catch(error => { render(); toast(`Could not load the dashboard: ${error.message}`); });
setInterval(() => { updateClock(); updateTaskTimers(); updateApprovalCountdown(); }, 1000);
