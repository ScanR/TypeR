import { findZipRootPrefix } from './updateLogic';

export const REQUIRED_PACKAGE_FILES = ['app/index.html', 'app/index.js', 'app/modern.html', 'app/legacy.html', 'app/modern.index.js', 'app/legacy.index.js', 'app/modern.css', 'app/legacy.css', 'app/host.jsx', 'CSXS/manifest.xml', 'locale/messages.properties', 'icons/iconNormal.png'];
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
