const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');

module.exports = function createLoader(stubs = {}) {
  const cache = {};
  return function load(relativePath, append = '') {
    const filename = path.resolve(root, relativePath);
    if (cache[filename]) return cache[filename].exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8') + '\n' + append, {
      filename, babelrc: false, configFile: false,
      presets: ['@babel/preset-react'], plugins: ['@babel/plugin-transform-modules-commonjs'],
    });
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
