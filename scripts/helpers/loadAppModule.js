const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
// Compiled sources, shared by every loader of the process: a suite that builds
// many loaders (one context per case) would otherwise run Babel again each time
const compiled = {};

module.exports = function createLoader(stubs = {}) {
  const cache = {};
  return function load(relativePath, append = '') {
    const filename = path.resolve(root, relativePath);
    if (cache[filename]) return cache[filename].exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (filename.endsWith('.jsxinc')) {
      // ExtendScript includes are plain scripts: "this" is the module exports
      const script = { exports: {} };
      cache[filename] = script;
      new Function('module', 'exports', fs.readFileSync(filename, 'utf8')).call(script.exports, script, script.exports);
      return script.exports;
    }
    const key = filename + '\n' + append;
    const { code } = compiled[key] || (compiled[key] = babel.transformSync(fs.readFileSync(filename, 'utf8') + '\n' + append, {
      filename, babelrc: false, configFile: false,
      presets: ['@babel/preset-react'], plugins: ['@babel/plugin-transform-modules-commonjs'],
    }));
    const mod = { exports: {} };
    cache[filename] = mod;
    const localRequire = (name) => {
      if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
      if (!name.startsWith('.')) return require(name);
      let target = path.resolve(path.dirname(filename), name);
      if (!path.extname(target)) target += fs.existsSync(target + '.js') ? '.js' : '.jsx';
      return load(target);
    };
    new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports);
    return mod.exports;
  };
};
