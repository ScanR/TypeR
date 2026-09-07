// Keep this launcher ES5 so CEP 6 can choose its compatible application build.
(function () {
  var chrome = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent || '');
  var photoshop = 0;
  try { photoshop = parseInt(JSON.parse(window.__adobe_cep__.getHostEnvironment()).appVersion, 10); } catch (error) { /* Unknown hosts use the compatibility build. */ }
  var modern = photoshop >= 21 && chrome && parseInt(chrome[1], 10) >= 74;
  window.location.replace((modern ? 'modern' : 'legacy') + '.html' + window.location.search + window.location.hash);
}());
