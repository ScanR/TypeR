// Runs in native UXP, outside the WebView: diagnostics still work when the
// renderer is missing, blocked, or never executes the panel's JavaScript.
const { PANEL_RETRY_MS, PANEL_START_LIMIT_MS } = require('./panelStart');
const APP_START_LIMIT_MS = 15000;

function createPanelStartup({ show, environment, retry = () => {}, onFailure = () => {}, initiallyVisible = true, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let retryTimer = null;
  let visible = initiallyVisible;
  let retried = false;
  let state = 'idle';
  let bridge = false;
  let loadStarted = false;
  let loadStopped = false;
  const stopRetry = () => { if (retryTimer !== null) clearTimer(retryTimer); retryTimer = null; };
  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; stopRetry(); };
  const fail = (detail) => {
    stop();
    state = 'failed';
    const env = environment();
    const french = /^fr/i.test(env.locale || '');
    let text = french ? 'TypeR ne peut pas afficher son interface.\n' : 'TypeR could not display its interface.\n';
    text += String(detail) + '\nPhotoshop ' + env.photoshop + ' / UXP ' + env.uxp + ' / ' + env.platform;
    text += '\nWebView load: start=' + loadStarted + ', stop=' + loadStopped + ', bridge=' + bridge;
    text += french
      ? '\nVous pouvez utiliser la version Legacy : Fenêtre > Extensions > TypeR (CEP).'
      : '\nThe Legacy version may still work: Window > Extensions > TypeR (CEP).';
    if (!bridge && !loadStarted && !loadStopped) {
      // The view is still there: Photoshop 27.7 starts its WebView slowly
      text += french
        ? '\nTypeR attend encore : le panneau peut apparaître dans un instant (depuis Photoshop 27.7, le WebView met parfois longtemps à démarrer).'
        : '\nTypeR keeps waiting: the panel may still appear in a moment (since Photoshop 27.7, the WebView can take long to start).';
    }
    if (!bridge && !loadStopped && env.platform === 'win32') {
      text += french
        ? '\nVérifiez le composant UXP WebView / Microsoft Edge WebView2 de Photoshop. S’il est absent ou endommagé, réparez l’installation Adobe, puis redémarrez Photoshop.'
        : '\nCheck Photoshop’s UXP WebView / Microsoft Edge WebView2 component. If missing or damaged, repair the Adobe installation, then restart Photoshop.';
    }
    show(text, true);
    onFailure(text, { bridge });
  };
  const watch = () => {
    stop();
    if (!visible || state !== 'loading') return;
    if (!bridge && !loadStarted && !loadStopped && !retried) {
      retryTimer = setTimer(() => {
        retryTimer = null;
        if (!visible || state !== 'loading' || bridge || loadStarted || loadStopped) return;
        retried = true;
        try { retry(); } catch (error) { fail(String(error && error.message || error)); }
      }, PANEL_RETRY_MS);
    }
    timer = setTimer(() => {
      fail(bridge ? 'The panel did not finish initializing (15 s).' : 'No response from the WebView (15 s).');
    }, bridge ? APP_START_LIMIT_MS : PANEL_START_LIMIT_MS);
  };
  return {
    begin() {
      stop();
      bridge = false;
      loadStarted = false;
      loadStopped = false;
      retried = false;
      state = 'loading';
      show(/^fr/i.test(environment().locale || '') ? 'Chargement de TypeR…' : 'Loading TypeR…', false);
      watch();
    },
    bridgeReady() {
      if (bridge) return;
      bridge = true;
      // A late bridge may still finish rendering after the native timeout.
      // Keep its page visible and give initialization its own bounded deadline.
      if (state === 'failed') { state = 'loading'; show('Loading TypeR…', false); }
      watch();
    },
    loadStarted() { loadStarted = true; stopRetry(); },
    loadStopped() { loadStopped = true; stopRetry(); },
    appReady() { stop(); bridge = true; state = 'ready'; show('', false); },
    setVisible(value) {
      if (visible === value) return;
      visible = value;
      watch();
    },
    fail,
    loadError(event) {
      fail('WebView: ' + (event.message || 'load error') +
        (event.code !== undefined ? ' (code ' + event.code + ')' : '') +
        (event.url ? '\n' + event.url : ''));
    },
    dispose() { stop(); state = 'idle'; },
    getState() { return state; }
  };
}
module.exports = { createPanelStartup };
