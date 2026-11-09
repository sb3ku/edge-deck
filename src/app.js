'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const preview = !window.edge;
const widgetCatalog = { today: ['Time & weather', 'Clock, date and live weather in one card'], clock: ['Clock & date', 'Your local time and date'], weather: ['Weather', 'Current conditions and forecasts for your city'], tasks: ['Agent chats', 'Working Codex and Claude Code chats'], printers: ['3D printers', 'Bambu Lab H2D and P1S'], media: ['Spotify', 'Recently played; Tall is the full player'], actions: ['Quick actions', 'Audio output, microphone and mute'], stats: ['PC stats', 'CPU, GPU, memory, busiest apps and internet speed'], gauge: ['Gauge', 'One ring: CPU, GPU, memory, video memory or a temperature'], switch: ['Switch', 'One quick control: Wi-Fi, Bluetooth, sound, microphone or dark mode'], timer: ['Timer', 'A countdown with presets'], machine: ['Printer', 'One printer at a glance'], calendar: ['Calendar', 'Your next events'], batteries: ['Batteries', 'Your devices\' charge'], reminders: ['Reminders', 'A checklist'], screentime: ['Screen Time', 'Your PC time today'], 'rain-wind': ['Weather details', 'The chance of rain and the wind'], 'daily-forecast': ['Daily forecast', 'The coming days'], 'sun-path': ['Sunrise and sunset', 'The sun today'], dial: ['Clock', 'The time on a clock face'], city: ['City clock', 'The time in another city'], 'world-clock': ['World clock', 'The time around the world'], launchers: ['App shortcuts', 'Your apps along the bottom'] };
// Widgets drawn by their own modules (widget-*.js), registered on window.EdgeWidgets.
const MODULE_TYPES = new Set(['batteries', 'reminders', 'screentime', 'calendar', 'gauge', 'switch', 'timer', 'machine', 'rain-wind', 'daily-forecast', 'sun-path', 'dial', 'city', 'world-clock']);
const defaultConfig = {
  clock24: true, theme: 'dark', layout: {mode:'widgets'},
  weather: { location: null, units: 'metric' }, music: { savedPlaylists: [] },
  widgets: Object.keys(widgetCatalog).filter(type => !MODULE_TYPES.has(type)).map(type => ({ id: type, type, title: widgetCatalog[type][0], enabled: true, ...(type==='launchers'?{}:{size:'medium',items:[{id:type+'-content',type}],activeItemId:type+'-content'}) })),
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
  gauge: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="m12 13 4-4"/>',
  switch: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="15" cy="12" r="2.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  settings: '<path d="m10 3 4 0 1 3 3 1 3-1 2 4-2 2v4l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-4l-2-2 2-4 3 1 3-1z" transform="translate(1 -1) scale(.91)"/><circle cx="12" cy="12" r="3"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  exitFullscreen: '<path d="M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tasks: '<path d="M6 3h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-5 3V5a2 2 0 0 1 2-2Z"/><path d="m8 11 3 3 5-6"/>',
  printer: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z"/><path d="M17 11h1"/>',
  stats: '<path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16v-3"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  playlists: '<path d="M3 5h15M3 10h15M3 15h8m5-1 5 3-5 3z"/>',
  previous: '<path d="M5 5v14M19 5 8 12l11 7z"/>',
  next: '<path d="M19 5v14M5 5l11 7-11 7z"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  volume: '<path d="M11 4 6 8H2v8h4l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><path d="M5 10h8v4H5z" fill="currentColor" stroke="none"/>',
  reminders: '<circle cx="5" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/><path d="M10 6h11M10 12h11M10 18h11"/>',
  hourglass: '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/>',
  actions: '<path d="M4 6h10M18 6h2M16 4v4M4 12h4M12 12h8M10 10v4M4 18h12M18 16v4"/>',
  app: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h0"/>',
  weather: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7Z"/>',
  camera: '<path d="M3 7h12v10H3Z"/><path d="m15 11 6-4v10l-6-4"/>',
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
// ---- Pages (home screens) -------------------------------------------------------
// Widgets live on pages, like iOS home screens: swipe left or right (the pages
// follow your finger and settle on the nearest one) or tap the dots. The page
// you look at is remembered.
let activePage = (() => { try { return sessionStorage.getItem('edge-deck-page') || ''; } catch { return ''; } })();
function pagesList() { return Array.isArray(state.config.pages) && state.config.pages.length ? state.config.pages : [{ id: 'home', name: 'Home' }]; }
function firstPageId() { return pagesList()[0].id; }
function currentPage() { return pagesList().some(page => page.id === activePage) ? activePage : firstPageId(); }
function pageIndex(id = currentPage()) { return Math.max(0, pagesList().findIndex(page => page.id === id)); }
const PAGE_GAP = 40;
function stillMotion() { return document.documentElement.classList.contains('low-power') || matchMedia('(prefers-reduced-motion: reduce)').matches; }
function placePages(offset = 0, animate = true) {
  const track = $('#widgets > .home-track'); if (!track) return;
  const width = $('#widgets').clientWidth || innerWidth;
  track.style.transition = !animate || stillMotion() ? 'none' : 'transform 480ms cubic-bezier(.2,.86,.24,1)';
  track.style.transform = `translate3d(${-pageIndex() * (width + PAGE_GAP) + offset}px,0,0)`;
  track.dataset.placed = `${pageIndex()}:${width}`;
  // Only the page in front takes taps and focus.
  for (const grid of track.children) { const front = grid.dataset.page === currentPage(); grid.dataset.current = String(front); grid.inert = !front; }
}
function showPage(id) {
  if (!pagesList().some(page => page.id === id)) return;
  const changed = id !== currentPage();
  activePage = id; try { sessionStorage.setItem('edge-deck-page', id); } catch {}
  placePages(0, true); renderPageTabs(); renderWidgetNotice();
  if (changed) { const live = $('#page-live'); if (live) live.textContent = `${pagesList()[pageIndex()].name}, page ${pageIndex() + 1} of ${pagesList().length}`; }
}
// Page dots, like iOS; in Edit Home Screen a + adds a page.
function renderPageTabs() {
  const nav = $('#page-tabs'); if (!nav) return;
  const pages = pagesList(), current = currentPage();
  const key = JSON.stringify([pages, current, editingLayout]); if (nav.dataset.key === key) return; nav.dataset.key = key;
  nav.replaceChildren();
  nav.hidden = pages.length < 2 && !(editingLayout && !preview);
  if (pages.length > 1) for (const [index, page] of pages.entries()) {
    const dot = el('button', `page-dot${page.id === current ? ' is-active' : ''}`); dot.type = 'button';
    dot.setAttribute('aria-label', `${page.name}, page ${index + 1} of ${pages.length}`); dot.setAttribute('aria-current', page.id === current ? 'page' : 'false'); dot.title = page.name;
    dot.append(el('i')); dot.addEventListener('click', () => showPage(page.id));
    nav.append(dot);
  }
  if (editingLayout && pages.length < 6 && !preview) nav.append(button('', addPageFromBar, { className: 'page-dot page-add', icon: 'plus', label: 'Add a page' }));
}
async function addPageFromBar() {
  const cfg = newConfig(); cfg.pages = structuredClone(pagesList());
  const id = `page-${crypto.randomUUID().slice(0, 8)}`;
  cfg.pages.push({ id, name: `Page ${cfg.pages.length + 1}` });
  try { await saveConfig(cfg); } catch (error) { toast(error.message); return; }
  showPage(id); toast('Page added. Tap + to add widgets, or drag a widget to the edge of the screen.');
}
// Swiping: a horizontal drag anywhere on the widgets moves the pages with the
// finger; a flick or a drag past a fifth of the screen turns the page.
let pageDrag = null, suppressSwipeClick = false;
const NO_PAGE_SWIPE = 'input, select, textarea, iframe, .printer-live, .emw-browse, .qa-list, .switch-list, [data-no-page-swipe]';
function startPagePointer(event) {
  if (pageDrag || !event.isPrimary || event.button > 0 || pagesList().length < 2 || $('#widgets').dataset.dragging === 'true' || event.target.closest(NO_PAGE_SWIPE)) return;
  pageDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false, offset: 0, samples: [[event.clientX, performance.now()]] };
}
function movePagePointer(event) {
  const drag = pageDrag; if (!drag || event.pointerId !== drag.id) return;
  if ($('#widgets').dataset.dragging === 'true') { pageDrag = null; placePages(0, true); return; }
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.started) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { pageDrag = null; return; }
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    drag.started = true; drag.x = event.clientX; cancelPress(); $('#widgets').dataset.paging = 'true';
    try { $('#widgets').setPointerCapture(event.pointerId); } catch {}
  }
  const moved = event.clientX - drag.x, index = pageIndex(), last = pagesList().length - 1;
  const pastEnd = (index === 0 && moved > 0) || (index === last && moved < 0);
  drag.offset = pastEnd ? moved * 0.3 : moved;
  drag.samples.push([event.clientX, performance.now()]); if (drag.samples.length > 6) drag.samples.shift();
  placePages(drag.offset, false);
}
function endPagePointer(event, cancelled) {
  const drag = pageDrag; if (!drag || event.pointerId !== drag.id) return; pageDrag = null;
  if (!drag.started) return;
  delete $('#widgets').dataset.paging;
  try { $('#widgets').releasePointerCapture(event.pointerId); } catch {}
  suppressSwipeClick = true; setTimeout(() => { suppressSwipeClick = false; }, 350);
  const [x0, t0] = drag.samples[0], velocity = (event.clientX - x0) / Math.max(1, performance.now() - t0);
  const width = $('#widgets').clientWidth || innerWidth, pages = pagesList(), index = pageIndex();
  const flick = Math.abs(velocity) > 0.45, far = Math.abs(drag.offset) > width * 0.2;
  let next = index;
  if (!cancelled && (flick || far)) next = index + ((flick ? velocity : drag.offset) < 0 ? 1 : -1);
  next = Math.max(0, Math.min(pages.length - 1, next));
  if (next !== index) showPage(pages[next].id); else placePages(0, true);
}
$('#widgets').addEventListener('pointerdown', startPagePointer, true);
document.addEventListener('pointermove', movePagePointer, { passive: true });
document.addEventListener('pointerup', event => endPagePointer(event, false), true);
document.addEventListener('pointercancel', event => endPagePointer(event, true), true);
document.addEventListener('keydown', event => {
  if (event.target.closest?.('input, select, textarea, dialog') || document.querySelector('dialog[open]')) return;
  if (event.key === 'PageDown' || event.key === 'PageUp') { const pages = pagesList(), next = pages[pageIndex() + (event.key === 'PageDown' ? 1 : -1)]; if (next) { event.preventDefault(); showPage(next.id); } }
  if (event.key === 'Escape' && editingLayout && !$('#widget-menu')) setEditing(false);
});
document.addEventListener('click', event => { if (suppressSwipeClick) { suppressSwipeClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
// Customize > Layout: pages and which page each card is on.
let pagesAssignOpen = false;
async function savePages(mutate) {
  const cfg = newConfig(); cfg.pages = structuredClone(pagesList());
  mutate(cfg);
  await saveConfig(cfg); renderPagesSettings();
}
function renderPagesSettings() {
  let slot = $('#settings-pages');
  const content = $('#settings-content');
  if (!slot) { slot = el('section', 'settings-pages'); slot.id = 'settings-pages'; slot.setAttribute('aria-label', 'Pages'); content.before(slot); }
  slot.hidden = activeTab !== 'layout';
  if (slot.hidden) { slot.replaceChildren(); return; }
  slot.replaceChildren();
  const pages = pagesList();
  const head = el('div', 'settings-pages-head'); head.append(el('h3', '', 'Pages'), el('small', '', 'Group widgets into screens. Swipe across the widgets or tap the dots at the bottom right to switch.'));
  slot.append(head);
  const list = el('div', 'settings-pages-list');
  pages.forEach((page, index) => {
    const row = el('div', 'settings-page-row');
    const name = el('input'); name.type = 'text'; name.value = page.name; name.maxLength = 24; name.setAttribute('aria-label', `Name of page ${index + 1}`);
    name.addEventListener('change', () => { const value = name.value.trim(); if (!value || value === page.name) { name.value = page.name; return; } savePages(cfg => { cfg.pages[index].name = value; }); });
    const count = (state.config.widgets || []).filter(w => w.type !== 'launchers' && (w.page || firstPageId()) === page.id).length;
    const meta = el('span', 'settings-page-count', `${count} ${count === 1 ? 'card' : 'cards'}`);
    const actions = el('div', 'row-actions');
    if (index > 0) actions.append(button('', () => savePages(cfg => { [cfg.pages[index - 1], cfg.pages[index]] = [cfg.pages[index], cfg.pages[index - 1]]; }), { className: 'icon-button', icon: 'left', label: `Move ${page.name} earlier` }));
    if (pages.length > 1) actions.append(button('', () => savePages(cfg => {
      const target = cfg.pages[index === 0 ? 1 : 0].id;
      for (const widget of cfg.widgets) if (widget.page === page.id) widget.page = target;
      cfg.pages.splice(index, 1);
    }), { className: 'icon-button', icon: 'trash', label: `Remove page ${page.name} (its cards move to another page)` }));
    row.append(name, meta, actions); list.append(row);
  });
  slot.append(list);
  if (pages.length < 6) slot.append(button('Add page', () => savePages(cfg => { cfg.pages.push({ id: `page-${crypto.randomUUID().slice(0, 8)}`, name: `Page ${cfg.pages.length + 1}` }); }), { className: 'button subtle', icon: 'plus' }));
  // Which page each card is on.
  const cards = (state.config.widgets || []).filter(w => w.type !== 'launchers');
  if (pages.length > 1 && cards.length) {
    const assign = el('details', 'settings-card-pages'); assign.open = pagesAssignOpen; assign.addEventListener('toggle', () => { pagesAssignOpen = assign.open; }); assign.append(el('summary', '', 'Choose the page for each card'));
    for (const card of cards) {
      const row = el('label', 'settings-card-page'); row.append(el('span', '', cardTitle(card)));
      const select = el('select'); select.setAttribute('aria-label', `Page for ${cardTitle(card)}`);
      for (const page of pages) { const option = el('option', '', page.name); option.value = page.id; option.selected = (card.page || firstPageId()) === page.id; select.append(option); }
      select.addEventListener('change', () => savePages(cfg => { const widget = cfg.widgets.find(w => w.id === card.id); if (widget) widget.page = select.value; }));
      row.append(select); assign.append(row);
    }
    slot.append(assign);
  }
}
async function saveConfig(config) {
  const pages = Array.isArray(config.pages) && config.pages.length ? config.pages : [{ id: 'home', name: 'Home' }];
  for (const widget of config.widgets || []) if (widget.type !== 'launchers' && !pages.some(page => page.id === widget.page)) widget.page = pages.some(page => page.id === activePage) ? activePage : pages[0].id;
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
  fullScreenButton.replaceChildren(icon(fullScreen ? 'exitFullscreen' : 'fullscreen'), document.createTextNode(fullScreenButton.title));
  $('#layout-done').hidden = !editingLayout; $('#widget-add').hidden = !editingLayout;
  renderLaunchers(); renderPageTabs(); renderCards(); renderApprovals(); updateClock(); updateTaskUsage(); drawAppSheet(); drawUsageSheet();
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
  const mode='widgets';
  container.dataset.layout=mode;
  let track=$(':scope > .home-track',container); if(!track){track=el('div','home-track');container.replaceChildren(track);}
  const pages=pagesList();
  // One grid per page, in page order.
  for(const grid of [...track.children])if(!pages.some(page=>page.id===grid.dataset.page))grid.remove();
  pages.forEach((page,index)=>{
    let grid=[...track.children].find(node=>node.dataset.page===page.id);
    if(!grid){grid=el('section','widgets page-grid');grid.dataset.page=page.id;}
    grid.dataset.layout=mode;grid.setAttribute('aria-label',`${page.name}, page ${index+1} of ${pages.length}`);grid.classList.toggle('is-jiggling',editingLayout);
    if(track.children[index]!==grid)track.insertBefore(grid,track.children[index]||null);
  });
  const gridFor=id=>[...track.children].find(node=>node.dataset.page===id)||track.children[0];
  const visible=state.config.widgets.filter(w=>isEnabled(w)&&w.type!=='launchers');
  const ids=new Set(visible.map(w=>w.id));
  for(const child of [...track.querySelectorAll(':scope > .page-grid > .container-card')])if(!ids.has(child.dataset.id))child.remove();
  for(const card of visible){
    const grid=gridFor(card.page||firstPageId());
    let panel=track.querySelector(`:scope > .page-grid > [data-id="${CSS.escape(card.id)}"]`);
    if(!panel){panel=el('section','widget container-card');panel.dataset.id=card.id;panel.dataset.cardId=card.id;grid.append(panel);shapeObserver.observe(panel);
      // Edit Home Screen: each widget jiggles a little out of step, like iOS.
      let hash=2166136261;for(const ch of card.id)hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;hash=Math.imul(hash^(hash>>>15),2246822507)>>>0;
      panel.style.setProperty('--jiggle-delay',`-${hash%270}ms`);panel.style.setProperty('--jiggle-duration',`${250+(hash>>>16)%50}ms`);}
    else if(panel.parentElement!==grid){if(typeof grid.moveBefore==='function')grid.moveBefore(panel,null);else grid.append(panel);}
    const items=cardItems(card), active=stackActive(card,items,panel),type=active?.type||'empty';
    panel.className=`widget container-card ${type}`;panel.dataset.widget=type;panel.dataset.size=card.size||'medium';panel.setAttribute('aria-label',cardTitle(card));
    panel.dataset.cardTitle=cardTitle(card);
    applyMood(panel,type,card,active);
    panel.toggleAttribute('data-opens',!!appViewFor(card,active));
    let toolbar=$('.card-toolbar',panel);
    const chromeKey=JSON.stringify([card.title,items,items.map(item=>state.config.launchers.find(app=>app.id===item.launcherId)?.name),editingLayout,mode,card.size]);
    if(!toolbar){toolbar=el('div','card-toolbar');panel.prepend(toolbar);}
    if(!$(':scope > .card-reveal',panel)){const reveal=el('div','card-reveal');reveal.setAttribute('aria-hidden','true');panel.prepend(reveal);}
    if(toolbar.dataset.key!==chromeKey){
      toolbar.dataset.key=chromeKey;toolbar.replaceChildren();
      const handle=button('',()=>toast('Hold this handle, then drag to move the card.'),{className:'quiet-button card-drag-handle',icon:'grip',label:`Move ${cardTitle(card)}`});handle.title='Hold and drag to move';
      const title=el('h2','card-title',cardTitle(card));
      toolbar.append(handle,title,button('',()=>showCardEditor(card.id),{className:'quiet-button card-edit-button',icon:'settings',label:`Edit ${cardTitle(card)} card`}));
      panel.querySelectorAll(':scope > .widget-remove, :scope > .widget-shield').forEach(node=>node.remove());
      if(editingLayout){
        // Edit Home Screen, like iOS: tap a widget to edit it, "–" to remove it, hold to move it.
        const shield=button('',()=>openWidgetEditor(card.id),{className:'widget-shield',label:`Edit ${cardTitle(card)} widget`});shield.title='Tap to edit, hold to move';
        const remove=button('',()=>removeWidget(card.id),{className:'widget-remove',icon:'minus',label:`Remove ${cardTitle(card)}`});
        panel.append(shield,remove);
      }
      $(':scope > .stack-dots',panel)?.remove();
      panel.toggleAttribute('data-stack',items.length>1);
      if(items.length>1){
        // A stack, like iOS: swipe up or down; dots show where you are.
        const dots=el('div','stack-dots');dots.setAttribute('aria-hidden','true');for(const item of items){const dot=el('i');dot.dataset.itemId=item.id;dots.append(dot);}panel.append(dots);
        panel.setAttribute('aria-roledescription','stack');
      }else panel.removeAttribute('aria-roledescription');
    }
    for(const dot of panel.querySelectorAll(':scope > .stack-dots > i'))dot.classList.toggle('is-active',dot.dataset.itemId===active?.id);
    if(items.length>1)panel.setAttribute('aria-label',`${cardTitle(card)}, ${widgetCatalog[active?.type]?.[0]||'widget'}, ${items.indexOf(active)+1} of ${items.length}. Swipe up or down for the others.`);
    const bodyIds=new Set(items.map(i=>i.id));if(!items.length)bodyIds.add('empty');
    for(const body of panel.querySelectorAll(':scope > .card-body'))if(!bodyIds.has(body.dataset.itemId))body.remove();
    for(const body of panel.querySelectorAll(':scope > .card-body'))if(!body.matches('.is-peeking, .is-leaving'))body.hidden=body.dataset.itemId!==(active?.id||'empty');
    let body=[...panel.children].find(n=>n.classList.contains('card-body')&&n.dataset.itemId===(active?.id||'empty'));
    if(!body){body=el('div','card-body');body.dataset.itemId=active?.id||'empty';body.id=`view-${card.id}-${active?.id||'empty'}`;panel.append(body);}
    body.hidden=false;body.setAttribute('role',items.length>1?'tabpanel':'group');body.setAttribute('aria-label',cardTitle(card));
    if(items.length>1)body.setAttribute('aria-labelledby',`tab-${card.id}-${active.id}`);else body.removeAttribute('aria-labelledby');
    const value=type==='clock'?state.config.clock24:type==='today'?[state.weather,state.config.weather,state.config.clock24]:type==='weather'?[state.weather,state.config.weather]:type==='tasks'?[taskRenderValue(state.tasks),(state.approvals||[]).map(request=>request.session)]:type==='printers'?[state.printers,state.config.printers]:type==='media'?[state.media,state.spotify,state.config.music,state.spotifyCanvas]:type==='actions'?[state.media?.audio,state.media?.volume,state.controls]:type==='stats'?[state.pc,state.system?.presence]:window.EdgeWidgets?.[type]?[window.EdgeWidgets[type].signature?.(widgetContext(card,active,panel))??null]:[active,state.config.launchers.find(app=>app.id===active?.launcherId)];
    const key=JSON.stringify([type,value,mode==='widgets'?card.size:'',mode]);
    if(body.dataset.renderKey!==key && !((['media','actions'].includes(type)||window.EdgeWidgets?.[type])&&body.contains(document.activeElement)&&document.activeElement?.matches('input[type="range"]')&&!document.activeElement.closest('[data-edge-media-root]'))){
      // Live widgets keep their DOM (animations, drafts, focus) and update in place.
      body.dataset.renderKey=key;
      const scroll=type==='tasks'?taskScroll(body):null;
      try{
        if(!['media','actions','today'].includes(type)&&!window.EdgeWidgets?.[type]?.live)body.replaceChildren();
        drawContent(body,card,active,panel,type);
        if(scroll)restoreTaskScroll(body,scroll);
      }catch(error){delete body.dataset.renderKey;console.error('A card could not be displayed; it will be redrawn on the next update.',error);} // a half-built card is retried
    }
  }
  for(const grid of track.children){
    visible.filter(card=>gridFor(card.page||firstPageId())===grid).forEach((card,index)=>{
      const panel=grid.querySelector(`:scope > [data-id="${CSS.escape(card.id)}"]`);
      if(panel&&grid.children[index]!==panel){const before=grid.children[index]||null;if(typeof grid.moveBefore==='function')grid.moveBefore(panel,before);else grid.insertBefore(panel,before);}
    });
    let hint=grid.querySelector(':scope > .page-empty');const empty=!grid.querySelector(':scope > .container-card');
    if(empty&&(editingLayout||!visible.length)){
      if(!hint){hint=el('div','page-empty');hint.append(el('h2','','This page is empty'),el('p','','Add widgets, or drag a widget to the edge of the screen to bring it here.'),button('Add widget',()=>openWidgetGallery(),{className:'button primary',icon:'plus'}));grid.append(hint);}
    }else hint?.remove();
  }
  applyCardLayout();
  const width=container.clientWidth||innerWidth;
  if(!pageDrag?.started&&track.dataset.placed!==`${pageIndex()}:${width}`)placePages(0,false);
}
function drawContent(body,card,active,panel,type=active?.type||'empty'){
  if(type==='app'||type==='website')renderAppContent(body,active);
  else if(type==='empty'){emptyContent(body,'plus','Your space, your way','Add a widget, an app or a website to this card.');body.append(button('Add content',()=>showCardEditor(card.id),{icon:'plus'}));}
  else if(window.EdgeWidgets?.[type])window.EdgeWidgets[type].render(body,widgetContext(card,active,panel));
  else ({clock:renderClock,today:renderToday,weather:renderWeather,tasks:renderTasks,printers:renderPrinters,media:renderMedia,actions:renderActions,stats:renderStats})[type]?.(body);
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
// Each card knows its shape (wide, tall or square) so its content can lay out
// to suit it; a stacked card is short.
function updateShape(panel){
  const box=panel.getBoundingClientRect(); if(!box.width||!box.height)return;
  const ratio=box.width/box.height;
  panel.dataset.shape=ratio>1.35?'wide':ratio<0.8?'tall':'square';
}
const shapeObserver=new ResizeObserver(entries=>{for(const entry of entries)updateShape(entry.target);});
// The grid's shape (8 × 2 cells on the deck), for previews and room checks.
let gridShape={columns:8,rows:2,cellWidth:300,cellHeight:300,gap:14};
// In Edit Home Screen: how many widgets do not fit on the page in front.
function renderWidgetNotice(){
  let note=$('#widget-notice');
  if(!note){note=el('p','widget-notice');note.id='widget-notice';note.setAttribute('role','status');$('#widgets').after(note);}
  const count=Number($(`#widgets .page-grid[data-page="${CSS.escape(currentPage())}"]`)?.dataset.overflow||0);
  note.hidden=!(editingLayout&&count>0);
  note.textContent=count===1?'1 widget does not fit on this page. Make something smaller, or drag it to another page.':`${count} widgets do not fit on this page. Make some smaller, or drag them to another page.`;
}
function applyCardLayout(){
  const track=$('#widgets > .home-track');if(!track)return;
  for(const grid of track.children){
    const panels=[...grid.querySelectorAll(':scope > .container-card')];
    const width=grid.clientWidth||$('#widgets').clientWidth||innerWidth,height=grid.clientHeight||$('#widgets').clientHeight||600;
    // Always 16 cells, like iOS: 8 × 2 on the deck, 4 × 4 in a narrow window; the cells scale.
    const columns=width>=1200?8:4,rows=columns===8?2:4;
    gridShape={columns,rows,gap:14,cellWidth:(width-14*(columns-1))/columns,cellHeight:(height-14*(rows-1))/rows};
    const plan=window.EdgeLayout.packWidgets(panels.map(p=>({id:p.dataset.id,type:p.dataset.widget,size:p.dataset.size})),{columns,rows});
    grid.style.setProperty('--widget-columns',columns);grid.style.setProperty('--widget-rows',rows);
    for(const panel of panels){const placement=plan.cards.find(c=>c.id===panel.dataset.id);
      if(placement){panel.style.gridColumn=`${placement.column} / span ${placement.columnSpan}`;panel.style.gridRow=`${placement.row} / span ${placement.rowSpan}`;panel.hidden=false;delete panel.dataset.overflow;}
      else{panel.style.gridColumn='';panel.style.gridRow='';panel.dataset.overflow='true';panel.hidden=!editingLayout;}}
    grid.dataset.overflow=String(plan.overflow.length);
  }
  renderWidgetNotice();
  requestAnimationFrame(()=>track.querySelectorAll('.container-card').forEach(updateShape));
}
// Whether a page's widgets fit its grid.
function fitsOnPage(cfg,pageId){
  const first=(Array.isArray(cfg.pages)&&cfg.pages[0]?.id)||firstPageId();
  const cards=cfg.widgets.filter(w=>w.type!=='launchers'&&isEnabled(w)&&(w.page||first)===pageId);
  return !window.EdgeLayout.packWidgets(cards.map(w=>({id:w.id,size:w.size})),{columns:gridShape.columns,rows:gridShape.rows}).overflow.length;
}
function pageName(id){return pagesList().find(page=>page.id===id)?.name||'another page';}
// ---- The widget gallery and Edit widget (src/widget-gallery.js) -----------------------------
// A live preview of a widget at one size, drawn by the same code as the cards.
function widgetPreview(type,size,item={}){
  const spans=window.EdgeLayout.WIDGET_SPANS[size]||window.EdgeLayout.WIDGET_SPANS.medium;
  const {cellWidth,cellHeight,gap}=gridShape;
  const width=Math.round(spans.columns*cellWidth+(spans.columns-1)*gap),height=Math.round(spans.rows*cellHeight+(spans.rows-1)*gap);
  const grid=el('div','widgets widget-preview-grid');grid.dataset.layout='widgets';grid.style.width=width+'px';grid.style.height=height+'px';
  grid.style.setProperty('--widget-columns',spans.columns);grid.style.setProperty('--widget-rows',spans.rows);
  const uid=crypto.randomUUID().slice(0,8),view={id:`preview-${uid}-content`,type,...item},card={id:`preview-${uid}`,type,title:'',enabled:true,size,items:[view],activeItemId:view.id};
  const panel=el('section',`widget container-card ${type}`);panel.dataset.widget=type;panel.dataset.size=size;panel.dataset.preview='true';panel.inert=true;
  panel.style.gridColumn=`1 / span ${spans.columns}`;panel.style.gridRow=`1 / span ${spans.rows}`;
  const body=el('div','card-body');panel.append(body);grid.append(panel);
  return{node:grid,width,height,draw:()=>{try{applyMood(panel,type,card,view);drawContent(body,card,view,panel,type);updateShape(panel);}catch(error){console.error('A widget preview could not be drawn.',error);}}};
}
function galleryContext(){return{getState:()=>state,el,button,icon,layout:window.EdgeLayout,stackShown:id=>stackShown.get(id),showInStack:(cardId,itemId)=>{stackShown.set(cardId,itemId);render();},preview:widgetPreview,addWidget,saveCard,removeWidget,fitsSize,pages:pagesList,currentPage,cardTitle,catalog:widgetCatalog,openCardEditor:showCardEditor,showSettings,toast};}
function openWidgetGallery(){closeDeckMenu();closeWidgetMenu();if(window.EdgeWidgetGallery)window.EdgeWidgetGallery.openGallery(galleryContext());}
function openWidgetEditor(id){closeWidgetMenu();if(window.EdgeWidgetGallery)window.EdgeWidgetGallery.openEditor(galleryContext(),id);}
// Adds a widget to the page in front, or the next page with room, or a new page.
async function addWidget(type,size,extra={},stack=null){
  const cfg=newConfig();cfg.pages=structuredClone(pagesList());
  if(cfg.widgets.filter(w=>w.type!=='launchers').length>=40)throw new Error('You have 40 widgets. Remove one to add another.');
  const id=`w-${crypto.randomUUID().slice(0,8)}`,item={id:`${id}-content`,type,...extra};
  const items=Array.isArray(stack)&&stack.length?stack.slice(0,6).map((entry,index)=>({id:`${id}-${index}`,...entry})):[item];
  const card={id,type:items[0].type,title:'',enabled:true,size,items,activeItemId:items[0].id};cfg.widgets.push(card);
  const order=[currentPage(),...cfg.pages.map(page=>page.id).filter(page=>page!==currentPage())];
  let page=order.find(candidate=>{card.page=candidate;return fitsOnPage(cfg,candidate);});
  if(!page){
    if(cfg.pages.length>=6)throw new Error('All six pages are full. Remove or shrink a widget first.');
    page=`page-${crypto.randomUUID().slice(0,8)}`;cfg.pages.push({id:page,name:`Page ${cfg.pages.length+1}`});
  }
  card.page=page;await saveConfig(cfg);showPage(page);
  const name=items.length>1?'Smart Stack':widgetCatalog[type]?.[0]||'Widget';
  toast(page===order[0]?`${name} added`:`${name} added to ${pageName(page)}`);
  requestAnimationFrame(()=>{const panel=document.querySelector(`.page-grid > [data-id="${CSS.escape(id)}"]`);if(panel&&!stillMotion())panel.animate([{transform:'scale(.6)',opacity:0},{transform:'scale(1.03)',opacity:1,offset:.7},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});});
  return id;
}
// Changes one widget; refused when it would not fit its page.
async function saveCard(id,mutate){
  const cfg=newConfig(),card=cfg.widgets.find(w=>w.id===id);if(!card)throw new Error('This widget was removed.');
  mutate(card,cfg);
  if(!fitsOnPage(cfg,card.page||firstPageId()))throw new Error('There is no room for that on this page.');
  await saveConfig(cfg);
}
function fitsSize(id,size,pageId){
  const cfg=newConfig(),card=cfg.widgets.find(w=>w.id===id);if(!card)return false;
  card.size=size;if(pageId)card.page=pageId;return fitsOnPage(cfg,card.page||firstPageId());
}
async function removeWidget(id){
  closeWidgetMenu();
  const card=state.config.widgets.find(w=>w.id===id);if(!card)return;
  if(!await confirmAction(`Remove ${cardTitle(card)}?`,'Removing a widget does not delete any of your data or connections.','Remove'))return;
  const cfg=newConfig();cfg.widgets=cfg.widgets.filter(w=>w.id!==id);await saveConfig(cfg);toast(`${cardTitle(card)} removed`);
}
// A small iOS-style alert; resolves true when confirmed.
function confirmAction(title,message,confirmLabel){
  return new Promise(resolve=>{
    const box=el('dialog','confirm-dialog');box.setAttribute('aria-label',title);
    const actions=el('div','confirm-actions'),no=el('button','button','Cancel'),yes=el('button','button danger',confirmLabel);no.type=yes.type='button';
    actions.append(no,yes);box.append(el('h2','',title),el('p','',message),actions);document.body.append(box);
    let result=false;no.addEventListener('click',()=>box.close());yes.addEventListener('click',()=>{result=true;box.close();});
    box.addEventListener('click',event=>{if(event.target===box)box.close();});
    // A toast shown while the alert was open lives in it; keep it when the alert goes.
    box.addEventListener('close',()=>{const notice=$('#toast');if(notice&&box.contains(notice))document.body.append(notice);box.remove();resolve(result);});box.showModal();no.focus();
  });
}
// ---- Opening a widget's "app", like iOS -----------------------------------------------
// Tapping a widget (not one of its own buttons) opens the full view of what it shows:
// the forecast for weather widgets, PC stats for a Gauge, the full Spotify player for
// Small and Medium music, the agenda for Calendar. The sheet zooms out of the widget.
const APP_VIEWS = {
  weather: () => ({ action: showWeather }), 'rain-wind': () => ({ action: showWeather }), 'daily-forecast': () => ({ action: showWeather }), 'sun-path': () => ({ action: showWeather }),
  gauge: () => ({ type: 'stats', title: 'PC stats' }),
  media: card => ['small', 'medium'].includes(card.size) ? { type: 'media', title: 'Spotify' } : null,
  calendar: () => ({ type: 'calendar', title: 'Calendar', item: { view: 'upnext' } }),
  batteries: card => card.size === 'large' ? null : { type: 'batteries', title: 'Batteries' },
  reminders: card => card.size === 'large' ? null : { type: 'reminders', title: 'Reminders' },
  screentime: card => card.size === 'large' ? null : { type: 'screentime', title: 'Screen Time' },
};
function appViewFor(card, item) { const view = APP_VIEWS[item?.type]; return view ? view(card, item) : null; }
let appSheet = null;
function openWidgetApp(card, item, source) {
  const view = appViewFor(card, item); if (!view) return false;
  if (view.action) { view.action(); return true; }
  if (!appSheet) {
    appSheet = el('dialog', 'app-sheet'); appSheet.id = 'app-sheet'; appSheet.setAttribute('aria-labelledby', 'app-sheet-title');
    appSheet.addEventListener('click', event => { if (event.target === appSheet) appSheet.close(); });
    appSheet.addEventListener('close', () => { const notice = $('#toast'); if (notice && appSheet.contains(notice)) document.body.append(notice); appSheet.replaceChildren(); delete appSheet.dataset.key; });
    document.body.append(appSheet);
  }
  const spans = window.EdgeLayout.WIDGET_SPANS.large, { cellWidth, cellHeight, gap } = gridShape;
  const width = Math.round(spans.columns * cellWidth + gap), height = Math.round(spans.rows * cellHeight + gap);
  const grid = el('div', 'widgets app-sheet-grid'); grid.dataset.layout = 'widgets'; grid.style.width = width + 'px'; grid.style.height = height + 'px';
  grid.style.setProperty('--widget-columns', 2); grid.style.setProperty('--widget-rows', 2);
  const viewItem = { id: `app-${view.type}-content`, type: view.type, ...(view.item || {}) };
  const viewCard = { id: `app-${view.type}`, type: view.type, title: '', enabled: true, size: 'large', items: [viewItem], activeItemId: viewItem.id };
  const panel = el('section', `widget container-card ${view.type}`); panel.dataset.widget = view.type; panel.dataset.size = 'large'; panel.dataset.app = 'true';
  panel.style.gridColumn = '1 / span 2'; panel.style.gridRow = '1 / span 2';
  const body = el('div', 'card-body'); panel.append(body); grid.append(panel);
  const title = el('h2', 'sr-only', view.title); title.id = 'app-sheet-title';
  const close = button('', () => appSheet.close(), { className: 'quiet-button app-sheet-close', icon: 'close', label: `Close ${view.title}` });
  appSheet.replaceChildren(title, grid, close); appSheet.dataset.type = view.type;
  appSheet.view = { card: viewCard, item: viewItem, panel, body };
  if (!appSheet.open) appSheet.showModal();
  drawAppSheet(true);
  // Zoom out of the widget, like iOS.
  const from = source?.getBoundingClientRect?.(), to = grid.getBoundingClientRect();
  if (from && to.width && !stillMotion()) grid.animate([{ transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${Math.min(from.width / to.width, from.height / to.height)})`, opacity: .6, borderRadius: '28px' }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.86,.24,1)' });
  close.focus({ preventScroll: true });
  return true;
}
// Keeps the open sheet current as the dashboard's state changes.
function drawAppSheet(force = false) {
  if (!appSheet?.open || !appSheet.view) return;
  const { card, item, panel, body } = appSheet.view, type = item.type;
  const key = JSON.stringify(window.EdgeWidgets?.[type]?.signature ? [type, window.EdgeWidgets[type].signature(widgetContext(card, item, panel))] : type === 'stats' ? [state.pc, state.system?.presence] : type === 'calendar' ? [state.calendar, state.config.clock24, Math.floor(Date.now() / 60000)] : type);
  if (!force && appSheet.dataset.key === key && type !== 'media') return;
  appSheet.dataset.key = key;
  try { if (type !== 'media') body.replaceChildren(); drawContent(body, card, item, panel, type); applyMood(panel, type, card, item); updateShape(panel); }
  catch (error) { console.error('The widget view could not be drawn.', error); }
}
// A tap on a widget (not on its own controls) opens its app.
const WIDGET_CONTROLS = 'button, a, input, select, textarea, label, iframe, [role=button], [role=switch], [role=slider], [contenteditable], .emw-rp-tile, .emw-rp-play';
document.addEventListener('click', event => {
  if (editingLayout || event.defaultPrevented) return;
  const panel = event.target.closest?.('.page-grid > .container-card'); if (!panel || event.target.closest(WIDGET_CONTROLS)) return;
  const card = state.config.widgets.find(w => w.id === panel.dataset.id); if (!card) return;
  const item = stackActive(card, cardItems(card), panel);
  if (openWidgetApp(card, item, panel)) event.preventDefault();
});
// Hold a widget: a menu like iOS (Edit widget, Edit Home Screen, its settings, Remove).
let widgetMenuPanel=null;
function openWidgetMenu(panel){
  closeWidgetMenu();
  const id=panel.dataset.id,card=state.config.widgets.find(w=>w.id===id);if(!card)return;
  const menu=el('div','widget-menu');menu.id='widget-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',`${cardTitle(card)} options`);
  const entry=(label,symbol,fn,extra='')=>{const node=button(label,()=>{closeWidgetMenu();return fn();},{className:`widget-menu-item ${extra}`,icon:symbol});node.setAttribute('role','menuitem');return node;};
  menu.append(entry('Edit widget','settings',()=>openWidgetEditor(id)),entry('Edit Home Screen','grip',()=>setEditing(true)));
  const tab=CARD_SETTINGS[panel.dataset.widget];
  if(tab)menu.append(entry(`${({music:'Music',weather:'Weather',printers:'Printer',agents:'Agent',display:'Display',apps:'App'})[tab]} settings`,'monitor',()=>showSettings(tab)));
  menu.append(entry('Remove widget','trash',()=>removeWidget(id),'is-danger'));
  document.body.append(menu);
  const box=panel.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
  let left=Math.min(innerWidth-width-12,Math.max(12,box.left+box.width/2-width/2)),top=box.bottom+10;
  if(top+height>innerHeight-12)top=box.top-height-10;
  if(top<12){top=Math.max(12,Math.min(innerHeight-height-12,box.top+box.height/2-height/2));left=box.right+12+width<innerWidth?box.right+12:Math.max(12,box.left-width-12);}
  menu.style.left=left+'px';menu.style.top=top+'px';
  panel.classList.add('is-menu-open');widgetMenuPanel=panel;menu.querySelector('button')?.focus();
}
function closeWidgetMenu(){$('#widget-menu')?.remove();widgetMenuPanel?.classList.remove('is-menu-open');widgetMenuPanel=null;}
document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('#widget-menu'))closeWidgetMenu();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#widget-menu')){const panel=widgetMenuPanel;closeWidgetMenu();panel?.focus?.();}});
// Edit Home Screen ends with a tap on an empty spot, like iOS (widgets, + and Done keep working).
document.addEventListener('click',event=>{
  if(!editingLayout||event.defaultPrevented||document.querySelector('dialog[open]'))return;
  const target=event.target;
  if(!target?.closest||target.closest('.container-card, button, a, input, select, textarea, label, [role=button], .deck-controls, #launchers, #page-tabs, #widget-menu'))return;
  if(!target.closest('.deck'))return;
  setEditing(false);
});
function setEditing(on){
  closeDeckMenu();closeWidgetMenu();editingLayout=!!on;editLayoutLabel();$('#edit-layout').setAttribute('aria-pressed',String(editingLayout));render();
  if(!editingLayout)void pruneEmptyPages();
}
// Leaving Edit Home Screen drops pages with nothing on them, like iOS (the first page stays).
async function pruneEmptyPages(){
  const pages=pagesList();if(pages.length<2)return;
  const used=new Set(state.config.widgets.filter(w=>w.type!=='launchers').map(w=>w.page||pages[0].id));
  const keep=pages.filter((page,index)=>index===0||used.has(page.id));
  if(keep.length===pages.length)return;
  const cfg=newConfig();cfg.pages=structuredClone(keep);
  try{await saveConfig(cfg);}catch{return;}
  if(!keep.some(page=>page.id===currentPage()))showPage(keep[0].id);
  const removed=pages.length-keep.length;toast(removed===1?'Empty page removed':`${removed} empty pages removed`);
}
function layoutContext(){return{getState:()=>state,bridge,updateState,toast,onEditCard:showCardEditor,onAddWidget:()=>openWidgetGallery(),onChooseApp:()=>{$('#layout-editor').close();showSettings('apps');},onClose:()=>$('#layout-editor').close()};}
function showCardEditor(id){window.EdgeLayoutUI.renderEditor($('#layout-editor-content'),{...layoutContext(),cardId:id});const editor=$('#layout-editor');if(!editor.open){editor.showModal();renderApprovals();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)editor.animate([{opacity:0,transform:'translateX(24px)'},{opacity:1,transform:'none'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});}}
async function moveCard(id,targetId,after,pageId,into){
  if(into&&targetId)return stackInto(id,targetId);
  const cfg=newConfig(),from=cfg.widgets.findIndex(w=>w.id===id);if(from<0||id===targetId)return;
  cfg.pages=structuredClone(pagesList());
  const target=targetId?cfg.widgets.find(w=>w.id===targetId):null;
  const page=(target?(target.page||firstPageId()):pageId)||cfg.widgets[from].page||firstPageId();
  const positions=new Map([...document.querySelectorAll('#widgets .page-grid > .container-card')].map(p=>[p.dataset.id,p.getBoundingClientRect()]));
  const [card]=cfg.widgets.splice(from,1),moved=(card.page||firstPageId())!==page;card.page=page;
  if(target){const index=cfg.widgets.findIndex(w=>w.id===targetId);cfg.widgets.splice(index+(after?1:0),0,card);}else cfg.widgets.push(card);
  if(moved&&!fitsOnPage(cfg,page))throw new Error(`There is no room on ${pageName(page)}. Make a widget smaller first.`);
  await saveConfig(cfg);
  if(!stillMotion())for(const panel of document.querySelectorAll('#widgets .page-grid > .container-card')){const old=positions.get(panel.dataset.id);if(!old||panel.dataset.id===id&&moved)continue;const next=panel.getBoundingClientRect();if(old.left===next.left&&old.top===next.top)continue;panel.animate([{transform:`translate(${old.left-next.left}px,${old.top-next.top}px)`},{transform:'none'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});}
  toast(moved?`${cardTitle(card)} moved to ${pageName(page)}`:`${cardTitle(card)} moved`);
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
// A card takes on a soft tint from what it shows, and glows when it needs you:
// the agent brand colour while one works, printer status colours, a warm tint
// when the PC runs hot. Music and weather keep their own artwork and skies.
const MOODS = { claude: '217 119 87', codex: '16 163 127', chatgpt: '167 139 250', print: '155 225 93', done: '48 209 88', paused: '255 214 10', error: '255 69 58', hot: '255 159 10' };
function applyMood(panel, type, card, item) {
  const { mood, attention } = moodFor(panel, type, card, item);
  if (mood) { panel.dataset.mood = mood; panel.style.setProperty('--mood', MOODS[mood]); } else { delete panel.dataset.mood; panel.style.removeProperty('--mood'); }
  panel.toggleAttribute('data-needs-you', attention);
}
function moodFor(panel, type, card, item) {
  let mood = '', attention = false;
  if (window.EdgeWidgets?.[type]?.mood) {
    const result = window.EdgeWidgets[type].mood(widgetContext(card, item, panel)) || {};
    mood = MOODS[result.mood] ? result.mood : ''; attention = !!result.attention;
  } else if (type === 'tasks') {
    const tasks = Array.isArray(state.tasks?.items) ? state.tasks.items : [];
    attention = tasks.some(item => item.approval) || (state.approvals || []).length > 0;
    const first = tasks.find(item => item.status === 'working') || tasks[0];
    if (first) mood = first.agent === 'Claude Code' ? 'claude' : first.agent === 'ChatGPT' ? 'chatgpt' : 'codex';
  } else if (type === 'printers') {
    const printers = state.printers || [];
    if (printers.some(p => p.status === 'error')) { mood = 'error'; attention = true; }
    else if (printers.some(p => p.status === 'paused')) { mood = 'paused'; attention = true; }
    else if (printers.some(p => p.status === 'printing')) mood = 'print';
    else if (printers.some(p => p.status === 'finished')) mood = 'done';
  } else if (type === 'stats') {
    if ((state.pc?.cpu?.temperature >= 85) || (state.pc?.gpu?.temperature >= 83)) mood = 'hot';
  }
  return { mood, attention };
}
// ---- Smart Stack ------------------------------------------------------------------------
// The widget a stack shows: the one you last swiped to (kept here and saved a
// moment later), turned to a widget that starts needing you when Smart Rotate is on.
const stackShown = new Map(), stackNeeds = new Map();
function stackActive(card, items, panel) {
  let id = stackShown.get(card.id) || card.activeItemId;
  if (items.length > 1 && card.rotate !== false) {
    const before = stackNeeds.get(card.id) || {}, now = {};
    for (const item of items) { try { now[item.id] = moodFor(panel, item.type, card, item).attention; } catch { now[item.id] = false; } }
    stackNeeds.set(card.id, now);
    const shown = items.find(item => item.id === id) || items[0];
    const rising = items.find(item => now[item.id] && !before[item.id]);
    if (rising && !now[shown.id] && rising.id !== shown.id) { id = rising.id; stackShown.set(card.id, id); flashStackDots(card.id); }
  }
  return items.find(item => item.id === id) || items[0];
}
function flashStackDots(cardId) {
  requestAnimationFrame(() => { const dots = document.querySelector(`.page-grid > [data-id="${CSS.escape(cardId)}"] > .stack-dots`); if (!dots) return; dots.classList.add('is-visible'); clearTimeout(dots.hideTimer); dots.hideTimer = setTimeout(() => dots.classList.remove('is-visible'), 1600); });
}
let stackSaveTimer = null;
// Shows the next (1) or previous (-1) widget of a stack, sliding like iOS.
function turnStack(panel, direction) {
  const card = state.config.widgets.find(w => w.id === panel.dataset.id); if (!card) return false;
  const items = cardItems(card), current = stackActive(card, items, panel), index = items.indexOf(current), next = items[index + direction];
  if (!next) return false;
  const outgoing = panel.querySelector(`:scope > .card-body[data-item-id="${CSS.escape(current.id)}"]`);
  stackShown.set(card.id, next.id); renderCards(); flashStackDots(card.id);
  const incoming = panel.querySelector(`:scope > .card-body[data-item-id="${CSS.escape(next.id)}"]`);
  if (!stillMotion() && outgoing && incoming && outgoing !== incoming) {
    const height = panel.clientHeight || 300, easing = 'cubic-bezier(.2,.86,.24,1)';
    outgoing.hidden = false; outgoing.classList.add('is-leaving');
    outgoing.animate([{ transform: `translateY(${outgoing.dataset.offset || 0}px)`, opacity: 1 }, { transform: `translateY(${-direction * height}px)`, opacity: 0 }], { duration: 380, easing }).finished.catch(() => {}).then(() => { outgoing.classList.remove('is-leaving'); outgoing.style.transform = ''; if (outgoing.dataset.itemId !== stackShown.get(card.id)) outgoing.hidden = true; });
    const peeked = incoming.dataset.offset !== undefined, start = peeked ? Number(incoming.dataset.offset) : direction * height; delete incoming.dataset.offset;
    incoming.style.transform = '';
    incoming.animate([{ transform: `translateY(${start}px)`, opacity: peeked ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing });
  }
  delete (outgoing || {}).dataset?.offset;
  clearTimeout(stackSaveTimer);
  stackSaveTimer = setTimeout(async () => { const cfg = newConfig(), target = cfg.widgets.find(w => w.id === card.id); if (!target || target.activeItemId === stackShown.get(card.id)) return; target.activeItemId = stackShown.get(card.id); try { await saveConfig(cfg); } catch {} }, 1200);
  return true;
}
// Swipe up or down on a stack (not while editing); the widget follows the finger.
let stackDrag = null;
document.addEventListener('pointerdown', event => {
  if (editingLayout || !event.isPrimary || event.button > 0 || event.target.closest?.('input, select, textarea, iframe, .printer-live, .emw-browse, [data-no-stack-swipe]')) return;
  const panel = event.target.closest?.('.page-grid > .container-card[data-stack]'); if (!panel) return;
  stackDrag = { panel, id: event.pointerId, x: event.clientX, y: event.clientY, started: false, offset: 0, at: performance.now() };
}, true);
document.addEventListener('pointermove', event => {
  const drag = stackDrag; if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.started) {
    if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) { stackDrag = null; return; }
    if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    drag.started = true; drag.y = event.clientY; cancelPress(); drag.panel.classList.add('is-stack-dragging');
    drag.body = drag.panel.querySelector(':scope > .card-body:not([hidden])');
    drag.panel.querySelector(':scope > .stack-dots')?.classList.add('is-visible');
    try { drag.panel.setPointerCapture(event.pointerId); } catch {}
  }
  const card = state.config.widgets.find(w => w.id === drag.panel.dataset.id), items = card ? cardItems(card) : [];
  const index = items.indexOf(stackActive(card, items, drag.panel)), moved = event.clientY - drag.y;
  const pastEnd = (index === 0 && moved > 0) || (index === items.length - 1 && moved < 0);
  drag.offset = pastEnd ? moved * 0.3 : moved;
  if (drag.body) { drag.body.style.transform = `translateY(${drag.offset}px)`; drag.body.style.opacity = String(Math.max(.35, 1 - Math.abs(drag.offset) / ((drag.panel.clientHeight || 300) * 1.4))); }
  // The neighbour in the direction of the swipe peeks in.
  const neighbour = drag.offset === 0 || pastEnd ? null : items[index + (drag.offset < 0 ? 1 : -1)];
  if (drag.peek && drag.peek.dataset.itemId !== neighbour?.id) { drag.peek.classList.remove('is-peeking'); drag.peek.style.transform = ''; drag.peek.hidden = true; drag.peek = null; }
  if (neighbour) {
    drag.peek = drag.peek || stackBody(drag.panel, card, neighbour);
    const height = drag.panel.clientHeight || 300;
    drag.peek.style.transform = `translateY(${drag.offset + (drag.offset < 0 ? height : -height)}px)`;
  }
}, { passive: true });
// A widget of a stack drawn ahead of time (for the peek), reused when it is shown.
function stackBody(panel, card, item) {
  let body = panel.querySelector(`:scope > .card-body[data-item-id="${CSS.escape(item.id)}"]`);
  if (!body) {
    body = el('div', 'card-body'); body.dataset.itemId = item.id; body.id = `view-${card.id}-${item.id}`; panel.append(body);
    try { drawContent(body, card, item, panel, item.type); } catch (error) { console.error('A stacked widget could not be drawn ahead of time.', error); }
  }
  body.hidden = false; body.classList.add('is-peeking');
  return body;
}
function endStackDrag(event, cancelled) {
  const drag = stackDrag; if (!drag || event.pointerId !== drag.id) return; stackDrag = null;
  if (!drag.started) return;
  drag.panel.classList.remove('is-stack-dragging');
  try { drag.panel.releasePointerCapture(event.pointerId); } catch {}
  suppressSwipeClick = true; setTimeout(() => { suppressSwipeClick = false; }, 350);
  const velocity = drag.offset / Math.max(1, performance.now() - drag.at), far = Math.abs(drag.offset) > (drag.panel.clientHeight || 300) * 0.18;
  const direction = drag.offset < 0 ? 1 : -1;
  if (drag.body) { drag.body.dataset.offset = String(drag.offset); drag.body.style.opacity = ''; }
  const peek = drag.peek; drag.peek = null;
  if (peek) { peek.dataset.offset = peek.style.transform.match(/-?[\d.]+/)?.[0] || '0'; peek.classList.remove('is-peeking'); }
  if (cancelled || !(far || Math.abs(velocity) > 0.5) || !turnStack(drag.panel, direction)) {
    if (peek) { const from = Number(peek.dataset.offset) || 0, height = drag.panel.clientHeight || 300; peek.style.transform = ''; delete peek.dataset.offset; peek.hidden = true; if (!stillMotion()) { peek.hidden = false; peek.classList.add('is-leaving'); peek.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${from < 0 ? -height : height}px)` }], { duration: 300, easing: 'cubic-bezier(.2,.86,.24,1)' }).finished.catch(() => {}).then(() => { peek.classList.remove('is-leaving'); if (peek.dataset.itemId !== stackShown.get(drag.panel.dataset.id)) peek.hidden = true; }); } }
    if (drag.body) { const from = drag.offset; drag.body.style.transform = ''; delete drag.body.dataset.offset; if (!stillMotion()) drag.body.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.86,.24,1)' }); }
    flashStackDots(drag.panel.dataset.id);
  } else if (drag.body) drag.body.style.transform = '';
}
document.addEventListener('pointerup', event => endStackDrag(event, false), true);
document.addEventListener('pointercancel', event => endStackDrag(event, true), true);
// Keyboard: Arrow Up and Down turn a stack that has focus.
document.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.target.closest?.('input, select, textarea, dialog')) return;
  const panel = event.target.closest?.('.page-grid > .container-card[data-stack]'); if (!panel) return;
  if (turnStack(panel, event.key === 'ArrowDown' ? 1 : -1)) event.preventDefault();
});
// Drop a widget onto another to stack them (up to six; the stack keeps the sizes they share).
async function stackInto(id, targetId) {
  const cfg = newConfig(), source = cfg.widgets.find(w => w.id === id), target = cfg.widgets.find(w => w.id === targetId);
  if (!source || !target || id === targetId) return;
  const items = [...cardItems(target), ...cardItems(source)];
  if (items.length > 6) throw new Error('A stack holds up to six widgets.');
  const types = items.map(item => item.type), allowed = window.EdgeLayout.allowedSizes(types);
  if (!allowed.includes(target.size)) throw new Error(`These widgets do not share the ${target.size} size, so they cannot stack.`);
  target.items = items; target.activeItemId = cardItems(source)[0]?.id || target.activeItemId;
  cfg.widgets = cfg.widgets.filter(w => w.id !== id);
  stackShown.set(target.id, target.activeItemId);
  await saveConfig(cfg); flashStackDots(target.id);
  toast(`Stack made: ${items.length} widgets. Swipe up or down to flip through them.`);
}
function canStack(id, targetId) {
  const source = state.config.widgets.find(w => w.id === id), target = state.config.widgets.find(w => w.id === targetId);
  if (!source || !target || id === targetId) return false;
  const items = [...cardItems(target), ...cardItems(source)];
  return items.length <= 6 && window.EdgeLayout.allowedSizes(items.map(item => item.type)).includes(target.size);
}
// What a widget module gets: its card and view, the helpers the built-in cards
// use, and a way to save the view's own options (which reading, which printer).
// A module registers window.EdgeWidgets[type] = { render(body, ctx), signature?(ctx),
// mood?(ctx) -> { mood, attention }, live?: true (keeps its DOM between renders) }.
function widgetContext(card, item, panel) {
  return {
    card, item: item || {}, panel, size: card.size || 'medium', mode: 'widgets',
    state: () => state, config: () => state.config, bridge, updateState, toast,
    el, button, icon, badge, header, emptyContent, glide, statRing, printerRing, printerRow, printerLabels, printerFigure, printProgress, filamentSpools, showPrinterConsole, showSettings, PRINTER_FINISHED_MS,
    gigabytes, uptimeText, durationText, agoText,
    clock24: () => state.config.clock24 !== false, showWeather,
    lowPower: () => document.documentElement.classList.contains('low-power'),
    editCard: () => showCardEditor(card.id),
    openApp: () => openWidgetApp(card, item, panel),
    refreshMood: () => applyMood(panel, item?.type || card.type, card, item),
    saveItem: async patch => { const cfg = newConfig(); const target = cfg.widgets.find(w => w.id === card.id)?.items?.find(i => i.id === item?.id); if (!target) return; Object.assign(target, patch); await saveConfig(cfg); },
  };
}
// Bars and rings move from their previous value instead of jumping.
const lastValues = new Map();
function glide(key, node, property, value) {
  const before = lastValues.get(key); lastValues.set(key, value);
  if (before === undefined || before === value || document.documentElement.classList.contains('low-power')) { node.style[property] = value; return; }
  node.style[property] = before;
  requestAnimationFrame(() => requestAnimationFrame(() => { node.style[property] = value; }));
}
function renderClock(panel) {
  panel.append(el('p', 'clock-day'), el('p', 'clock-time'), el('p', 'clock-date'), el('div', 'up-next'));
  const bottom = el('div', 'clock-bottom'); bottom.append(icon('clock'), document.createTextNode(Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' '))); panel.append(bottom);
}
function updateClock() {
  for (const card of document.querySelectorAll('.today-card')) window.EdgeWeatherUI?.tickToday(card, state.config.clock24 !== false);
  const now = new Date();
  for (const panel of document.querySelectorAll('.widget.clock .card-body:not([hidden])')) {
    // A stack mid-flip briefly shows its other widget in a clock card: only clocks tick.
    if (!panel.querySelector(':scope > .clock-time')) continue;
    $('.clock-day', panel).textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(now);
    $('.clock-date', panel).textContent = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !state.config.clock24 }).formatToParts(now);
    const time = $('.clock-time', panel); time.replaceChildren();
    for (const part of parts) { if (part.type === 'dayPeriod') time.append(el('span', '', part.value)); else time.append(document.createTextNode(part.value)); }
    renderUpNext($('.up-next', panel));
  }
}
// Up next: what is coming, from what Edge Deck already knows: an agent that
// needs you, prints and when they finish, working agents, and the next change
// in the weather. At most four lines; the most urgent first.
function clockText(date) { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !state.config?.clock24 }); }
function upNextItems() {
  const items = [];
  const tasks = Array.isArray(state.tasks?.items) ? state.tasks.items : [];
  const asking = tasks.filter(item => item.approval || (item.agent === 'Claude Code' && (state.approvals || []).some(request => `claude-${request.session}` === item.id)));
  for (const item of asking.slice(0, 1)) items.push({ symbol: 'warning', tone: 'attention', title: `${item.agent} needs your OK`, detail: item.title || item.project || '' });
  for (const printer of state.printers || []) {
    const config = (state.config.printers || []).find(p => p.id === printer.id);
    const name = printer.accountName || printer.name || config?.name || 'Printer';
    if (printer.status === 'printing' && Number.isFinite(printer.progress)) {
      const done = Number.isFinite(printer.remainingMinutes) && printer.remainingMinutes > 0 ? clockText(new Date(Date.now() + printer.remainingMinutes * 60000)) : '';
      items.push({ symbol: 'printer', tone: 'print', title: done ? `${name} done at ${done}` : `${name} printing`, detail: `${Math.round(printer.progress)}%${printer.jobName ? ` · ${printer.jobName}` : ''}`, progress: printer.progress });
    } else if (printer.status === 'paused') items.push({ symbol: 'printer', tone: 'attention', title: `${name} paused`, detail: Number.isFinite(printer.progress) ? `At ${Math.round(printer.progress)}%` : '' });
    else if (printer.status === 'error') items.push({ symbol: 'printer', tone: 'attention', title: `${name} needs attention`, detail: printer.jobName || '' });
  }
  const working = tasks.filter(item => item.status === 'working' && !asking.includes(item));
  if (working.length) items.push({ symbol: 'tasks', tone: 'agent', title: working.length === 1 ? `${working[0].agent} is working` : `${working.length} agents working`, detail: working[0].activityLabel || working[0].title || '' });
  const weather = state.weather;
  const describe = code => window.EdgeWeatherUI?.condition?.(code) || ['', 'unknown'];
  if (weather?.current && Array.isArray(weather.hourly)) {
    const nowKind = describe(weather.current.conditionCode)[1];
    const wet = kind => ['rain', 'snow', 'storm'].includes(kind);
    const upcoming = weather.hourly.filter(hour => Date.parse(hour.time) > Date.now()).slice(0, 12);
    const change = upcoming.find(hour => wet(describe(hour.conditionCode)[1]) !== wet(nowKind));
    if (change) {
      const [label, kind] = describe(change.conditionCode);
      items.push({ symbol: 'weather', tone: 'weather', title: wet(kind) ? `${label} around ${clockText(new Date(change.time))}` : `Dry from ${clockText(new Date(change.time))}`, detail: Number.isFinite(change.temp) ? `${Math.round(change.temp)}°` : '' });
    } else if (upcoming.length) {
      const coldest = upcoming.slice(0, 6).reduce((low, hour) => (Number.isFinite(hour.temp) && (!low || hour.temp < low.temp) ? hour : low), null);
      if (coldest && Number.isFinite(weather.current.temp) && weather.current.temp - coldest.temp >= 3) items.push({ symbol: 'weather', tone: 'weather', title: `Down to ${Math.round(coldest.temp)}° by ${clockText(new Date(coldest.time))}`, detail: describe(coldest.conditionCode)[0] });
      else items.push({ symbol: 'weather', tone: 'weather', title: `${describe(weather.current.conditionCode)[0]} for now`, detail: Number.isFinite(weather.current.temp) ? `${Math.round(weather.current.temp)}° now` : '' });
    }
  }
  return items.slice(0, 4);
}
function renderUpNext(node) {
  if (!node) return;
  const items = upNextItems();
  const signature = JSON.stringify(items);
  if (node.dataset.signature === signature) return;
  node.dataset.signature = signature;
  node.replaceChildren();
  if (!items.length) return;
  node.append(el('p', 'up-next-title', 'Up next'));
  for (const item of items) {
    const row = el('div', `up-next-item is-${item.tone}`);
    const mark = el('span', 'up-next-icon'); mark.append(icon(item.symbol));
    const copy = el('div', 'up-next-copy'); copy.append(el('span', 'up-next-main', item.title));
    if (item.detail) copy.append(el('span', 'up-next-detail', item.detail));
    if (Number.isFinite(item.progress)) { const bar = el('span', 'up-next-bar'); const fill = el('i'); fill.style.width = `${Math.max(2, Math.min(100, item.progress))}%`; bar.append(fill); copy.append(bar); }
    row.append(mark, copy); node.append(row);
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
  const list = panel.querySelector('.task-list'); if (list) requestAnimationFrame(() => fitTaskList(list));
}
// Only whole chat cards show (none cut off at the bottom): when the first one is
// too tall its step list goes, then cards that do not fit are left out and counted.
function fitTaskList(list) {
  if (!list.isConnected || !list.clientHeight) return;
  const rows = [...list.children].filter(node => node.classList.contains('task'));
  const fits = row => row.offsetTop - list.offsetTop + row.offsetHeight <= list.clientHeight + 1;
  if (rows[0] && !fits(rows[0])) for (const extra of rows[0].querySelectorAll('.task-steps, .task-bg, .task-progress-message')) extra.hidden = true;
  let hidden = 0;
  for (const row of rows.slice(1)) if (hidden || !fits(row)) { row.hidden = true; hidden++; }
  list.parentElement?.querySelector(':scope > .task-list-more')?.remove();
  if (hidden) list.after(el('p', 'task-list-more', `+ ${hidden} more ${hidden === 1 ? 'chat' : 'chats'}`));
}
// Plan usage at the foot of the card: a ring per agent with the 5-hour session's
// used share, like the ring in the Claude app; a tap opens every limit window.
// Codex records its limits as it works; Claude's come from Anthropic's usage
// endpoint with the Claude Code sign-in on this PC (Customize → Agents), and
// Claude Code's logs add a limit when one is reached.
const USAGE_AGENTS = { claude: 'Claude', codex: 'Codex' };
function usageWindows(agent) {
  const usage = state.tasks?.usage?.[agent]; if (!usage) return [];
  const windows = (usage.windows || []).map(window => ({ ...window }));
  if (agent === 'claude' && usage.limit) {
    const id = usage.limit.type === 'seven_day' ? 'weekly' : 'session', hit = windows.find(window => window.id === id);
    if (hit) { hit.usedPercent = 100; hit.resetsAt = hit.resetsAt || usage.limit.resetsAt; }
    else windows.unshift({ id, label: id === 'weekly' ? 'Weekly' : '5-hour', usedPercent: 100, resetsAt: usage.limit.resetsAt });
  }
  return windows;
}
function usageTone(percent) { return percent >= 100 ? 'is-full' : percent >= 80 ? 'is-warning' : ''; }
let usageSheet = null;
function openUsageSheet(agent, source) {
  if (!usageSheet) {
    usageSheet = el('dialog', 'usage-sheet'); usageSheet.id = 'usage-sheet'; usageSheet.setAttribute('aria-labelledby', 'usage-sheet-title');
    usageSheet.addEventListener('click', event => { if (event.target === usageSheet) usageSheet.close(); });
    usageSheet.addEventListener('close', () => { const notice = $('#toast'); if (notice && usageSheet.contains(notice)) document.body.append(notice); delete usageSheet.dataset.key; });
    document.body.append(usageSheet);
  }
  usageSheet.dataset.agent = agent;
  drawUsageSheet(true);
  if (!usageSheet.open) { usageSheet.showModal(); renderApprovals(); }
  // A popover above the ring that opened it, like the Claude app's (centred without one).
  const at = source?.getBoundingClientRect?.();
  if (at?.width) {
    usageSheet.classList.add('is-anchored');
    const width = usageSheet.offsetWidth, height = usageSheet.offsetHeight;
    usageSheet.style.left = Math.max(12, Math.min(innerWidth - width - 12, at.right - width)) + 'px';
    usageSheet.style.top = Math.max(12, at.top - height - 10) + 'px';
  } else { usageSheet.style.left = usageSheet.style.top = ''; usageSheet.classList.remove('is-anchored'); }
}
// "Resets in 3 hr 12 min" / "Resets Mon 10:00", as the Claude app words it.
function resetPhrase(iso) {
  const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
  const minutes = Math.round((at - Date.now()) / 60000);
  if (minutes <= 0) return 'Resets now';
  if (minutes < 60) return `Resets in ${minutes} min`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `Resets ${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !state.config?.clock24 })}`;
}
function updatedPhrase(iso) {
  const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  return `Last updated: ${minutes < 1 ? 'less than a minute ago' : minutes === 1 ? '1 minute ago' : minutes < 60 ? `${minutes} minutes ago` : `${Math.floor(minutes / 60)} hr ago`}`;
}
// Keeps the open popover current as readings arrive and minutes pass.
function drawUsageSheet(force = false) {
  if (!usageSheet || (!usageSheet.open && !force)) return;
  const agent = usageSheet.dataset.agent; if (!USAGE_AGENTS[agent]) return;
  const usage = state.tasks?.usage?.[agent] || {}, windows = usageWindows(agent), name = USAGE_AGENTS[agent];
  const key = JSON.stringify([agent, windows, usage.plan, usage.updatedAt, usage.error, usage.today, Math.floor(Date.now() / 60000)]);
  if (!force && usageSheet.dataset.key === key) return; usageSheet.dataset.key = key;
  const plan = usage.plan ? (agent === 'codex' ? `ChatGPT ${usage.plan[0].toUpperCase()}${usage.plan.slice(1)}` : `Claude ${usage.plan}`) : '';
  const head = el('div', 'usage-sheet-head'); const title = el('h2', 'usage-sheet-title'); title.id = 'usage-sheet-title'; title.append(el('i'), document.createTextNode(`${name} plan usage limits`));
  head.append(title); if (plan) head.append(el('span', 'usage-sheet-plan', plan));
  const parts = [head];
  const names = { session: 'Current session', weekly: 'All models', 'weekly-sonnet': 'Sonnet only', 'weekly-opus': 'Opus only' };
  const row = window => {
    const percent = Math.max(0, Math.min(100, window.usedPercent));
    const line = el('div', `usage-window ${usageTone(percent)}`.trim());
    const copy = el('div', 'usage-window-copy'); copy.append(el('span', 'usage-window-name', names[window.id] || window.label));
    if (window.resetsAt) copy.append(el('span', 'usage-window-reset', resetPhrase(window.resetsAt)));
    const bar = el('div', 'usage-window-bar'); bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(percent))); bar.setAttribute('aria-label', `${name} ${window.label} limit`);
    const fill = el('i'); fill.style.width = `${percent}%`; bar.append(fill);
    line.append(copy, bar, el('span', 'usage-window-value', `${Math.round(percent)}% used`));
    return line;
  };
  // Codex windows carry no id: its 5-hour window is the session, its weekly one "All models".
  const tagged = windows.map(window => window.id ? window : { ...window, id: window.label === '5-hour' ? 'session' : window.label === 'Weekly' ? 'weekly' : '' });
  const session = tagged.filter(window => window.id === 'session'), weekly = tagged.filter(window => window.id !== 'session');
  for (const window of session) parts.push(row(window));
  if (weekly.length) { parts.push(el('h3', 'usage-sheet-section', 'Weekly limits')); for (const window of weekly) parts.push(row(window)); }
  if (!windows.length) parts.push(el('p', 'usage-sheet-note', usage.error || (agent === 'codex' ? 'Codex reports its limits while it works. Start a Codex chat to see them.' : 'No usage has been reported yet.')));
  else if (usage.error) parts.push(el('p', 'usage-sheet-note', usage.error));
  if (agent === 'claude' && usage.today) parts.push(el('p', 'usage-sheet-note', `Today on this PC: ${compactCount(usage.today.requests)} ${usage.today.requests === 1 ? 'reply' : 'replies'} · ${compactCount(usage.today.output)} tokens written.`));
  if (usage.updatedAt) parts.push(el('p', 'usage-sheet-updated', updatedPhrase(usage.updatedAt)));
  usageSheet.replaceChildren(...parts);
}
function resetText(iso) {
  const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
  const hours = (at - Date.now()) / 3600000;
  if (hours <= 0) return 'resets now';
  if (hours < 24) return `resets in ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`}`;
  return `resets ${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !state.config?.clock24 })}`;
}
function compactCount(value) { return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value); }
function updateTaskUsage() {
  const boxes = document.querySelectorAll('.task-usage'); if (!boxes.length) return;
  const usage = state.tasks?.usage || {}, rings = [];
  for (const agent of ['claude', 'codex']) {
    if (!usage[agent]) continue;
    const windows = usageWindows(agent), session = windows.find(window => window.id === 'session') || windows[0] || null;
    rings.push({ agent, name: USAGE_AGENTS[agent], percent: session ? Math.max(0, Math.min(100, session.usedPercent)) : null, label: session?.label || '',
      reset: session?.resetsAt ? resetText(session.resetsAt) : '', detail: usage[agent].error || '' });
  }
  const key = JSON.stringify(rings);
  for (const box of boxes) { if (box.dataset.key === key) continue; box.dataset.key = key; box.replaceChildren(...rings.map(ring => {
    const known = Number.isFinite(ring.percent);
    const item = button('', () => openUsageSheet(ring.agent, item), { className: `usage-ring${known ? ` ${usageTone(ring.percent)}` : ''}`.trim(),
      label: known ? `${ring.name} ${ring.label} limit: ${Math.round(ring.percent)} percent used${ring.reset ? `, ${ring.reset}` : ''}. Show details` : `${ring.name} usage: not available. ${ring.detail}`.trim() });
    item.dataset.agent = ring.agent;
    // A small plain ring, like the Claude app's; the figures are in the popover.
    const dial = el('div', 'usage-ring-dial'); dial.append(printerRing(known ? ring.percent : 0, 'usage'));
    item.title = known ? `${ring.name}: ${Math.round(ring.percent)}% of the ${ring.label} limit` : `${ring.name} usage`;
    item.append(dial);
    return item;
  })); }
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
  const card = document.querySelector('#widgets .page-grid[data-current="true"] > .container-card.tasks');
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
    // Every card showing this printer: the Printers card's row and any single-printer widget.
    for (const figure of document.querySelectorAll(`.printer[data-printer-id="${CSS.escape(id)}"] .printer-figure, .machine-widget[data-printer="${CSS.escape(id)}"] .machine-detail .printer-figure`)) showPicture(figure, url, version.endsWith(':project'));
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
// Live camera inside the printers card: the camera button turns a printer's
// row into its live view (each printer separately, so both can show at once).
// Frames stream only while a view is on and on screen, and pause while a game
// or other full-screen app is in front.
const CAMERA_WAIT_MS = 1000;
const cameraImage = value => typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 8000000;
const liveCameras = new Map(); // id -> { image, message, time, frameAt, timer, busy }
function cameraAvailable(id) {
  const config = (state.config.printers || []).find(p => p.id === id);
  return !preview && typeof bridge?.cameraFrame === 'function' && config?.configured === true;
}
function redrawPrinters() {
  for (const body of document.querySelectorAll('.card-body')) if (body.querySelector('.printer-list, .machine-widget')) delete body.dataset.renderKey;
  render();
}
function toggleLiveCamera(id) {
  const live = liveCameras.get(id);
  if (live) { clearTimeout(live.timer); stopVideo(live); liveCameras.delete(id); }
  else {
    const image = el('img', 'printer-live-image'); image.alt = ''; image.decoding = 'async'; image.draggable = false; image.hidden = true;
    const message = el('p', 'printer-live-message', 'Connecting to the camera…'); message.setAttribute('role', 'status');
    const entry = { image, message, frameAt: null, timer: null, video: null };
    liveCameras.set(id, entry);
    const config = (state.config.printers || []).find(p => p.id === id);
    if (config?.model === 'H2D' && typeof bridge?.cameraVideo === 'function') startVideo(id, entry); else cameraTick(id, entry);
  }
  redrawPrinters();
}
// The H2D as real video: the printer's H.264 in a <video>, which buffers and
// plays evenly. It stays close to live (skipping ahead if it falls behind),
// reconnects when the stream ends, and falls back to pictures if it fails.
function stopVideo(entry) {
  const video = entry.video; if (!video) return;
  entry.video = null; clearInterval(video.edgeTimer); video.removeAttribute('src'); video.load(); video.remove();
}
async function startVideo(id, entry, attempt = 0) {
  if (liveCameras.get(id) !== entry) return;
  stopVideo(entry);
  let link;
  try { link = await bridge.cameraVideo(id); } catch (error) { entry.message.hidden = false; entry.message.textContent = error?.message || 'The camera video could not start.'; cameraTick(id, entry); return; }
  if (liveCameras.get(id) !== entry || !/^\/camera\/[A-Za-z0-9_-]{43}$/.test(link?.url || '')) return;
  const video = el('video', 'printer-live-image'); video.muted = true; video.autoplay = true; video.playsInline = true; video.disablePictureInPicture = true; video.setAttribute('aria-hidden', 'true');
  entry.video = video; entry.image.hidden = true;
  let started = false;
  video.addEventListener('playing', () => { started = true; entry.message.hidden = true; }, { once: true });
  video.addEventListener('error', () => {
    if (entry.video !== video) return;
    stopVideo(entry);
    if (!started || attempt >= 3) { entry.message.hidden = false; entry.message.textContent = 'Live video is unavailable; showing pictures.'; cameraTick(id, entry); }
    else setTimeout(() => startVideo(id, entry, attempt + 1), 1500);
  });
  video.addEventListener('ended', () => { if (entry.video === video) setTimeout(() => startVideo(id, entry, attempt + 1), 1000); });
  // Stay near the live edge: a stall builds a backlog, which is skipped.
  video.edgeTimer = setInterval(() => {
    if (entry.video !== video || !video.buffered.length) return;
    const end = video.buffered.end(video.buffered.length - 1);
    if (end - video.currentTime > 2) video.currentTime = end - 0.4;
    if (video.paused && video.isConnected) video.play().catch(() => {});
  }, 1000);
  video.src = link.url;
  entry.image.parentElement?.insertBefore(video, entry.image);
  video.play().catch(() => {});
  entry.message.hidden = false; entry.message.textContent = 'Connecting to the camera…';
}
async function cameraTick(id, entry) {
  if (liveCameras.get(id) !== entry) return;
  let wait = CAMERA_WAIT_MS;
  if (entry.image.isConnected && document.visibilityState === 'visible' && !powerInfo().active) {
    const printer = (state.printers || []).find(p => p.id === id);
    try {
      const frame = await bridge.cameraFrame(id, entry.frameAt);
      if (liveCameras.get(id) !== entry) return;
      if (cameraImage(frame?.image)) {
        // Each frame is decoded before it replaces the shown one, so the view never stalls on a half-decoded picture.
        if (entry.frameAt !== frame.updatedAt) { entry.frameAt = frame.updatedAt; const next = new Image(); next.src = frame.image; try { await next.decode(); } catch {} if (liveCameras.get(id) !== entry) return; entry.image.src = next.src; }
        entry.image.hidden = false; entry.message.hidden = true; wait = 15;
      } else {
        entry.message.hidden = false;
        entry.message.textContent = frame?.error || printer?.capabilityReasons?.camera || 'Waiting for the camera…';
      }
    } catch (error) { if (liveCameras.get(id) !== entry) return; entry.message.hidden = false; entry.message.textContent = error?.message || 'The camera could not be reached.'; }
  } else if (powerInfo().active && entry.image.isConnected) {
    entry.message.hidden = false; entry.message.textContent = 'Paused while a full-screen app is in front.';
  }
  entry.timer = setTimeout(() => cameraTick(id, entry), wait);
}
// The row's live view: the video with the printer's name, status and progress over it.
function liveCameraRow(row, id, displayName, data) {
  const entry = liveCameras.get(id);
  row.classList.add('is-live');
  const stage = el('div', 'printer-live'); stage.append(...(entry.video ? [entry.video] : []), entry.image, entry.message);
  if (entry.video?.paused) queueMicrotask(() => entry.video?.play().catch(() => {}));
  const overlay = el('div', 'printer-live-overlay');
  const title = el('div', 'printer-live-title'); title.append(el('span', 'printer-live-badge', 'LIVE'), el('strong', '', displayName));
  overlay.append(title);
  if (['printing', 'paused'].includes(data.status) && Number.isFinite(data.progress)) {
    const progress = el('div', 'printer-live-progress');
    const remaining = Number.isFinite(data.remainingMinutes) ? (data.remainingMinutes >= 60 ? `${Math.floor(data.remainingMinutes / 60)}h ${Math.round(data.remainingMinutes % 60)}m left` : `${Math.round(data.remainingMinutes)}m left`) : '';
    progress.append(el('span', '', `${Math.round(data.progress)}%`), el('span', '', remaining));
    const bar = el('div', 'printer-live-bar'); const fill = el('span'); fill.style.width = `${Math.max(0, Math.min(100, data.progress))}%`; bar.append(fill);
    overlay.append(progress, bar);
  } else overlay.append(el('span', 'printer-live-status', (printerLabels[data.status] || ['Unknown'])[0]));
  stage.append(overlay);
  return stage;
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
  const fill = el('span'); glide(`print:${name}`, fill, 'width', `${progress}%`); track.append(fill);
  const bottom = el('div', 'print-progress-facts');
  // The status itself is in the row's badge; a stage is named only when it says more ("Heating bed").
  const stage = String(data.stage?.label || '').trim();
  bottom.append(el('span', 'print-progress-status', data.status === 'printing' && stage && !/^printing$/i.test(stage) ? stage : ''));
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
// The filament on the printer, grouped the way it is loaded: each AMS with its
// four slots (empty ones too), then the external spool. The loaded spool is
// marked; the H2D also says which nozzle (L or R).
function filamentSpools(data) {
  const filament = data.filament || {}; const slots = Array.isArray(filament.slots) ? filament.slots : [];
  const extruders = Array.isArray(filament.extruders) ? filament.extruders : [];
  const external = filament.external && (filament.external.material || filament.external.color) ? filament.external : null;
  if (!slots.length && !external) return null;
  const box = el('div', 'printer-spools'); box.setAttribute('role', 'list'); box.setAttribute('aria-label', 'Loaded filament');
  const nozzleTag = extruders.length > 1 ? extruder => (String(extruder.label || '').startsWith('Left') ? 'L' : 'R') : () => '';
  const loadedIn = (amsId, slotId) => extruders.find(item => item.hasFilament !== false && item.amsId === amsId && item.slotId === slotId) || null;
  const spool = (slot, loaded, caption) => {
    const nozzle = loaded ? nozzleTag(loaded) : '';
    const item = el('span', `printer-spool${loaded ? ' is-loaded' : ''}${slot ? '' : ' is-empty'}`); item.setAttribute('role', 'listitem');
    // Bambu sends 00000000 (fully transparent) for a slot whose colour was never set.
    const color = slot && /^[0-9A-F]{6}(?:[0-9A-F]{2})?$/i.test(slot.color || '') && !/^[0-9A-F]{6}00$/i.test(slot.color) ? `#${slot.color.slice(0, 6)}` : null;
    const swatch = el('i'); if (color) swatch.style.setProperty('--spool', color); else if (slot) swatch.classList.add('no-color');
    if (nozzle) swatch.dataset.nozzle = nozzle;
    item.append(swatch, el('span', '', slot ? (slot.material || '—').slice(0, 7) : 'Empty'));
    item.setAttribute('aria-label', `${caption}: ${slot ? slot.material || 'filament' : 'empty'}${loaded ? `, loaded${nozzle ? ` in the ${nozzle === 'L' ? 'left' : 'right'} nozzle` : ''}` : ''}`);
    return item;
  };
  const group = (name, label) => { const node = el('div', 'spool-group'); node.setAttribute('role', 'group'); node.setAttribute('aria-label', label); node.append(el('span', 'spool-group-name', name)); const row = el('div', 'spool-group-slots'); node.append(row); box.append(node); return row; };
  for (const amsId of [...new Set(slots.map(slot => slot.amsId).filter(Number.isInteger))].sort((a, b) => a - b).slice(0, 4)) {
    const row = group(`AMS ${amsId + 1}`, `AMS ${amsId + 1}`);
    for (let slotId = 0; slotId < 4; slotId++) {
      const slot = slots.find(item => item.amsId === amsId && item.slotId === slotId) || null;
      row.append(spool(slot, slot ? loadedIn(amsId, slotId) : null, `AMS ${amsId + 1} slot ${slotId + 1}`));
    }
  }
  if (external) group('External', 'External spool').append(spool(external, extruders.find(item => item.hasFilament !== false && item.amsId === 254) || null, 'External spool'));
  return box.childElementCount ? box : null;
}
const PRINTER_FINISHED_MS = 5 * 60000;
// Printers, Small widget: a progress ring per printer, its name and when it
// finishes (or its status). The essentials only.
function printerRing(progress, tone) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(svg.namespaceURI, 'circle'), fill = document.createElementNS(svg.namespaceURI, 'circle');
  for (const circle of [track, fill]) { circle.setAttribute('cx', '50'); circle.setAttribute('cy', '50'); circle.setAttribute('r', '42'); }
  track.setAttribute('class', 'mini-ring-track'); fill.setAttribute('class', `mini-ring-fill is-${tone}`);
  fill.style.strokeDasharray = `${Math.max(0, Math.min(100, progress)) * 2.639} 263.9`;
  svg.append(track, fill); return svg;
}
function renderPrintersSmall(panel, configured) {
  const list = el('div', 'printer-mini-list'); list.dataset.count = String(Math.min(2, configured.length));
  for (const config of configured.slice(0, 2)) {
    const data = (state.printers || []).find(p => p.id === config.id) || { status: config.configured ? 'connecting' : 'not_configured' };
    const name = data.accountName || data.name || config.name;
    const active = ['printing', 'paused'].includes(data.status) && Number.isFinite(data.progress);
    const row = el('button', `printer-mini is-${data.status}`); row.type = 'button';
    row.addEventListener('click', () => showPrinterConsole(config.id, row));
    const dial = el('div', 'printer-mini-dial'); dial.append(printerRing(active ? data.progress : data.status === 'finished' ? 100 : 0, data.status === 'paused' ? 'paused' : data.status === 'error' ? 'error' : data.status === 'finished' ? 'done' : 'print'));
    dial.append(el('strong', 'printer-mini-value', active ? `${Math.round(data.progress)}%` : data.status === 'finished' ? '✓' : data.status === 'idle' ? '' : '—'));
    const done = active && data.status === 'printing' && Number.isFinite(data.remainingMinutes) ? new Date(Date.now() + data.remainingMinutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !state.config?.clock24 }) : '';
    const copy = el('div', 'printer-mini-copy');
    copy.append(el('span', 'printer-mini-name', name), el('span', 'printer-mini-status', done ? `Done ${done}` : (printerLabels[data.status] || ['Unknown'])[0]));
    row.setAttribute('aria-label', `${name}: ${active ? `${Math.round(data.progress)} percent` : (printerLabels[data.status] || ['Unknown'])[0]}${done ? `, done at ${done}` : ''}`);
    row.append(dial, copy); list.append(row);
  }
  panel.append(list);
}
function renderPrinters(panel) {
  const configured = state.config.printers || [];
  const card = panel.closest?.('.container-card');
  if ((state.config.layout?.mode === 'widgets') && card?.dataset.size === 'small' && configured.length) { renderPrintersSmall(panel, configured); return; }
  header(panel, '3D printers', 'printer', badge(`${configured.length} printers`));
  const list = el('div', 'printer-list');
  for (const config of configured) list.append(printerRow(config));
  if (!configured.length) emptyContent(panel, 'printer', 'Your print room', 'Add your printer connections in Customize.'); else panel.append(list);
}
// One printer's row: figure, name and status, then the job's progress, the
// finished state or the loaded filament; the live camera replaces it when on.
function printerRow(config) {
  const raw = (state.printers || []).find(p => p.id === config.id) || { status: config.configured ? 'connecting' : 'not_configured' };
  const finishedFor = raw.status === 'finished' ? Date.now() - Date.parse(raw.finishedAt || raw.finishedSeenAt || '') : NaN;
  const data = raw.status === 'finished' && finishedFor > PRINTER_FINISHED_MS ? { ...raw, status: 'idle', thumbnail: null } : raw;
  const active = ['printing', 'paused'].includes(data.status);
  const row = el('article', `printer is-rich${active ? ' is-job' : ''}`); row.dataset.printerId = config.id; row.dataset.status = data.status;
  const displayName = data.accountName || data.name || config.name;
  row.append(button('', () => showPrinterConsole(config.id, row), { className: 'printer-open', label: `Open ${displayName} control panel` }), printerFigure(config.model, { ...data, id: config.id }));
  const cameraOn = liveCameras.has(config.id);
  if (cameraAvailable(config.id) && (cameraOn || !['not_configured', 'offline'].includes(data.status))) {
    const toggle = button('', () => toggleLiveCamera(config.id), { className: 'printer-camera-toggle', icon: cameraOn ? 'close' : 'camera', label: cameraOn ? `Close ${displayName} camera` : `Show ${displayName} camera` });
    toggle.setAttribute('aria-pressed', String(cameraOn)); row.append(toggle);
  }
  if (cameraOn) { row.append(liveCameraRow(row, config.id, displayName, data)); return row; }
  // The name, model and the one status line sit above the picture and details.
  const head = el('div', 'printer-head'); const top = el('div', 'printer-topline');
  top.append(el('h3', 'printer-name', displayName), badge(...(printerLabels[data.status] || ['Unknown', '']))); head.append(top);
  const modelName = `Bambu Lab ${config.model || ''}`.trim();
  if (String(displayName).trim().toLowerCase() !== modelName.toLowerCase()) head.append(el('p', 'printer-model', modelName));
  row.insertBefore(head, row.querySelector('.printer-figure'));
  const detail = el('div', 'printer-details');
  if (data.status === 'not_configured') {
    detail.append(el('p', 'printer-note', 'Connect over your local network.'), button('Connect printer', () => showSettings('printers'), { className: 'button subtle' }));
  } else if (active) {
    if (data.jobName) { const job = el('p', 'printer-job', data.jobName); job.title = data.jobName; detail.append(job); }
    if (Number.isFinite(data.progress)) detail.append(printProgress(displayName, data));
  } else if (data.status === 'finished') {
    // Finished: a clear done state, what was printed, when and how long it took.
    if (data.jobName) { const job = el('p', 'printer-job', data.jobName); job.title = data.jobName; detail.append(job); }
    const done = el('div', 'printer-done');
    const head = el('div', 'printer-done-head'); const title = el('span', 'printer-done-title'); title.append(icon('check'), document.createTextNode(data.finishedAt ? agoText(data.finishedAt).replace(/^./, c => c.toUpperCase()) : 'Just now'));
    head.append(title, el('span', 'printer-done-percent', '100%'));
    const bar = el('div', 'printer-done-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `${displayName} print finished`); bar.setAttribute('aria-valuenow', '100'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.append(el('span'));
    const took = data.jobStartedAt && data.finishedAt ? durationText(Date.parse(data.finishedAt) - Date.parse(data.jobStartedAt)) : '';
    const meta = el('div', 'printer-done-meta'); meta.append(el('span', '', took ? `Took ${took}` : ''), el('span', '', 'Clear the plate'));
    done.append(head, bar, meta); detail.append(done);
  } else if (data.status === 'idle') {
    // Ready (the status above says so): the loaded filament.
    const spools = filamentSpools(data); detail.append(spools || el('p', 'printer-note', 'No filament reported.'));
  } else {
    if (data.message) detail.append(el('p', 'printer-note', data.message));
  }
  const disclosure = el('span', 'printer-disclosure'); disclosure.setAttribute('aria-hidden', 'true'); disclosure.append(icon('right'));
  row.append(detail, disclosure); return row;
}
// PC stats: CPU, GPU, memory and video memory as rings, the busiest apps, uptime
// and an internet speed test. While a game is full screen it shows only the rings
// (game view), larger.
const gigabytes = bytes => `${(bytes / 1073741824).toFixed(bytes >= 10737418240 ? 0 : 1)} GB`;
function uptimeText(seconds) {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
function statRing(label, value, detail, extra, hot) {
  const box = el('div', `stat-ring${hot ? ' is-hot' : ''}`);
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(svg.namespaceURI, 'circle'); track.setAttribute('class', 'stat-ring-track');
  const fill = document.createElementNS(svg.namespaceURI, 'circle'); fill.setAttribute('class', 'stat-ring-fill');
  for (const circle of [track, fill]) { circle.setAttribute('cx', '50'); circle.setAttribute('cy', '50'); circle.setAttribute('r', '42'); }
  glide(`ring:${label}`, fill, 'strokeDasharray', `${(percent ?? 0) * 2.639} 263.9`);
  svg.append(track, fill);
  const center = el('div', 'stat-ring-center'); center.append(el('strong', '', percent === null ? '—' : `${Math.round(percent)}%`));
  if (extra) center.append(el('span', 'stat-ring-extra', extra));
  const dial = el('div', 'stat-ring-dial'); dial.append(svg, center);
  box.append(dial, el('span', 'stat-ring-label', label));
  if (detail) box.append(el('small', 'stat-ring-detail', detail));
  box.setAttribute('role', 'img'); box.setAttribute('aria-label', [label, percent === null ? 'not reported' : `${Math.round(percent)} percent`, extra, detail].filter(Boolean).join(', '));
  return box;
}
// CPU temperature needs Edge Deck's sensor (PawnIO driver + an elevated task).
async function toggleCpuSensor(enable) {
  try { toast(enable ? 'Approve the Windows prompt to turn on CPU temperature' : 'Approve the Windows prompt to turn off CPU temperature'); updateState(await bridge.setCpuSensor(enable)); toast(enable ? 'CPU temperature is on' : 'CPU temperature is off'); }
  catch (error) { toast(error.message); }
  if (dialog.open && activeTab === 'display') renderSettings();
}
function cpuSensorNote(pc) {
  const sensor = pc.cpuSensor || {};
  const note = el('div', 'pc-stats-note');
  if (!['intel', 'amd'].includes(sensor.vendor)) note.append(el('small', '', 'CPU temperature appears when HWiNFO or Core Temp is running.'));
  else if (sensor.enabled) note.append(el('small', '', 'Starting the CPU temperature sensor…'));
  else note.append(el('small', '', sensor.driver ? 'CPU temperature is off.' : 'CPU temperature is off. Turning it on installs the signed PawnIO driver.'), button('Turn on', () => toggleCpuSensor(true), { className: 'button subtle pc-sensor-button', disabled: preview || typeof bridge.setCpuSensor !== 'function' }));
  return note;
}
function renderStats(panel) {
  const pc = state.pc;
  const game = state.system?.presence === 'fullscreen';
  header(panel, 'PC stats', 'stats', badge(game ? 'Game mode' : pc ? `Up ${uptimeText(pc.uptime || 0)}` : 'Starting', game ? 'working' : ''));
  if (!pc) { emptyContent(panel, 'stats', 'PC stats are starting', 'Readings appear in a moment.'); return; }
  const body = el('div', `pc-stats${game ? ' is-game' : ''}`);
  const rings = el('div', 'stat-rings');
  const cpuTemp = Number.isFinite(pc.cpu?.temperature) ? `${Math.round(pc.cpu.temperature)}°C` : '—°C';
  rings.append(statRing('CPU', pc.cpu?.load, (pc.cpu?.name || '').replace(/^(\d+th Gen )?Intel\(R\) Core\(TM\) /, '').replace(/ CPU.*$/, ''), cpuTemp, pc.cpu?.temperature >= 85));
  if (pc.gpu) rings.append(statRing('GPU', pc.gpu.load, !Number.isFinite(pc.gpu.power) ? '' : `${Math.round(pc.gpu.power)} W`, Number.isFinite(pc.gpu.temperature) ? `${Math.round(pc.gpu.temperature)}°C` : '', pc.gpu.temperature >= 83));
  const memory = pc.memory || {};
  rings.append(statRing('RAM', memory.total ? memory.used / memory.total * 100 : null, memory.total ? `${gigabytes(memory.used)} of ${gigabytes(memory.total)}` : ''));
  if (pc.gpu?.memoryTotal) rings.append(statRing('VRAM', pc.gpu.memoryUsed / pc.gpu.memoryTotal * 100, `${(pc.gpu.memoryUsed / 1024).toFixed(1)} of ${Math.round(pc.gpu.memoryTotal / 1024)} GB`));
  body.append(rings);
  if (!game) {
    const apps = el('div', 'pc-apps'); apps.setAttribute('role', 'list'); apps.setAttribute('aria-label', 'Busiest apps');
    const most = Math.max(1, ...(pc.apps || []).map(app => app.memory));
    for (const app of (pc.apps || []).slice(0, 5)) {
      const row = el('div', 'pc-app'); row.setAttribute('role', 'listitem');
      const iconBox = el('span', 'pc-app-icon');
      if (typeof app.icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(app.icon)) { const image = el('img'); image.src = app.icon; image.alt = ''; iconBox.append(image); } else iconBox.append(icon('app'));
      const copy = el('div', 'pc-app-copy'); const top = el('div', 'pc-app-top');
      top.append(el('span', 'pc-app-name', app.title), el('span', 'pc-app-memory', gigabytes(app.memory)));
      const bar = el('div', 'pc-app-bar'); const fill = el('span'); fill.style.width = `${Math.max(3, app.memory / most * 100)}%`; bar.append(fill);
      copy.append(top, bar);
      row.append(iconBox, copy, el('span', 'pc-app-cpu', `${app.cpu >= 10 ? Math.round(app.cpu) : app.cpu.toFixed(1)}%`));
      apps.append(row);
    }
    body.append(apps);
    const footer = el('div', 'pc-stats-footer');
    const speed = pc.speed || {};
    const result = el('span', 'pc-speed-result',
      speed.state === 'running' ? ['Testing…', Number.isFinite(speed.ping) ? `${speed.ping} ms` : '', Number.isFinite(speed.down) ? `↓ ${speed.down} Mbps` : ''].filter(Boolean).join(' · ')
        : speed.state === 'done' ? `↓ ${speed.down} Mbps · ↑ ${speed.up} Mbps · ${speed.ping} ms` : speed.state === 'error' ? speed.error : 'Internet speed');
    const test = button(speed.state === 'running' ? 'Testing' : speed.state === 'done' ? 'Test again' : 'Test speed', async () => { try { updateState(await bridge.speedTest()); } catch (error) { toast(error.message); } }, { className: 'button subtle pc-speed-button', disabled: speed.state === 'running' || preview });
    footer.append(result, test);
    if (!Number.isFinite(pc.cpu?.temperature)) footer.append(cpuSensorNote(pc));
    body.append(footer);
  }
  panel.append(body);
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
const CONNECTION_TABS = [['music', 'Music'], ['calendar', 'Calendar'], ['weather', 'Weather'], ['printers', 'Printers'], ['agents', 'Agents']];
// Customize → Connections → Calendar is drawn by the calendar module (src/widget-calendar.js).
function settingsCalendar(content) {
  if (window.EdgeCalendar?.renderSettings) window.EdgeCalendar.renderSettings(content, { getState: () => state, bridge, updateState, toast, el, button, icon });
  else content.append(el('p', 'intro', 'Calendar settings are unavailable. Reopen Edge Deck.'));
}
let lastConnectionTab = 'music';
// Hold a widget (about 0.6 s) for its menu; hold an empty spot to edit the Home Screen.
const CARD_SETTINGS = { media: 'music', weather: 'weather', today: 'weather', printers: 'printers', tasks: 'agents', stats: 'display', actions: 'display', clock: 'display', app: 'apps', website: 'apps', gauge: 'display', switch: 'display', machine: 'printers', calendar: 'calendar', batteries: 'display', reminders: 'display', screentime: 'display', 'rain-wind': 'weather', 'daily-forecast': 'weather', 'sun-path': 'weather', dial: 'display', city: 'display', 'world-clock': 'display' };
let pressTimer = null, pressStart = null, pressedCard = null, suppressClick = false;
function cancelPress() { clearTimeout(pressTimer); pressTimer = null; pressedCard?.classList.remove('is-pressing'); pressedCard = null; }
document.addEventListener('pointerdown', event => {
  if (editingLayout || event.button > 0 || !event.isPrimary || event.target.closest?.('input, select, textarea, [contenteditable], dialog')) return;
  const card = event.target.closest?.('.page-grid > .container-card');
  if (!card && !event.target.closest?.('#widgets .page-grid')) return;
  pressStart = { x: event.clientX, y: event.clientY }; pressedCard = card;
  pressTimer = setTimeout(() => { card?.classList.remove('is-pressing'); suppressClick = true; setTimeout(() => { suppressClick = false; }, 1500); pressedCard = null; pressTimer = null; navigator.vibrate?.(10); if (card) openWidgetMenu(card); else setEditing(true); }, 600);
  if (card) setTimeout(() => { if (pressedCard === card && pressTimer) card.classList.add('is-pressing'); }, 180);
}, true);
document.addEventListener('pointermove', event => { if (pressTimer && pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 12) cancelPress(); }, true);
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) document.addEventListener(type, () => { if (pressTimer) cancelPress(); }, true);
// The tap that ends a long press does not also press what is under the finger.
document.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
document.addEventListener('contextmenu', event => { if (event.target.closest?.('#widgets .container-card')) event.preventDefault(); });
async function showSettings(tab = 'layout') {
  activeTab = tab==='widgets'?'layout':tab; renderSettings(); if (!dialog.open) { dialog.showModal(); renderApprovals(); }
}
function renderSettings() {
  $('#settings-title').textContent = activeTab === 'control' ? ((state.config.printers || []).find(p => p.id === activePrinterId)?.name || 'Printer controls') : 'Customize your deck';
  const tabs = $('#settings-tabs'), restoreTabFocus=tabs.contains(document.activeElement), previousScroll=tabs.scrollLeft; tabs.replaceChildren();
  // Four places: Layout, Apps, Connections (music, weather, printers, agents) and Display.
  const connection = CONNECTION_TABS.some(([id]) => id === activeTab) || activeTab === 'control';
  for (const [id, name] of [['layout','Layout'], ['apps','Apps'], ['connections','Connections'], ['display','Display']]) {
    const selected = id === 'connections' ? connection : activeTab === id;
    const tab = button(name, () => { activeTab = id === 'connections' ? (connection ? activeTab : lastConnectionTab) : id; renderSettings(); }, { className: `tab${selected ? ' active' : ''}` }); tab.setAttribute('aria-current', selected ? 'page' : 'false'); tabs.append(tab);
  }
  tabs.scrollLeft=previousScroll;
  if(restoreTabFocus)tabs.querySelector('[aria-current=page]')?.focus({preventScroll:true});
  const content = $('#settings-content'); content.replaceChildren();
  renderPagesSettings();
  // The Connections sub-row has its own slot: some pages redraw their whole content.
  let sub = $('#settings-subtabs');
  if (!sub) { sub = el('div', 'settings-subtabs'); sub.id = 'settings-subtabs'; sub.setAttribute('role', 'group'); sub.setAttribute('aria-label', 'Connections'); content.before(sub); }
  sub.replaceChildren(); sub.hidden = !connection;
  if (connection) {
    if (activeTab !== 'control') lastConnectionTab = activeTab;
    for (const [id, name] of CONNECTION_TABS) {
      const selected = activeTab === id || (activeTab === 'control' && id === 'printers');
      const choice = button(name, () => { activeTab = id; renderSettings(); }, { className: `settings-subtab${selected ? ' active' : ''}` });
      choice.setAttribute('aria-pressed', String(selected)); sub.append(choice);
    }
  }
  ({ layout: content=>window.EdgeLayoutUI.renderSettings(content,layoutContext()), widgets: settingsWidgets, apps: settingsApps, agents: settingsAgents, music: settingsMusic, calendar: settingsCalendar, weather: settingsWeather, printers: settingsPrinters, control: settingsPrinterControls, display: settingsDisplay })[activeTab](content);
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
  // Claude plan usage, read with the Claude Code sign-in on this PC.
  const usage = state.tasks?.usage?.claude || {}, usageOn = state.config.agents?.claudeUsage !== false;
  const usageRow = el('div', 'settings-row'); const usageCopy = el('div');
  usageCopy.append(el('p', 'settings-row-title', 'Show Claude usage'), el('small', '', 'Reads your plan usage (the 5-hour session and the weekly limits) from Anthropic with the Claude Code sign-in stored on this PC, the way Claude Code’s /usage does. The sign-in is sent only to Anthropic and never shown.'));
  const usageToggle = button('', async () => {
    const cfg = newConfig(); cfg.agents = { ...(cfg.agents || {}), claudeUsage: !usageOn }; await saveConfig(cfg); renderSettings();
    toast(usageOn ? 'Claude usage is hidden' : 'Claude usage is shown on the Agents card');
  }, { className: 'toggle', label: 'Show Claude usage', disabled: preview });
  usageToggle.setAttribute('role', 'switch'); usageToggle.setAttribute('aria-checked', String(usageOn));
  usageRow.append(usageCopy, usageToggle); content.append(usageRow);
  if (usageOn) content.append(el('div', 'notice', usage.windows?.length ? `Connected${usage.plan ? ` (Claude ${usage.plan})` : ''}. Tap a ring on the Agents card for every limit window.` : usage.error || 'Checking the Claude Code sign-in…'));
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
function settingsSection(content, title) { content.append(el('h3', 'settings-section', title)); }
async function settingsDisplay(content) {
  content.append(el('p', 'intro', 'Place the deck on your XENEON EDGE, then enter full screen.'));
  settingsUpdates(content);
  settingsSection(content, 'Screen');
  const sensor = state.pc?.cpuSensor;
  const pcSection = el('div');
  if (['intel', 'amd'].includes(sensor?.vendor) && typeof bridge.setCpuSensor === 'function') {
    const sensorRow = el('div', 'settings-row'); const sensorCopy = el('div');
    sensorCopy.append(el('p', 'settings-row-title', 'CPU temperature'), el('small', '', `Uses the signed PawnIO driver${sensor.driver ? '' : ' (installed when you turn this on)'}. Asks for administrator permission.`));
    const sensorToggle = button('', () => toggleCpuSensor(!sensor.enabled), { className: 'toggle', label: 'CPU temperature' });
    sensorToggle.setAttribute('role', 'switch'); sensorToggle.setAttribute('aria-checked', String(sensor.enabled === true));
    sensorRow.append(sensorCopy, sensorToggle); pcSection.append(sensorRow);
  }
  const row = el('div', 'settings-row'); row.append(el('span', 'settings-row-title', '24-hour clock'));
  const toggle = button('', async () => { const cfg = newConfig(); cfg.clock24 = !cfg.clock24; await saveConfig(cfg); renderSettings(); }, { className: 'toggle', label: '24-hour clock' }); toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(state.config.clock24)); row.append(toggle); content.append(row);
  const power = powerInfo();
  const powerRow = el('div', 'settings-row'); const powerCopy = el('div');
  powerCopy.append(el('p', 'settings-row-title', 'Low power'), el('small', '', 'Calmer animation. Automatic while you game or the PC is locked.'));
  const powerChoices = el('div', 'power-control'); powerChoices.setAttribute('role', 'group'); powerChoices.setAttribute('aria-label', 'Low power');
  for (const [mode, label] of [['off', 'Off'], ['auto', 'Automatic'], ['on', 'On']]) {
    const choice = button(label, async () => { if (powerInfo().mode === mode) return; const cfg = newConfig(); cfg.power = { mode }; await saveConfig(cfg); syncPowerControls(); }, { className: 'button' });
    choice.dataset.powerMode = mode; choice.setAttribute('aria-pressed', String(power.mode === mode)); powerChoices.append(choice);
  }
  powerRow.append(powerCopy, powerChoices); content.append(powerRow);
  const powerStatus = el('p', `power-status${power.active ? ' is-active' : ''}`, powerStatusText(power));
  powerStatus.setAttribute('role', 'status'); content.append(powerStatus);
  // Tray notifications. They wait while a game or other full-screen app is in front.
  settingsSection(content, 'Notifications');
  const notifications = { printers: true, agents: true, ...(state.config.notifications || {}) };
  for (const [key, title, detail] of [['printers', 'Prints', 'When a print finishes or fails. Waits while you game.'], ['agents', 'Approvals', 'When Claude Code or Codex needs your OK.']]) {
    const noteRow = el('div', 'settings-row'); const noteCopy = el('div');
    noteCopy.append(el('p', 'settings-row-title', title), el('small', '', detail));
    const noteToggle = button('', async () => { const cfg = newConfig(); cfg.notifications = { ...notifications, [key]: !notifications[key] }; await saveConfig(cfg); renderSettings(); }, { className: 'toggle', label: title });
    noteToggle.setAttribute('role', 'switch'); noteToggle.setAttribute('aria-checked', String(notifications[key] !== false));
    noteRow.append(noteCopy, noteToggle); content.append(noteRow);
  }
  if (pcSection.childNodes.length) { settingsSection(content, 'PC'); content.append(...pcSection.childNodes); }
  settingsSection(content, 'Windows');
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
function editLayoutLabel(){$('#edit-layout').replaceChildren(icon('grip'),document.createTextNode(editingLayout?'Done editing':'Edit Home Screen'));}
editLayoutLabel();
$('#edit-layout').addEventListener('click',()=>setEditing(!editingLayout));
$('#layout-done').addEventListener('click',()=>setEditing(false));
$('#widget-add').append(icon('plus'));
$('#widget-add').addEventListener('click',()=>openWidgetGallery());
$('#add-widget').prepend(icon('plus'));
$('#add-widget').addEventListener('click',()=>openWidgetGallery());
// The Edge Deck menu (bottom left): Customize, Edit layout, Full screen.
function closeDeckMenu(){ $('#deck-menu-list').hidden = true; $('#deck-menu').setAttribute('aria-expanded', 'false'); }
$('#deck-menu').addEventListener('click', event => { event.stopPropagation(); const open = $('#deck-menu-list').hidden; $('#deck-menu-list').hidden = !open; $('#deck-menu').setAttribute('aria-expanded', String(open)); if (open) $('#deck-menu-list button')?.focus(); });
document.addEventListener('pointerdown', event => { if (!event.target.closest?.('.deck-controls')) closeDeckMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#deck-menu-list').hidden) { closeDeckMenu(); $('#deck-menu').focus(); } });
window.EdgeCardDrag.attach($('#widgets'),{onMove:moveCard,onError:error=>toast(error.message),onEdge:direction=>{const next=pagesList()[pageIndex()+direction];if(next)showPage(next.id);},canStart:()=>editingLayout,canStack});
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
addEventListener('resize',()=>requestAnimationFrame(()=>{applyCardLayout();placePages(0,false);}));
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
$('#customize').addEventListener('click', () => { closeDeckMenu(); showSettings(); });
$('#close-settings').addEventListener('click', () => dialog.close());
$('#fullscreen').addEventListener('click', async () => { closeDeckMenu(); try { await bridge.fullscreen(); } catch (error) { toast(error.message); } });
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
bridge.onState(updateState);
bridge.getState().then(updateState).catch(error => { render(); toast(`Could not load the dashboard: ${error.message}`); });
setInterval(() => { updateClock(); updateTaskTimers(); updateApprovalCountdown(); }, 1000);
