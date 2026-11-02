// Inline before the bundle, ES5: still runs if the application cannot parse.
(function () {
  function note(stage, detail) {
    try {
      if (window.uxpHost) window.uxpHost.postMessage(JSON.stringify({ type: 'diagnostic', stage: stage, detail: String(detail || '').slice(0, 1500) }));
    } catch (error) { /* The native watchdog records a missing bridge. */ }
  }
  window.typerDiagnosticNote = note;
  note('html.script', navigator.userAgent + '; bridge=' + !!window.uxpHost);
  window.addEventListener('error', function (event) {
    var target = event.target || {};
    note('html.error', event.message || ('resource: ' + (target.src || target.href || target.tagName || 'unknown')));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    note('html.rejection', event.reason && event.reason.message || event.reason);
  });
  document.addEventListener('DOMContentLoaded', function () { note('html.dom-ready', ''); });
}());
