// Runs in native UXP, outside the WebView: diagnostics still work when the
// renderer is missing, blocked, or never executes the panel's JavaScript.
const { PANEL_START_LIMIT_MS } = require('./panelStart');
const APP_START_LIMIT_MS = 15000;

function createPanelStartup({ show, environment, onFailure = () => {}, canRender = () => true, initiallyVisible = true, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let visible = initiallyVisible;
  let state = 'idle';
  let bridge = false;
  let loadStarted = false;
  let loadStopped = false;
  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const fail = (detail, reason = 'application') => {
    stop();
    state = 'failed';
    const env = environment();
    const french = /^fr/i.test(env.locale || '');
    // The facts first; the guesses after them are replaced when the host page
    // finds the cause in Photoshop's log (onFailure)
    let head = french ? 'TypeR ne peut pas afficher son interface.\n' : 'TypeR could not display its interface.\n';
    head += String(detail) + '\nPhotoshop ' + env.photoshop + ' / UXP ' + env.uxp + ' / ' + env.platform;
    head += '\nWebView load: start=' + loadStarted + ', stop=' + loadStopped + ', bridge=' + bridge;
    head += french
      ? '\nVous pouvez utiliser la version Legacy : Fenêtre > Extensions > TypeR (CEP).'
      : '\nThe Legacy version may still work: Window > Extensions > TypeR (CEP).';
    let hints = '';
    if (!bridge && !loadStarted && !loadStopped) {
      // The view is still there: Photoshop 27.7 starts its WebView slowly
      hints += french
        ? '\nTypeR attend encore : le panneau peut apparaître dans un instant (depuis Photoshop 27.7, le WebView met parfois longtemps à démarrer).'
        : '\nTypeR keeps waiting: the panel may still appear in a moment (since Photoshop 27.7, the WebView can take long to start).';
    }
    if (!bridge && !loadStopped && env.platform === 'win32') {
      hints += french
        ? '\nVérifiez le composant UXP WebView / Microsoft Edge WebView2 de Photoshop. S’il est absent ou endommagé, réparez l’installation Adobe, puis redémarrez Photoshop.'
        : '\nCheck Photoshop’s UXP WebView / Microsoft Edge WebView2 component. If missing or damaged, repair the Adobe installation, then restart Photoshop.';
    }
    show(head + hints, true);
    onFailure(head + hints, { bridge, head, french, reason });
  };
  const watch = () => {
    stop();
    if (!visible || state !== 'loading') return;
    // A cold WebView can take more than 15 s. Keep the same view alive:
    // assigning src again can restart the very load we are waiting for.
    // Load events alone cannot prove the bridge will ever become usable.
    timer = setTimer(() => {
      if (!bridge && !canRender()) { watch(); return; }
      fail(bridge ? 'The panel did not finish initializing (15 s).' : 'No response from the WebView (30 s).', bridge ? 'application' : 'renderer-timeout');
    }, bridge ? APP_START_LIMIT_MS : PANEL_START_LIMIT_MS);
  };
  return {
    begin() {
      stop();
      bridge = false;
      loadStarted = false;
      loadStopped = false;
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
    loadStarted() { loadStarted = true; },
    loadStopped() { loadStopped = true; },
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
        (event.url ? '\n' + event.url : ''), bridge ? 'application' : 'renderer-error');
    },
    dispose() { stop(); state = 'idle'; },
    getState() { return state; }
  };
}
module.exports = { createPanelStartup };
