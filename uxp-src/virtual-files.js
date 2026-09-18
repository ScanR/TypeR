// The panel stores its own data in files it names itself: it builds their paths
// from the extension path returned by CSInterface.getSystemPath, which is where
// the CEP version kept them (app_src/utils.js, app_src/profileStorage.js). A UXP
// plugin has no extension folder it may write to, so those paths are virtual:
// the panel keeps them in memory and the host keeps one file per path in the
// plugin's data folder. Both sides have to agree on the mapping, so it lives
// here rather than being spelled twice.
//
//   '/storage'          <-> 'storage.json'          (the CEP version's own name)
//   '/storage.bak'      <-> 'storage.bak.json'
//   '/storage_profiles' <-> 'storage_profiles.json'
//
// The panel's file system calls are synchronous, as CEP's were, so the panel
// reads the mirror the host filled at init and writes through it.
const VIRTUAL_PATH = /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;

// True for the panel's own paths only: a file the user picked is named
// 'file:<id>' and a locale is '/locale/<lang>/messages.properties', which the
// panel reads but never writes.
function isVirtualPath(path) {
  return typeof path === 'string' && VIRTUAL_PATH.test(path);
}

function fileForPath(path) {
  const match = isVirtualPath(path) ? VIRTUAL_PATH.exec(path) : null;
  return match ? `${match[1]}.json` : null;
}

function pathForFile(name) {
  if (typeof name !== 'string' || !name.endsWith('.json')) return null;
  const path = `/${name.slice(0, -'.json'.length)}`;
  return isVirtualPath(path) ? path : null;
}

module.exports = {isVirtualPath, fileForPath, pathForFile};
