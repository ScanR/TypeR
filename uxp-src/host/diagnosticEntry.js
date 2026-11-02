const diagnostic = require('./diagnostics');
diagnostic.start();
try {
  require('./main');
  diagnostic.note('host.modules.loaded', 'entrypoints registered');
} catch (error) {
  diagnostic.fatal(error);
  // Keep export available even if the normal plugin entry never registered.
  require('uxp').entrypoints.setup({ panels: { typer: {
    create() { diagnostic.fatal(error); }, show() { diagnostic.fatal(error); }
  } } });
}
