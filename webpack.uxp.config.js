// UXP build: the plugin's host script (uxp/host.js) and the panel, which is the
// regular React application rendered in a WebView (uxp/web/). The panel uses
// the "modern" client configuration of webpack.config.js with a UXP entry: no
// CEP launcher, no legacy build, no ExtendScript host.
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const OUT = path.join(__dirname, "uxp");
const UXP_MODULES = ["photoshop", "uxp", "fs", "os", "path"];

const hostConfig = (env, argv, entry, filename, library) => ({
  name: library ? "uxp-host-test" : "uxp-host",
  mode: argv.mode || "production",
  target: "web",
  devtool: false,
  entry,
  output: Object.assign({ path: OUT, filename }, library ? { library: { name: library, type: "var" } } : {}),
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
  plugins: [new webpack.DefinePlugin({ TYPER_DEV: JSON.stringify(!!env.dev) })],
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
  plugins.push(new HtmlWebpackPlugin({ template: "./uxp-src/web/index.html", filename: "index.html" }));
  plugins.push(new MiniCssExtractPlugin({ filename: "index.css", chunkFilename: "[name].[contenthash:12].css" }));
  // The CEP library only talks to window.__adobe_cep__
  plugins.push(new webpack.NormalModuleReplacementPlugin(/[\\/]lib[\\/]CSInterface(\.js)?$/, path.join(__dirname, "uxp-src/web/csinterfaceStub.js")));
  plugins.push(new webpack.NormalModuleReplacementPlugin(/^\.\/CSInterface$/, path.join(__dirname, "uxp-src/web/csinterfaceStub.js")));
  plugins.push(new webpack.DefinePlugin({ "process.env.TYPER_UXP": JSON.stringify("1"), "process.env.TYPER_DEV": JSON.stringify(env.dev ? "1" : "0") }));
  const rules = modern.module.rules.map((rule) => {
    if (String(rule.test) !== String(/\.m?jsx?$/)) return rule;
    return Object.assign({}, rule, { include: undefined, exclude: /node_modules[\\/](?!react-icons[\\/]|fflate[\\/])/ });
  });
  return Object.assign({}, modern, {
    name: "uxp-panel",
    target: ["web", "es2017"],
    entry: { index: "./uxp-src/web/entry.js" },
    output: Object.assign({}, modern.output, {
      path: path.join(OUT, "web"),
      filename: "index.js",
      chunkFilename: "[name].[contenthash:12].index.js",
      publicPath: "./",
      clean: true,
    }),
    module: Object.assign({}, modern.module, { rules }),
    plugins,
  });
};

module.exports = (env = {}, argv = {}) => {
  if (env.hostTest) return [hostConfig(env, argv, "./uxp-src/host/photoshop.js", "host-test.js", "TypeRHost")];
  return [hostConfig(env, argv, "./uxp-src/host/main.js", "host.js"), panelConfig(env, argv)];
};
