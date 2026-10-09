// Stands in for app_src/lib/CSInterface.js in the UXP build: the CEP library
// talks to window.__adobe_cep__, which a UXP WebView does not have. The
// globals it defined (CSInterface, CSEvent, SystemPath) are installed by
// uxp-src/web/cepShim.js before the application is loaded.
export default window.CSInterface;
