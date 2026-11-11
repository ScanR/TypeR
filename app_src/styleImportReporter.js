// Kept apart from styleImport.js so the styles block can register itself
// without loading the import code (fflate, .tpl parser) at panel startup.
// An import started from a window that closes right after (style creation)
// reports through the styles block, which stays mounted.

let currentReporter = null;

const setStyleImportReporter = (reporter) => {
  currentReporter = reporter;
  return () => {
    if (currentReporter === reporter) currentReporter = null;
  };
};

const getStyleImportReporter = () => currentReporter;

export { getStyleImportReporter, setStyleImportReporter };
