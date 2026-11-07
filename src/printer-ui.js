(() => {
  'use strict';
  const views = new WeakMap();
  const statusNames = { not_configured: 'Not connected', connecting: 'Connecting', offline: 'Offline',
    printing: 'Printing', idle: 'Ready', paused: 'Paused', finished: 'Finished', error: 'Needs attention' };

  function element(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function safeMessage(error, fallback = 'The printer action could not be completed. Check the printer and try again.') {
    const text = typeof error === 'string' ? error : error?.message;
    return typeof text === 'string' && text.length < 600 &&
      !/(?:[a-z]:[\\/]|rtsps?:\/\/|password\s*[:=]|access.?code\s*[:=]|token\s*[:=])/i.test(text)
      ? text.replace(/[\u0000-\u001f\u007f]/g, ' ') : fallback;
  }
  const iconPaths = {
    home: ['M3 10 12 3l9 7', 'M5 9v12h5v-7h4v7h5V9'],
    controls: ['M6 3v5m0 4v9M12 3v10m0 4v4M18 3v2m0 4v12', 'M3 8h6v4H3ZM9 13h6v4H9ZM15 5h6v4h-6Z'],
    up: ['m5 14 7-7 7 7'], down: ['m5 10 7 7 7-7'], left: ['m14 5-7 7 7 7'], right: ['m10 5 7 7-7 7'],
    spool: ['M7 4c-3 0-4 4-4 8s1 8 4 8 4-4 4-8S10 4 7 4Z', 'M7 4h10c3 0 4 4 4 8s-1 8-4 8H7', 'M7 8v8', 'M15 4v16'],
    camera: ['M3 7h12v12H3Z', 'M15 11l6-4v12l-6-4', 'M6 7l2-3h4l2 3'],
    nozzle: ['M7 3h10v7l-3 4v4l-2 3-2-3v-4l-3-4Z', 'M7 7h10'],
    bed: ['M3 14h18l-3 6H6Z', 'M7 3c-3 3 3 4 0 7', 'M12 3c-3 3 3 4 0 7', 'M17 3c-3 3 3 4 0 7'],
    pause: ['M8 5v14', 'M16 5v14'], play: ['m7 4 13 8-13 8Z'], stop: ['M5 5h14v14H5Z'],
    refresh: ['M20 7a9 9 0 1 0 1 8', 'M20 2v5h-5'],
    arrow: ['M4 12h16', 'm14 6 6 6-6 6'],
    load: ['M12 3v13', 'm7 11 5 5 5-5', 'M4 17v4h16v-4'],
    unload: ['M12 16V3', 'm7 8 5-5 5 5', 'M4 17v4h16v-4'],
    printer: ['M4 3h16v18H4Z', 'M7 6h10v11H7Z', 'M8 18h8', 'M9 6v4h6V6', 'M12 10v3', 'M7 17l3-3h4l3 3'],
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of iconPaths[name] || iconPaths.printer) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }
  function temperature(value) { return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}°` : '—'; }
  function filamentColor(slot) {
    const value = slot?.color;
    return typeof value === 'string' && /^#?[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value)
      ? `#${value.replace(/^#/, '').slice(0, 6)}` : null;
  }

  function render(container, context) {
    const { printerId, getState, bridge, updateState, toast } = context;
    function current() {
      const state = getState() || {};
      return { config: (state.config?.printers || []).find(item => item.id === printerId),
        printer: (state.printers || []).find(item => item.id === printerId) || {} };
    }
    const { config, printer } = current();
    let view = views.get(container);
    if (!view || view.printerId !== printerId) {
      if (view) { view.preview = false; clearTimeout(view.timer); view.generation++; }
      view = { printerId, root: null, busy: false, error: '', notice: '', slotKey: '', extruderKey: '',
        preview: false, timer: null, generation: 0, cameraEpoch: 0, cameraFlight: null, camera: null, tab: 'home',
        temperatureNozzle: '', nozzleDrafts: {}, bedDraft: null, jogStep: 1, jogConfirmed: false };
      views.set(container, view);
    }
    // Telemetry must not interrupt a confirmation or an in-flight request.
    if (context.liveRefresh && view.root?.isConnected && (view.busy || view.root.querySelector('dialog[open]'))) return false;
    if (view.root && !view.root.isConnected) { view.preview = false; view.camera = null; view.cameraEpoch++; view.jogConfirmed = false; }
    clearTimeout(view.timer);
    const generation = ++view.generation;
    const root = element('section', `printer-panel${context.liveRefresh ? ' is-live-refresh' : ''}`); root.dataset.edgePrinterRoot = printerId;
    root.setAttribute('aria-label', `${printer.name || config?.name || 'Printer'} controls`);
    root.setAttribute('aria-busy', String(view.busy));
    view.root = root; container.replaceChildren(root);
    const name = printer.name || config?.name || 'Printer';
    const telemetryCurrent = !['offline', 'error', 'not_configured', 'connecting'].includes(printer.status);
    const canSend = typeof bridge?.printerCommand === 'function';
    const canGetFrame = typeof bridge?.cameraFrame === 'function';

    function mounted() { return root.isConnected && view.root === root && views.get(container) === view; }
    function redraw() {
      if (container.isConnected && view.root?.isConnected && views.get(container) === view) render(container, { ...context, liveRefresh: false });
    }
    async function run(action) {
      if (view.busy) return;
      view.busy = true; view.error = ''; view.notice = ''; redraw();
      try { await action(); }
      catch (error) { view.error = safeMessage(error); if (typeof toast === 'function') toast(view.error); }
      finally { view.busy = false; redraw(); }
    }
    function button(label, onClick, disabled = false, primary = false) {
      const node = element('button', primary ? 'button primary' : 'button', label);
      node.type = 'button'; node.disabled = disabled;
      node.style.minHeight = '48px'; node.style.minWidth = '48px';
      node.addEventListener('click', onClick);
      return node;
    }
    function reasonFor(action, fallback) {
      const data = current().printer;
      return safeMessage(data.capabilityReasons?.[action] || fallback || 'This control is not currently available.');
    }
    function assertAllowed(action) {
      if (!canSend || current().printer.capabilities?.[action] !== true) throw new Error(reasonFor(action));
    }
    async function send(action, params = {}) {
      assertAllowed(action);
      const result = await bridge.printerCommand(printerId, action, params);
      view.notice = safeMessage(result?.message || 'Command sent. Waiting for the printer to confirm the change.');
      if (typeof toast === 'function') toast(view.notice);
      // Refreshing reads telemetry; it never assumes the command has succeeded.
      try { updateState(await bridge.getState()); }
      catch { /* Keep the sent message until the user explicitly refreshes. */ }
    }
    function confirmAction(title, detail, label, action) {
      if (view.busy || !mounted()) return;
      const dialog = element('dialog', 'printer-confirmation');
      dialog.setAttribute('aria-label', title);
      Object.assign(dialog.style, { inset: '0', margin: 'auto', width: 'min(520px, calc(100vw - 32px))',
        height: 'auto', maxHeight: 'calc(100dvh - 32px)', borderRadius: '20px', border: '1px solid var(--line)', padding: '24px' });
      dialog.append(element('h3', '', title));
      const text = element('p', 'notice', detail); dialog.append(text);
      const actions = element('div', 'form-actions');
      const cancel = button('Cancel', () => { dialog.close(); dialog.remove(); }); cancel.autofocus = true;
      const confirm = button(label, () => { dialog.close(); run(action); }, false, true);
      if(label==='Stop print'){confirm.classList.remove('primary');confirm.classList.add('danger');}
      actions.append(cancel, confirm); dialog.append(actions);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      root.append(dialog);
      try { dialog.showModal(); cancel.focus(); }
      catch { dialog.remove(); view.error = 'The confirmation could not be opened. Try the action again.'; redraw(); }
    }

    const rail = element('nav', 'printer-panel-rail'); rail.setAttribute('aria-label', 'Printer screens');
    const brand = element('div', 'printer-panel-model', printer.model || config?.model || 'Bambu');
    rail.append(brand);
    const screens = element('div', 'printer-panel-screens');
    const home = element('section', 'printer-panel-screen printer-panel-home');
    const machineControls = element('section', 'printer-panel-screen printer-panel-machine-controls');
    const filament = element('section', 'printer-panel-screen printer-panel-filament');
    const panels = { home, controls: machineControls, filament }; const navButtons = {};
    function setTab(tab, initial = false) {
      if (!initial) root.classList.remove('is-live-refresh');
      view.tab = tab;
      for (const [key, panel] of Object.entries(panels)) {
        panel.hidden = key !== tab;
        navButtons[key]?.setAttribute('aria-pressed', String(key === tab));
      }
    }
    for (const [tab, title, symbol] of [['home', 'Home', 'home'], ['controls', 'Controls', 'controls'], ['filament', 'Filament', 'spool']]) {
      const control = button(title, () => setTab(tab));
      control.className = 'printer-panel-nav'; control.prepend(icon(symbol)); navButtons[tab] = control; rail.append(control);
    }
    const railNote = element('span', 'printer-panel-rail-note', 'EDGE\nDECK'); rail.append(railNote);
    const main = element('div', 'printer-panel-main');
    const heading = element('header', 'printer-panel-top');
    const headingCopy = element('div', 'printer-panel-identity');
    const status = element('span', 'printer-panel-status', statusNames[printer.status] || 'Status unavailable');
    status.dataset.status = printer.status || 'unknown';
    headingCopy.append(element('h3', '', name), status);
    const headingActions = element('div', 'printer-panel-top-actions');
    if (typeof context.onSetup === 'function' && (!config?.configured || ['offline', 'not_configured'].includes(printer.status))) {
      headingActions.append(button('Connection settings', () => context.onSetup(), view.busy));
    }
    const refresh = button('Refresh status', () => run(async () => updateState(await bridge.getState())), view.busy);
    refresh.className = 'button printer-panel-refresh'; refresh.prepend(icon('refresh'));
    headingActions.append(refresh); heading.append(headingCopy, headingActions); main.append(heading);
    const messages = element('div', 'printer-panel-messages');
    if (printer.message) messages.append(element('p', 'printer-panel-help', safeMessage(printer.message)));
    if (view.error) { const error = element('p', 'form-error', view.error); error.setAttribute('role', 'alert'); messages.append(error); }
    if (view.notice || printer.lastCommand?.message || view.busy) {
      const notice = element('p', 'printer-panel-command', view.busy ? 'Sending your request…' : view.notice || safeMessage(printer.lastCommand.message));
      notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); messages.append(notice);
    }
    if (messages.childNodes.length) main.append(messages);
    screens.append(home, machineControls, filament); main.append(screens); root.append(rail, main); setTab(view.tab || 'home', true);
    const overview = element('div', 'printer-panel-overview');
    const controls = element('div', 'printer-panel-controls'); home.append(overview, controls);
    const thermal = element('div', 'printer-panel-thermal');
    for (const [label, value, symbol] of [['Nozzle', printer.nozzle, 'nozzle'], ['Heatbed', printer.bed, 'bed']]) {
      const tile = button('', () => { setTab('controls'); machineControls.querySelector(`[data-temperature-zone="${symbol}"]`)?.scrollIntoView({ block: 'nearest' }); });
      tile.className = 'printer-panel-temperature'; tile.setAttribute('aria-label', `${label} temperature controls`);
      const labelNode = element('span', 'printer-panel-temperature-label', label); labelNode.prepend(icon(symbol));
      const reading = element('strong', '', temperature(value));
      if (typeof value === 'number' && Number.isFinite(value)) reading.append(element('small', '', 'C'));
      tile.append(labelNode, reading, element('small', '', value == null ? 'Not reported · tap to control' : telemetryCurrent ? 'Current · tap to control' : 'Last reading · tap to control')); thermal.append(tile);
    }
    controls.append(thermal);
    const printControls = element('div', 'printer-panel-print-controls');
    const reasons = new Set();
    for (const [action, label, symbol] of [['pause', 'Pause print', 'pause'], ['resume', 'Resume print', 'play'], ['stop', 'Stop print', 'stop']]) {
      const allowed = canSend && printer.capabilities?.[action] === true;
      const control = button(label, () => {
        if (action === 'stop') confirmAction(`Stop the print on ${name}?`,
          'This ends the current print. It cannot be resumed after stopping.', 'Stop print', () => send('stop'));
        else run(() => send(action));
      }, view.busy || !allowed);
      control.className = `printer-panel-action${action === 'stop' ? ' danger' : ''}`;
      control.prepend(icon(symbol));
      if (!allowed) { const why = reasonFor(action); control.title = why; reasons.add(why); }
      printControls.append(control);
    }
    controls.append(printControls);
    if (reasons.size) controls.append(element('p', 'printer-panel-help printer-panel-capabilities', [...reasons].join(' ')));
    const job = element('div', 'printer-panel-job');
    job.append(element('span', 'printer-panel-eyebrow', telemetryCurrent ? 'CURRENT PRINT' : 'LAST REPORTED PRINT'),
      element('h3', '', printer.jobName || (['printing', 'paused'].includes(printer.status) ? 'Job name not reported' : 'No current print reported')));
    const phaseLabel = printer.stage?.label || printer.printPhase?.label || (typeof printer.printPhase === 'string' ? printer.printPhase : '');
    if (phaseLabel && !['offline', 'error', 'not_configured', 'connecting'].includes(printer.status)) {
      const phase = element('p', 'printer-panel-phase', safeMessage(phaseLabel, '')); phase.setAttribute('role', 'status'); job.append(phase);
    }
    const progress = typeof printer.progress === 'number' && Number.isFinite(printer.progress) ? Math.max(0, Math.min(100, printer.progress)) : null;
    const progressLine = element('div', 'printer-panel-job-numbers');
    progressLine.append(element('strong', '', progress == null ? '—' : `${Math.round(progress)}%`));
    const remaining = typeof printer.remainingMinutes === 'number' && Number.isFinite(printer.remainingMinutes) && printer.remainingMinutes >= 0 ? Math.round(printer.remainingMinutes) : null;
    const duration = remaining == null ? null : remaining >= 60 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m` : `${remaining}m`;
    progressLine.append(element('span', '', duration == null ? 'Time remaining not reported' : telemetryCurrent ? `${duration} remaining` : `Last estimate: ${duration}`));
    job.append(progressLine);
    const progressBar = element('div', 'printer-panel-progress');
    if (progress != null) {
      progressBar.setAttribute('role', 'progressbar'); progressBar.setAttribute('aria-label', telemetryCurrent ? 'Print progress' : 'Last reported print progress');
      progressBar.setAttribute('aria-valuenow', String(progress)); progressBar.setAttribute('aria-valuemin', '0'); progressBar.setAttribute('aria-valuemax', '100');
      const fill = element('span'); fill.style.width = `${progress}%`; progressBar.append(fill);
    }
    job.append(progressBar);

    function temperatureNozzles(data) {
      return (Array.isArray(data.temperatures?.nozzles) ? data.temperatures.nozzles : [])
        .filter(item => item && Number.isInteger(item.id) && item.id >= 0);
    }
    function heaterLimits(data, kind) {
      const value = data.controlLimits?.[kind];
      return value && Number.isFinite(value.min) && Number.isFinite(value.max) && value.min >= 0 && value.max >= value.min ? value : null;
    }
    function targetNumber(value, limits) {
      if (value === '' || value === null || value === undefined || !limits) return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max ? parsed : null;
    }
    function jogSteps(data) {
      return (Array.isArray(data.controlLimits?.axis?.steps) ? data.controlLimits.axis.steps : [])
        .filter(value => Number.isFinite(value) && value > 0 && [0.1, 1, 10].includes(value));
    }
    if (printer.capabilities?.moveAxis !== true) view.jogConfirmed = false;
    const heaterArea = element('div', 'printer-panel-heaters');
    const movement = element('section', 'printer-panel-motion');
    machineControls.append(heaterArea, movement);
    const nozzleChoices = temperatureNozzles(printer);
    if (!nozzleChoices.some(item => String(item.id) === view.temperatureNozzle)) view.temperatureNozzle = '';
    for (const kind of ['nozzle', 'bed']) {
      const isNozzle = kind === 'nozzle';
      const action = isNozzle ? 'setNozzleTemperature' : 'setBedTemperature';
      const zoneName = isNozzle ? 'Nozzle' : 'Heatbed';
      const card = element('section', 'printer-panel-heater'); card.dataset.temperatureZone = kind;
      const cardHeading = element('div', 'printer-panel-heater-heading');
      const title = element('h3', '', `${zoneName} temperature`); title.prepend(icon(kind));
      const range = element('span', 'printer-panel-help'); cardHeading.append(title, range); card.append(cardHeading);
      const nozzleButtons = [];
      if (isNozzle) {
        const chooser = element('div', 'printer-panel-heater-nozzles');
        for (const nozzle of nozzleChoices) {
          const control = button(nozzle.label || `Nozzle ${nozzle.id}`, () => {
            view.temperatureNozzle = String(nozzle.id);
            if (view.nozzleDrafts[view.temperatureNozzle] === undefined) {
              const latest = temperatureNozzles(current().printer).find(item => String(item.id) === view.temperatureNozzle);
              view.nozzleDrafts[view.temperatureNozzle] = Number.isFinite(latest?.target) ? String(latest.target) : '';
            }
            updateHeater();
          }, view.busy);
          control.className = 'printer-panel-choice'; control.setAttribute('aria-label', `Select ${nozzle.label || `nozzle ${nozzle.id}`} for temperature`);
          nozzleButtons.push({ control, id: String(nozzle.id) }); chooser.append(control);
        }
        if (!nozzleChoices.length) chooser.append(element('p', 'printer-panel-help', 'Waiting for reported nozzle information.'));
        card.append(chooser);
      } else if (view.bedDraft === null && Number.isFinite(printer.temperatures?.bed?.target)) {
        view.bedDraft = String(printer.temperatures.bed.target);
      }
      const readings = element('div', 'printer-panel-heater-readings');
      const actual = element('strong'); const reportedTarget = element('span'); readings.append(actual, reportedTarget); card.append(readings);
      const inputRow = element('div', 'printer-panel-target-row');
      const input = element('input', 'printer-panel-target-input');
      input.type = 'number'; input.step = '1'; input.inputMode = 'numeric'; input.placeholder = '—';
      input.setAttribute('aria-label', `${zoneName} target temperature`);
      function draft() { return isNozzle ? view.nozzleDrafts[view.temperatureNozzle] ?? '' : view.bedDraft ?? ''; }
      function writeDraft(value) {
        if (isNozzle) view.nozzleDrafts[view.temperatureNozzle] = value; else view.bedDraft = value;
      }
      function adjustTarget(amount) {
        const limits = heaterLimits(current().printer, kind); if (!limits || (isNozzle && !view.temperatureNozzle)) return;
        const existing = Number(draft());
        writeDraft(String(Math.max(limits.min, Math.min(limits.max, (Number.isFinite(existing) ? existing : limits.min) + amount))));
        updateHeater();
      }
      const minus = button('−5°', () => adjustTarget(-5)); minus.setAttribute('aria-label', `Decrease ${zoneName.toLowerCase()} target by 5 degrees`);
      const plus = button('+5°', () => adjustTarget(5)); plus.setAttribute('aria-label', `Increase ${zoneName.toLowerCase()} target by 5 degrees`);
      inputRow.append(minus, input, plus); card.append(inputRow);
      async function setTemperature(off = false) {
        assertAllowed(action);
        const latest = current().printer; const limits = heaterLimits(latest, kind);
        const target = targetNumber(off ? 0 : draft(), limits);
        if (target === null) throw new Error(limits ? `Enter a whole-number temperature from ${limits.min} to ${limits.max} °C.` : 'Temperature limits are unavailable. Refresh printer status.');
        const params = { target };
        if (isNozzle) {
          const nozzle = temperatureNozzles(latest).find(item => String(item.id) === view.temperatureNozzle);
          if (!nozzle) throw new Error('Select a reported nozzle before setting its temperature.');
          params.extruderId = nozzle.id;
        }
        await send(action, params);
      }
      const actions = element('div', 'printer-panel-temperature-actions');
      const off = button(`${zoneName} off`, () => run(() => setTemperature(true)));
      const set = button(`Set ${zoneName.toLowerCase()}`, () => run(() => setTemperature()), false, true);
      actions.append(off, set); card.append(actions);
      const helper = element('p', 'printer-panel-help'); card.append(helper); heaterArea.append(card);
      input.addEventListener('input', () => { writeDraft(input.value); updateHeater(false); });
      function updateHeater(syncInput = true) {
        const data = current().printer; const limits = heaterLimits(data, kind);
        const selected = isNozzle ? temperatureNozzles(data).find(item => String(item.id) === view.temperatureNozzle) : data.temperatures?.bed;
        const allowed = canSend && data.capabilities?.[action] === true && !!limits && (!isNozzle || !!selected);
        const target = targetNumber(draft(), limits);
        for (const item of nozzleButtons) item.control.setAttribute('aria-pressed', String(item.id === view.temperatureNozzle));
        actual.textContent = `${temperature(selected?.current)}${Number.isFinite(selected?.current) ? 'C' : ''}`;
        reportedTarget.textContent = `Reported target ${temperature(selected?.target)}${Number.isFinite(selected?.target) ? 'C' : ''}`;
        range.textContent = limits ? `${limits.min}–${limits.max} °C` : 'Limits not reported';
        if (limits) { input.min = String(limits.min); input.max = String(limits.max); }
        if (syncInput) input.value = draft();
        input.disabled = minus.disabled = plus.disabled = view.busy || !allowed;
        off.disabled = view.busy || !allowed || targetNumber(0, limits) === null;
        set.disabled = view.busy || !allowed || target === null;
        input.setAttribute('aria-invalid', String(draft() !== '' && target === null));
        helper.textContent = data.capabilities?.[action] !== true ? reasonFor(action) : !limits ? 'Waiting for this printer’s temperature limits.'
          : isNozzle && !selected ? 'Select a nozzle. Targets are applied only when you tap Set.'
            : target === null && draft() !== '' ? `Enter a whole-number temperature from ${limits.min} to ${limits.max} °C.` : 'Set sends the target. Reported readings update when the printer replies.';
        if (['offline', 'error', 'not_configured', 'connecting'].includes(data.status)) helper.textContent = `Temperatures are last reported readings. ${helper.textContent}`;
      }
      updateHeater();
    }
    const movementHeading = element('div', 'printer-panel-section-heading');
    movementHeading.append(element('h3', '', 'Move axes'), element('span', '', 'Each tap moves one selected step')); movement.append(movementHeading);
    const stepRow = element('div', 'printer-panel-steps'); stepRow.setAttribute('aria-label', 'Movement step');
    const steps = jogSteps(printer); const stepButtons = [];
    if (!steps.includes(view.jogStep)) view.jogStep = steps.includes(1) ? 1 : steps[0] ?? null;
    for (const value of steps) {
      const control = button(`${value} mm`, () => { view.jogStep = value; for (const item of stepButtons) item.control.setAttribute('aria-pressed', String(item.value === value)); }, view.busy);
      control.className = 'printer-panel-choice'; control.setAttribute('aria-pressed', String(view.jogStep === value));
      stepButtons.push({ control, value }); stepRow.append(control);
    }
    movement.append(stepRow);
    function jog(axis, sign) {
      const step = view.jogStep;
      const move = async () => {
        assertAllowed('moveAxis');
        if (!jogSteps(current().printer).includes(step)) throw new Error('This movement step is unavailable. Refresh printer status.');
        await send('moveAxis', { axis, distance: sign * step }); view.jogConfirmed = true;
      };
      if (view.jogConfirmed) run(move);
      else confirmAction('Move the printer axes?', `Move ${axis} by ${sign > 0 ? '+' : '−'}${step} mm. Keep hands and tools outside the printer and check that its travel is clear. Further jog taps move immediately until you close this console.`, 'Enable & move', move);
    }
    function homeAxes() {
      confirmAction('Home the printer axes?', 'The printer will move its toolhead and heatbed to find the home position. Keep hands and tools outside the printer and check that its travel is clear.', 'Home axes', () => send('homeAxes'));
    }
    const motionPad = element('div', 'printer-panel-motion-pads');
    const xy = element('div', 'printer-panel-xy'); xy.setAttribute('aria-label', 'X and Y axes');
    for (const [axis, sign, location, symbol] of [['Y', 1, 'north', 'up'], ['X', -1, 'west', 'left'], ['X', 1, 'east', 'right'], ['Y', -1, 'south', 'down']]) {
      const control = button(`${axis} ${sign > 0 ? '+' : '−'}`, () => jog(axis, sign), view.busy || !canSend || printer.capabilities?.moveAxis !== true || !view.jogStep);
      control.className = `printer-panel-jog ${location}`; control.setAttribute('aria-label', `Move ${axis} ${sign > 0 ? 'positive' : 'negative'}`); control.prepend(icon(symbol)); xy.append(control);
    }
    const homeAxesButton = button('Home axes', homeAxes, view.busy || !canSend || printer.capabilities?.homeAxes !== true);
    homeAxesButton.className = 'printer-panel-jog center'; homeAxesButton.prepend(icon('home')); xy.append(homeAxesButton);
    const z = element('div', 'printer-panel-z'); z.append(element('span', '', 'Z axis'));
    for (const sign of [1, -1]) {
      const control = button(`Z ${sign > 0 ? '+' : '−'}`, () => jog('Z', sign), view.busy || !canSend || printer.capabilities?.moveAxis !== true || !view.jogStep);
      control.className = 'printer-panel-jog'; control.setAttribute('aria-label', `Move Z ${sign > 0 ? 'positive' : 'negative'}`); z.append(control);
    }
    motionPad.append(xy, z); movement.append(motionPad);
    const motionReasons = new Set();
    for (const action of ['moveAxis', 'homeAxes']) if (printer.capabilities?.[action] !== true) motionReasons.add(reasonFor(action));
    if (!steps.length) motionReasons.add('Movement steps have not been reported.');
    if (motionReasons.size) movement.append(element('p', 'printer-panel-help', [...motionReasons].join(' ')));
    const homed = printer.motion?.homed;
    if (homed && typeof homed === 'object') {
      const labels = ['X', 'Y', 'Z'].map(axis => `${axis}: ${homed[axis] === true ? 'homed' : homed[axis] === false ? 'not homed' : 'unknown'}`);
      movement.append(element('p', 'printer-panel-homed', labels.join(' · ')));
    }
    movement.append(element('p', 'printer-panel-help', view.jogConfirmed ? 'Manual movement is enabled for this console session. Each tap moves immediately.' : 'Your first movement tap asks you to check that the printer is clear. Homing always asks for confirmation.'));

    function extrudersFor(data) {
      return (Array.isArray(data.filament?.extruders) ? data.filament.extruders : [])
        .filter(item => item && Number.isInteger(item.id) && item.id >= 0);
    }
    function slotsFor(data) {
      const candidates = data.filament?.loadableSlots ?? data.filament?.slots;
      const extruders = extrudersFor(data);
      return (Array.isArray(candidates) ? candidates : []).filter(item => item &&
        [item.amsId, item.slotId, item.extruderId].every(value => Number.isInteger(value) && value >= 0) &&
        extruders.some(extruder => extruder.id === item.extruderId));
    }
    function unloadableFor(data) {
      const candidates = data.filament?.unloadableExtruders ?? extrudersFor(data);
      return (Array.isArray(candidates) ? candidates : []).filter(item => item &&
        Number.isInteger(item.id) && item.id >= 0 && item.hasFilament === true &&
        Number.isInteger(item.amsId) && Number.isInteger(item.slotId));
    }
    const slotId = slot => `${slot.amsId}:${slot.slotId}:${slot.extruderId}`;
    const slots = slotsFor(printer);
    const extruders = extrudersFor(printer);
    const unloadable = unloadableFor(printer);
    const spoolArea = element('div', 'printer-panel-spool-area');
    const filamentActions = element('div', 'printer-panel-filament-actions');
    filament.append(spoolArea, filamentActions);
    const spoolHeading = element('div', 'printer-panel-section-heading');
    spoolHeading.append(element('h3', '', 'AMS filament'), element('span', '', 'Select a spool to load'));
    spoolArea.append(spoolHeading);
    const reportedSlots = Array.isArray(printer.filament?.slots) ? printer.filament.slots.filter(slot => slot && Number.isInteger(slot.amsId) && Number.isInteger(slot.slotId)) : [];
    const displayedSlots = reportedSlots.length ? reportedSlots : slots;
    const slotControls = [];
    const groups = new Map();
    for (const slot of displayedSlots) {
      if (!groups.has(slot.amsId)) groups.set(slot.amsId, []);
      groups.get(slot.amsId).push(slot);
    }
    for (const [amsId, amsSlots] of groups) {
      const group = element('div', 'printer-panel-ams');
      group.append(element('h4', '', `AMS ${amsId + 1}`));
      const grid = element('div', 'printer-panel-spools');
      for (const slot of amsSlots) {
        const eligible = slots.some(item => slotId(item) === slotId(slot));
        const loaded = extruders.some(item => item.hasFilament === true && item.amsId === slot.amsId && item.slotId === slot.slotId);
        const tile = button('', () => {
          view.slotKey = slotId(slot); loadSelect.value = view.slotKey; updateSelection();
        }, view.busy || !eligible);
        tile.className = 'printer-panel-spool';
        tile.setAttribute('aria-label', `${slot.label || `AMS ${amsId + 1} slot ${slot.slotId + 1}`} · ${slot.material || 'Material not reported'}`);
        tile.setAttribute('aria-pressed', String(view.slotKey === slotId(slot)));
        const spool = element('span', 'printer-panel-spool-shape'); spool.setAttribute('aria-hidden', 'true');
        const color = filamentColor(slot);
        if (color) { spool.style.setProperty('--filament-color', color); spool.classList.add('has-color'); }
        tile.append(spool, element('strong', '', slot.material || 'Unknown'), element('span', '', `Slot ${slot.slotId + 1}`),
          element('small', '', loaded ? 'Loaded' : eligible ? 'Available' : 'Route unavailable'));
        grid.append(tile); slotControls.push({ tile, key: slotId(slot) });
      }
      group.append(grid); spoolArea.append(group);
    }
    if (!groups.size) {
      const empty = element('div', 'printer-panel-filament-empty'); empty.append(icon('spool'), element('h3', '', 'Waiting for AMS information'),
        element('p', '', 'Reported spools and their nozzle routes will appear here.')); spoolArea.append(empty);
    }
    spoolArea.append(element('p', 'printer-panel-help', 'Only reported spools are shown. A neutral spool means its color has not been reported.'));
    const nozzleHeading = element('div', 'printer-panel-section-heading'); nozzleHeading.append(element('h3', '', 'Nozzles'), element('span', '', 'Select a loaded nozzle to unload'));
    filamentActions.append(nozzleHeading);
    const nozzles = element('div', 'printer-panel-nozzles'); const nozzleControls = [];
    for (const extruder of extruders) {
      const tile = button('', () => { view.extruderKey = String(extruder.id); unloadSelect.value = view.extruderKey; updateSelection(); },
        view.busy || !unloadable.some(item => item.id === extruder.id));
      tile.className = 'printer-panel-nozzle'; tile.setAttribute('aria-pressed', String(view.extruderKey === String(extruder.id)));
      tile.setAttribute('aria-label', extruder.label || 'Reported nozzle');
      tile.append(icon('nozzle'), element('strong', '', extruder.label || 'Reported nozzle'),
        element('span', '', extruder.hasFilament === true ? 'Filament detected' : extruder.hasFilament === false ? 'No filament detected' : 'Filament state unknown'));
      nozzles.append(tile); nozzleControls.push({ tile, key: String(extruder.id) });
    }
    if (!extruders.length) nozzles.append(element('p', 'printer-panel-help', 'No nozzle mapping reported yet.'));
    filamentActions.append(nozzles);
    const loadField = element('label', 'form-field printer-panel-field');
    loadField.append(element('span', '', 'AMS slot to load'));
    const loadSelect = element('select'); loadSelect.style.minHeight = '48px';
    const loadPlaceholder = element('option', '', slots.length ? 'Choose a reported AMS slot' : 'No supported AMS slots reported');
    loadPlaceholder.value = ''; loadSelect.append(loadPlaceholder);
    for (const slot of slots) {
      const nozzle = extruders.find(item => item.id === slot.extruderId);
      const label = [slot.label || 'Reported AMS slot', slot.material, nozzle?.label].filter(Boolean).join(' · ');
      const option = element('option', '', label); option.value = slotId(slot); loadSelect.append(option);
    }
    if (!slots.some(slot => slotId(slot) === view.slotKey)) view.slotKey = '';
    loadSelect.value = view.slotKey; loadSelect.disabled = view.busy || !slots.length;
    loadField.append(loadSelect); filamentActions.append(loadField);
    const route = element('p', 'printer-panel-route'); route.setAttribute('aria-live', 'polite'); filamentActions.append(route);
    const loadButton = button('Load filament', () => {
      const selected = slotsFor(current().printer).find(slot => slotId(slot) === view.slotKey);
      if (!selected) { view.error = 'Choose a reported AMS slot first.'; redraw(); return; }
      const nozzle = extrudersFor(current().printer).find(item => item.id === selected.extruderId);
      const params = { amsId: selected.amsId, slotId: selected.slotId, extruderId: selected.extruderId };
      confirmAction('Load filament?', `Load ${selected.label || 'the selected AMS slot'} into ${nozzle?.label || 'the reported nozzle'} on ${name}. The printer may heat the nozzle and move filament using its reported filament settings.`, 'Load filament', () => {
        if (!slotsFor(current().printer).some(slot => slotId(slot) === slotId(selected))) throw new Error('This slot or nozzle mapping changed. Refresh status and choose it again.');
        return send('loadFilament', params);
      });
    }, view.busy || !canSend || printer.capabilities?.loadFilament !== true || !view.slotKey);
    loadSelect.addEventListener('change', () => { view.slotKey = loadSelect.value; updateSelection(); });
    loadButton.classList.add('printer-panel-load'); loadButton.prepend(icon('load'));
    filamentActions.append(loadButton);
    if (printer.capabilities?.loadFilament !== true) filamentActions.append(element('p', 'printer-panel-help', reasonFor('loadFilament')));
    else if (!slots.length) filamentActions.append(element('p', 'printer-panel-help', 'Waiting for a supported AMS slot and its reported nozzle mapping.'));

    const unloadField = element('label', 'form-field printer-panel-field');
    unloadField.append(element('span', '', 'Nozzle to unload'));
    const unloadSelect = element('select'); unloadSelect.style.minHeight = '48px';
    const unloadPlaceholder = element('option', '', unloadable.length ? 'Choose a loaded nozzle' : 'No loaded nozzle with a verified mapping');
    unloadPlaceholder.value = ''; unloadSelect.append(unloadPlaceholder);
    for (const extruder of unloadable) {
      const option = element('option', '', extruder.label || 'Reported nozzle'); option.value = String(extruder.id); unloadSelect.append(option);
    }
    if (!unloadable.some(item => String(item.id) === view.extruderKey)) view.extruderKey = '';
    unloadSelect.value = view.extruderKey; unloadSelect.disabled = view.busy || !unloadable.length;
    unloadField.append(unloadSelect); filamentActions.append(unloadField);
    const unloadButton = button('Unload filament', () => {
      const selected = unloadableFor(current().printer).find(item => String(item.id) === view.extruderKey);
      if (!selected) { view.error = 'Choose a loaded nozzle first.'; redraw(); return; }
      confirmAction('Unload filament?', `Unload ${selected.label || 'the selected nozzle'} on ${name}. The printer may heat the nozzle and move filament using its reported filament settings.`, 'Unload filament', () => {
        if (!unloadableFor(current().printer).some(item => item.id === selected.id && item.amsId === selected.amsId && item.slotId === selected.slotId)) throw new Error('The loaded filament mapping changed. Refresh status and choose it again.');
        return send('unloadFilament', { extruderId: selected.id });
      });
    }, view.busy || !canSend || printer.capabilities?.unloadFilament !== true || view.extruderKey === '');
    unloadSelect.addEventListener('change', () => { view.extruderKey = unloadSelect.value; updateSelection(); });
    unloadButton.prepend(icon('unload')); filamentActions.append(unloadButton);
    if (printer.capabilities?.unloadFilament !== true) filamentActions.append(element('p', 'printer-panel-help', reasonFor('unloadFilament')));
    filamentActions.append(element('p', 'printer-panel-help', 'Load and unload can heat the nozzle and move filament. You will confirm the selected route before a command is sent.'));
    function updateSelection() {
      for (const control of slotControls) control.tile.setAttribute('aria-pressed', String(control.key === view.slotKey));
      for (const control of nozzleControls) control.tile.setAttribute('aria-pressed', String(control.key === view.extruderKey));
      const selected = slotsFor(current().printer).find(slot => slotId(slot) === view.slotKey);
      const nozzle = selected && extrudersFor(current().printer).find(item => item.id === selected.extruderId);
      route.textContent = selected ? `${selected.label || 'Selected spool'} → ${nozzle?.label || 'Reported nozzle'}` : 'Choose a spool to see its reported nozzle route.';
      loadButton.disabled = view.busy || !canSend || current().printer.capabilities?.loadFilament !== true || !selected;
      unloadButton.disabled = view.busy || !canSend || current().printer.capabilities?.unloadFilament !== true || view.extruderKey === '';
    }
    updateSelection();
    const filamentShortcut = button('', () => setTab('filament'));
    filamentShortcut.className = 'printer-panel-filament-shortcut';
    const shortcutCopy = element('span'); shortcutCopy.append(element('strong', '', 'Filament & AMS'),
      element('small', '', displayedSlots.length ? `${displayedSlots.length} reported ${displayedSlots.length === 1 ? 'spool' : 'spools'} · ${extruders.length} ${extruders.length === 1 ? 'nozzle' : 'nozzles'}` : 'View spools and nozzle routes'));
    filamentShortcut.append(icon('spool'), shortcutCopy, icon('arrow')); controls.append(filamentShortcut);

    const camera = element('div', 'printer-panel-camera');
    const cameraHeading = element('div', 'printer-panel-camera-heading');
    cameraHeading.append(element('span', 'printer-panel-eyebrow', 'PRINTER CAMERA'));
    const cameraStage = element('div', 'printer-panel-camera-stage');
    const cameraPlaceholder = element('div', 'printer-panel-camera-placeholder');
    cameraPlaceholder.append(icon('printer'), element('strong', '', 'Preview is off'), element('span', '', 'Start preview to see the printer camera'));
    const cameraImage = element('img'); cameraImage.alt = `Camera preview from ${name}`; cameraImage.hidden = true;
    cameraStage.append(cameraPlaceholder, cameraImage);
    const cameraMessage = element('p', 'printer-panel-help', 'Preview is stopped.');
    cameraMessage.setAttribute('role', 'status');
    const cameraTime = element('p', 'printer-panel-camera-time');
    const cameraAllowed = () => { const next = current(); return canGetFrame && next.config?.configured === true && next.printer.capabilities?.camera === true; };
    function drawCamera(frame, text) {
      const image = frame?.image;
      const valid = frame?.connected === true && typeof image === 'string' && image.length <= 8000000 &&
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
      if (valid) { if (cameraImage.src !== image) cameraImage.src = image; cameraImage.hidden = false; }
      else { cameraImage.hidden = true; cameraImage.removeAttribute('src'); }
      cameraPlaceholder.hidden = valid;
      cameraPlaceholder.querySelector('strong').textContent = view.preview ? 'Camera preview' : 'Preview is off';
      cameraPlaceholder.querySelector('span').textContent = view.preview ? 'Waiting for a live image' : 'Start preview to see the printer camera';
      cameraMessage.textContent = text || (frame?.error ? safeMessage(frame.error, 'Camera preview is unavailable.') : valid ? 'Live preview' : 'Waiting for a camera frame…');
      const timestamp = Date.parse(frame?.updatedAt);
      cameraTime.textContent = valid && Number.isFinite(timestamp) ? `Last frame ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';
    }
    cameraImage.addEventListener('error', () => { cameraImage.hidden = true; cameraPlaceholder.hidden = false; cameraMessage.textContent = 'The camera frame could not be displayed. Waiting for the next frame.'; });
    function stopPreview() {
      view.preview = false; view.camera = null; view.cameraEpoch++; clearTimeout(view.timer);
      if (mounted()) { cameraButton.textContent = 'Start preview'; cameraButton.disabled = !cameraAllowed(); drawCamera(null, 'Preview is stopped.'); }
    }
    function cameraActive(epoch) {
      if (!mounted() || !view.preview || view.generation !== generation || view.cameraEpoch !== epoch) {
        if (view.root === root && !root.isConnected) { view.preview = false; view.camera = null; }
        return false;
      }
      return true;
    }
    async function pollCamera(epoch) {
      if (!cameraActive(epoch)) return;
      let delay = 1000;
      if (!cameraAllowed()) { drawCamera(null, reasonFor('camera', 'Connect the camera in printer settings first.')); delay = 2000; }
      else {
        try {
          if (!view.cameraFlight) {
            const flight = Promise.resolve().then(() => bridge.cameraFrame(printerId)).finally(() => {
              if (view.cameraFlight === flight) view.cameraFlight = null;
            });
            view.cameraFlight = flight;
          }
          const frame = await view.cameraFlight;
          if (!cameraActive(epoch)) return;
          view.camera = frame; drawCamera(frame);
          if (!frame?.connected || frame?.error) delay = 2000;
        } catch (error) {
          if (!cameraActive(epoch)) return;
          view.camera = null; drawCamera(null, safeMessage(error, 'Camera preview is unavailable.')); delay = 2000;
        }
      }
      if (cameraActive(epoch)) view.timer = setTimeout(() => pollCamera(epoch), delay);
    }
    const cameraButton = button(view.preview ? 'Stop preview' : 'Start preview', () => {
      if (view.preview) { stopPreview(); return; }
      if (!cameraAllowed()) return;
      view.preview = true; cameraButton.textContent = 'Stop preview'; cameraButton.disabled = false;
      drawCamera(null, 'Connecting to the camera…'); pollCamera(++view.cameraEpoch);
    }, !view.preview && !cameraAllowed());
    cameraHeading.append(cameraButton); camera.append(cameraHeading, cameraStage, cameraMessage, cameraTime);
    if (!cameraAllowed()) camera.append(element('p', 'printer-panel-help printer-panel-camera-reason', config?.configured
      ? reasonFor('camera', 'Camera access is not currently available.') : 'Save the printer connection before starting its camera preview.'));
    overview.append(camera, job);
    if (view.preview) { drawCamera(view.camera, view.camera ? undefined : 'Connecting to the camera…'); pollCamera(++view.cameraEpoch); }
    return true;
  }

  window.EdgePrinterUI = Object.freeze({ render });
})();
