import {request, showError} from './browser-rpc';

// Boot breadcrumbs: the panel's "Chargement…" placeholder only disappears when
// the host has answered init, so when it never does, the console is the only
// place that says how far the panel got.
async function start() {
  console.log('TypeR panel: script running');
  const initial = await request('init');
  console.log('TypeR panel: init answered, keys', Object.keys(initial || {}).join(','));
  window.typerUXP = {...initial, request};
  console.log('TypeR panel: requiring the application');
  // This require has to stay inside start(), after the await: the application
  // reads the init payload as it is evaluated, so loading it earlier crashes
  // the whole bundle before it can even ask for init. Scope hoisting used to
  // fold it back out into the entry's body — see optimization in
  // webpack.uxp.config.js.
  require('../app_src/index.jsx');
  console.log('TypeR panel: application loaded');
}
start().catch(error => {
  console.error('TypeR panel: boot failed:', (error && error.message) || error);
  showError(error);
});
