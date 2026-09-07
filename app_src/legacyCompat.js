import 'core-js/stable';
import 'whatwg-fetch';
import ResizeObserver from 'resize-observer-polyfill';
import cssVars from 'css-vars-ponyfill';

if (typeof window.ResizeObserver !== 'function') window.ResizeObserver = ResizeObserver;
if (!window.CSS || !window.CSS.supports || !window.CSS.supports('color', 'var(--test)')) {
  const variables = {};
  let timer;
  window.typerLegacyCSSVariable = (name, value) => {
    if (value === null) delete variables[name];
    else variables[name] = value;
    clearTimeout(timer);
    timer = setTimeout(() => cssVars({ watch: true, variables }), 0);
  };
  cssVars({ watch: true, variables });
}
