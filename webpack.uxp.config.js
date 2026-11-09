// UXP build: the plugin's host script (uxp/host.js) and the panel, which is the
// regular React application rendered in a WebView (uxp/web/). The panel uses
// the "modern" client configuration of webpack.config.js with a UXP entry: no
// CEP launcher, no legacy build, no ExtendScript host.
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const OUT = path.join(__dirname, "uxp");
const outputPath = (env) => env.mac ? path.join(__dirname, "uxp-mac") : env.addon ? path.join(__dirname, "uxp-addon") : OUT;
const UXP_MODULES = ["photoshop", "uxp", "fs", "os", "path", "typer-keys.uxpaddon"];
const webViewRepairSource = require('fs').readFileSync(path.join(__dirname, 'installer/repair_uxp_webview_win.ps1'), 'utf8');
const webViewRepairId = require('crypto').createHash('sha256').update(webViewRepairSource).digest('hex');
const windowsLauncher = require('./scripts/buildWindowsLauncher').verifiedLauncher();

const hostConfig = (env, argv, entry, filename, library) => ({
  name: library ? "uxp-host-test" : "uxp-host",
  mode: argv.mode || "production",
  target: "web",
  devtool: false,
  entry,
  output: Object.assign({ path: outputPath(env), filename }, library ? { library: { name: library, type: "var" } } : {}),
  externals: UXP_MODULES.reduce((externals, name) => Object.assign(externals, { [name]: "commonjs " + name }), {}),
  externalsType: "commonjs",
  resolve: { extensions: [".js", ".jsxinc"] },
  module: {
    rules: [
      { test: /\.jsxinc$/, type: "javascript/auto" },
      {
        // app_src helpers shared with the panel are ES modules
        test: /\.m?js$/,
        include: [path.join(__dirname, "app_src")],
        use: { loader: "babel-loader", options: { babelrc: false, configFile: false, presets: [["@babel/preset-env", { targets: { chrome: "100" }, modules: false }]] } },
      },
    ],
  },
  // Windows reads the keyboard with "TypeR Shortcuts.exe" (keysHelper.js), started from
  // UXP-Windows.ccx only. The native addon (keysAddon.js) is kept for its preview package.
  plugins: [new webpack.DefinePlugin({ TYPER_DEV: JSON.stringify(!!env.dev), TYPER_TRACE: JSON.stringify(!!env.trace), TYPER_DIAGNOSTIC: JSON.stringify(!!env.diagnostic),
    TYPER_WEBVIEW_REPAIR_SCRIPT: JSON.stringify(webViewRepairSource), TYPER_WEBVIEW_REPAIR_ID: JSON.stringify(webViewRepairId),
    TYPER_WINDOWS_LAUNCHER: JSON.stringify(windowsLauncher),
    TYPER_WINDOWS_READER: JSON.stringify(!env.mac && !env.addon) }),
    ...(env.addon ? [new webpack.NormalModuleReplacementPlugin(/^\.\/keysHelper$/, path.join(__dirname, "uxp-src/host/keysAddon.js"))] : [])],
  optimization: { minimize: false },
  performance: { hints: false },
});

const panelConfig = (env, argv) => {
  const configs = require("./webpack.config")(env, argv);
  const modern = configs.find((config) => config.name === "modern");
  const plugins = modern.plugins.filter((plugin) => (
    plugin.constructor.name !== "MergeIntoFile" &&
    !(plugin instanceof HtmlWebpackPlugin) &&
    !(plugin instanceof MiniCssExtractPlugin)
  ));
  plugins.push(new HtmlWebpackPlugin({ template: "./uxp-src/web/index.html", filename: "index.html",
    diagnosticSource: env.diagnostic ? require('fs').readFileSync(path.join(__dirname, 'uxp-src/web/diagnosticBoot.js'), 'utf8') : '' }));
  plugins.push(new MiniCssExtractPlugin({ filename: "index.css", chunkFilename: "[name].[contenthash:12].css" }));
  // The CEP library only talks to window.__adobe_cep__
  plugins.push(new webpack.NormalModuleReplacementPlugin(/[\\/]lib[\\/]CSInterface(\.js)?$/, path.join(__dirname, "uxp-src/web/csinterfaceStub.js")));
  plugins.push(new webpack.NormalModuleReplacementPlugin(/^\.\/CSInterface$/, path.join(__dirname, "uxp-src/web/csinterfaceStub.js")));
  plugins.push(new webpack.DefinePlugin({ "process.env.TYPER_UXP": JSON.stringify("1"), "process.env.TYPER_DEV": JSON.stringify(env.dev ? "1" : "0"), "process.env.TYPER_DIAGNOSTIC": JSON.stringify(env.diagnostic ? "1" : "0") }));
  const rules = modern.module.rules.map((rule) => {
    if (String(rule.test) !== String(/\.m?jsx?$/)) return rule;
    return Object.assign({}, rule, { include: undefined, exclude: /node_modules[\\/](?!react-icons[\\/]|fflate[\\/])/ });
  });
  return Object.assign({}, modern, {
    name: "uxp-panel",
    target: ["web", "es2017"],
    entry: { index: "./uxp-src/web/entry.js" },
    output: Object.assign({}, modern.output, {
      path: path.join(outputPath(env), "web"),
      filename: "index.js",
      chunkFilename: "[name].[contenthash:12].index.js",
      publicPath: "./",
      clean: true,
    }),
    module: Object.assign({}, modern.module, { rules }),
    plugins,
  });
};

// The same application, run in the panel's own DOM when Photoshop refuses
// to create a WebView (uxp-src/host/inPanel.js, docs/uxp-webview-refused.md).
// The plugin host loads it with UXP's require(), which runs one file: every
// lazy chunk is folded into it, its stylesheet is one file the host inserts,
// and assets resolve from the plugin root (uxp/inpanel/).
const inPanelConfig = (env, argv) => {
  const panel = panelConfig(env, argv);
  const plugins = panel.plugins.filter((plugin) => !(plugin instanceof HtmlWebpackPlugin) && !(plugin instanceof MiniCssExtractPlugin));
  plugins.push(new MiniCssExtractPlugin({ filename: "inpanel.css" }));
  plugins.push(new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
  plugins.push(new webpack.NormalModuleReplacementPlugin(/[\\/]fontFinderLogo(\.jsx)?$/, path.join(__dirname, "uxp-src/web/inpanel/fontFinderLogo.jsx")));
  // UXP's require() runs a file once and caches it: the bundle exports a
  // function that runs the application, which the host calls again when
  // Photoshop recreates the panel (a fresh webpack runtime each time)
  plugins.push(new webpack.BannerPlugin({ banner: "module.exports = function startTypeRInPanel() {", raw: true, entryOnly: true, test: /\.js$/ }));
  plugins.push(new webpack.BannerPlugin({ banner: "};", raw: true, footer: true, entryOnly: true, test: /\.js$/ }));
  // The application takes a global require for CEP's Node (storage, fonts,
  // updates). In the panel, the global require is UXP's: the application
  // must see none, as in its WebView
  plugins.push(new webpack.DefinePlugin({ "window.require": "undefined" }));
  // Stroke icons, which UXP's SVG renderer does not draw, become fill icons
  const resolve = Object.assign({}, panel.resolve, {
    alias: Object.assign({}, panel.resolve && panel.resolve.alias, {
      "react-icons/fi$": path.join(__dirname, "uxp-src/web/inpanel/iconsFi.js"),
      "react-icons/tb$": path.join(__dirname, "uxp-src/web/inpanel/iconsTb.js"),
    }),
  });
  // The stylesheets follow the buttons that are no longer <button> elements
  // (scripts/inPanelCss.js) and lose flex and grid gaps, as in the legacy
  // build for old Chromium (scripts/legacyCss.js)
  const rules = panel.module.rules.map((rule) => {
    if (!Array.isArray(rule.use)) return rule;
    return Object.assign({}, rule, { use: rule.use.map((loader) => {
      if (loader.loader !== "postcss-loader") return loader;
      const options = (loader.options && loader.options.postcssOptions) || {};
      return Object.assign({}, loader, { options: { postcssOptions: Object.assign({}, options, {
        plugins: (options.plugins || []).concat([require("./scripts/legacyCss")(), require("./scripts/inPanelCss")()]),
      }) } });
    }) });
  });
  return Object.assign({}, panel, {
    name: "uxp-inpanel",
    entry: { inpanel: "./uxp-src/web/inpanel/entry.js" },
    // An icon of app_src without its replacement fails the build
    module: Object.assign({}, panel.module, { rules, parser: { javascript: { exportsPresence: "error" } } }),
    resolve,
    output: Object.assign({}, panel.output, {
      path: path.join(outputPath(env), "inpanel"),
      filename: "inpanel.js",
      chunkFilename: "inpanel.[name].js",
      publicPath: "./inpanel/",
      clean: true,
    }),
    plugins,
  });
};

module.exports = (env = {}, argv = {}) => {
  if (env.mac && env.addon) throw new Error("Choose either macOS or Windows addon output");
  if (env.addon && (env.dev || env.trace || env.diagnostic || env.hostTest)) throw new Error("Build the Windows addon preview separately from developer/diagnostic builds");
  if (env.hostTest) return [hostConfig(env, argv, "./uxp-src/host/photoshop.js", "host-test.js", "TypeRHost")];
  return [hostConfig(env, argv, env.diagnostic ? "./uxp-src/host/diagnosticEntry.js" : env.trace ? "./uxp-src/host/traceEntry.js" : "./uxp-src/host/main.js", "host.js"), panelConfig(env, argv), inPanelConfig(env, argv)];
};
