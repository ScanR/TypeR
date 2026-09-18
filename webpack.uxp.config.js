const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// webpack.config.js exports [modern, legacy]. UXP embeds its own recent
// Chromium, so only the modern build is needed: the legacy one targets CEP's
// ES5 host and its bootstrap. The ExtendScript bundle (MergeIntoFile) is
// dropped too, since no host.jsx runs under UXP.
module.exports = (env, argv) => {
  const configs = require('./webpack.config')(env, argv);
  const modern = configs.find(config => config.name === 'modern') || configs[0];
  const plugins = modern.plugins.filter(plugin => (
    plugin.constructor.name !== 'MergeIntoFile' &&
    !(plugin instanceof HtmlWebpackPlugin) &&
    !(plugin instanceof MiniCssExtractPlugin)
  ));
  plugins.push(new HtmlWebpackPlugin({template: './uxp-src/panel.html', filename: 'index.html'}));
  plugins.push(new MiniCssExtractPlugin({filename: 'index.css', chunkFilename: '[name].[contenthash:12].css'}));
  plugins.push(new webpack.NormalModuleReplacementPlugin(/(^|\/)CSInterface$/, path.join(__dirname, 'uxp-src/csinterface.js')));
  return Object.assign({}, modern, {
    name: 'uxp',
    entry: {index: './uxp-src/browser-entry.js'},
    // Scope hoisting must stay off here. With it on, webpack folds the panel's
    // lazy require('../app_src/index.jsx') into the entry's own body, so the
    // application — and uxp-src/csinterface.js with it, which reads the init
    // payload — was evaluated before init had answered, threw at load time, and
    // the panel sat on its "Chargement…" placeholder for good. Off, the require
    // stays inside the entry's async function, after the await.
    optimization: Object.assign({}, modern.optimization, {concatenateModules: false}),
    output: Object.assign({}, modern.output, {
      path: path.join(__dirname, 'uxp/web'),
      filename: 'index.js',
      chunkFilename: '[name].[contenthash:12].index.js',
      publicPath: './',
      clean: true,
    }),
    plugins,
  });
};
