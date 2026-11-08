(() => {
  'use strict';
  // Gauge widget: one reading (CPU, GPU, memory, video memory or a temperature) as a ring.
  // Placeholder until the widget is built.
  function render(body, ctx) { ctx.emptyContent(body, 'gauge', 'Gauge', 'This widget is being built.'); }
  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.gauge = Object.freeze({ render, signature: ctx => [ctx.item.metric, ctx.state().pc] });
})();
