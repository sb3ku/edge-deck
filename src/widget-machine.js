(() => {
  'use strict';
  // Printer widget: one printer at a glance.
  // Placeholder until the widget is built.
  function render(body, ctx) { ctx.emptyContent(body, 'printer', 'Printer', 'This widget is being built.'); }
  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.machine = Object.freeze({ render, signature: ctx => [ctx.item.printerId, ctx.state().printers, ctx.config().printers] });
})();
