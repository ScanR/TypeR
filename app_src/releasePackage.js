import { findZipRootPrefix } from './updateLogic';

export const REQUIRED_PACKAGE_FILES = ['app/index.html', 'app/index.js', 'app/modern.html', 'app/legacy.html', 'app/modern.index.js', 'app/legacy.index.js', 'app/modern.css', 'app/legacy.css', 'app/host.jsx', 'CSXS/manifest.xml', 'locale/messages.properties', 'icons/iconNormal.png'];
// Files the release ZIP must ship so install_mac.sh / install_win.cmd can offer
// both editions: Legacy CEP (app/, CSXS/...) and UXP (TypeR-Silicon.ccx).
export const UXP_PACKAGE_FILE = 'TypeR-Silicon.ccx';
export const UXP_PLUGIN_ID = 'fr.scanr.typer.silicon';
export const RELEASE_INSTALLER_FILES = ['install_mac.sh', 'install_win.cmd', 'install.ps1', UXP_PACKAGE_FILE];
export const isPackagePath = (name) => /^(app|CSXS|icons|locale)\/[A-Za-z0-9_@./-]+$/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..');

// The inventory detects incomplete downloads and mixed builds. It is not a signature.
export const validateReleasePackage = (entries, hash, decode, expectedVersion) => {
  const prefix = findZipRootPrefix(Object.keys(entries));
  if (prefix === null) throw new Error('Missing TypeR manifest');
  const files = {};
  const seen = {};
  Object.keys(entries).forEach(name => {
    if (name.slice(0, prefix.length) !== prefix || name.endsWith('/')) return;
    const relative = name.slice(prefix.length);
    if (!/^(app|CSXS|icons|locale)[/\\]/.test(relative)) return;
    if (!isPackagePath(relative) || seen[relative.toLowerCase()]) throw new Error('Unsafe or duplicate package path');
    seen[relative.toLowerCase()] = true;
    files[relative] = entries[name];
  });
  REQUIRED_PACKAGE_FILES.concat('app/package.sha256').forEach(name => {
    if (!files[name] || !files[name].length) throw new Error('Incomplete package: ' + name);
  });
  const manifest = decode(files['CSXS/manifest.xml']);
  const version = /<Extension\s+Id="typer"\s+Version="(\d+\.\d+\.\d+)"\s*\/>/.exec(manifest);
  if (!version || !/ExtensionBundleId="com\.scanr\.typer"/.test(manifest) || !manifest.includes('ExtensionBundleVersion="' + version[1] + '"')) throw new Error('Invalid TypeR identity or version');
  if (expectedVersion && version[1] !== String(expectedVersion).replace(/^v/, '')) throw new Error('Release version mismatch');
  const listed = {};
  decode(files['app/package.sha256']).trim().split(/\r?\n/).forEach(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !isPackagePath(match[2]) || listed[match[2]] || match[2] === 'app/package.sha256') throw new Error('Invalid package inventory');
    const name = match[2];
    if (!files[name] || hash(files[name]) !== match[1]) throw new Error('Package checksum mismatch: ' + name);
    listed[name] = true;
  });
  Object.keys(files).forEach(name => {
    if (name !== 'app/package.sha256' && !listed[name]) throw new Error('Unlisted package file: ' + name);
  });
  return files;
};

// Checks the manifest.json read from TypeR-Silicon.ccx before it is released.
export const validateUxpManifest = (text, expectedVersion) => {
  let manifest;
  try { manifest = JSON.parse(text); } catch (error) { throw new Error('Invalid UXP manifest'); }
  if (!manifest || manifest.id !== UXP_PLUGIN_ID || !manifest.host || manifest.host.app !== 'PS') throw new Error('Invalid UXP plugin identity');
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version)) || !/^\d+(\.\d+)*$/.test(String(manifest.host.minVersion))) throw new Error('Invalid UXP plugin version');
  if (expectedVersion && manifest.version !== String(expectedVersion).replace(/^v/, '')) throw new Error('UXP package version mismatch');
  return manifest;
};
