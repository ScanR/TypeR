const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { zipSync, unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));

// Refuse a stale native build, missing DLL, wrong manifest or external reader.
require('./verifyKeysAddonPackage');
const launcher = [
  '@echo off',
  'cd /d "%~dp0" || exit /b 1',
  '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\\install_addon.ps1" %*',
  'exit /b %errorlevel%', '',
].join('\r\n');
const guide = `TYPER UXP - Windows x64 - sans Creative Cloud

1. Extrais TOUT le ZIP dans un dossier (pas uniquement le fichier CMD).
2. Enregistre tes documents, puis ferme toutes les versions de Photoshop.
3. Double-clique sur Installer-TypeR-Addon.cmd.
4. Attends le message de confirmation de l'installation.
5. Lance Photoshop 2025 (26.0) ou plus recent.
6. Ouvre Plugins > TypeR.
7. Clique sur la toile, puis teste tes raccourcis habituels et boutons de souris.

Ne double-clique pas sur le CCX : le lanceur l'installe lui-meme hors ligne.
Creative Cloud, Node.js et le SDK Adobe ne sont pas necessaires pour installer.
Le dossier Photoshop est detecte automatiquement, y compris les chemins personnalises.
Pour indiquer un dossier manuellement depuis PowerShell :
.\\Installer-TypeR-Addon.cmd -PhotoshopPath "E:\\Adobe\\Adobe Photoshop 2026"

Cette version remplace TypeR UXP en conservant son identifiant et ses donnees.
L'installateur verifie les fichiers, sauvegarde l'ancienne version et annule ses
changements si l'installation echoue. Le chemin de sauvegarde est affiche.
Les copies existantes de TypeR dans les dossiers Plug-ins sont aussi actualisees.
Si l'acces a l'un de ces dossiers est refuse, relance le CMD en administrateur.
Les profils, styles et documents ne sont pas supprimes.

Le lecteur de raccourcis est un module .uxpaddon charge dans Photoshop.
Il ne lance pas TypeR Shortcuts.exe. Photoshop doit etre au premier plan,
mais le panneau TypeR n'a pas besoin d'avoir le focus.
Le module est non signe. Cette version ne garantit pas l'absence d'alertes antivirus.

Le chargement du module natif et les raccourcis ont ete testes dans Photoshop
sur Windows. Les tests automatises verifient le paquet et son installation.
En cas d'echec, conserve le message exact affiche par l'installateur ou Photoshop.
Pour revenir a la version classique, ferme Photoshop et utilise son installateur.
`;
const files = {
  'Installer-TypeR-Addon.cmd': Buffer.from(launcher),
  'installer/install_addon.ps1': read('installer/install_addon.ps1'),
  'installer/install.ps1': read('installer/install.ps1'),
  'CSXS/manifest.xml': read('CSXS/manifest.xml'),
  'TypeR-UXP-addon-win.ccx': read('Releases/TypeR-UXP-addon-win.ccx'),
  'TypeR-UXP-addon-win.ccx.sha256': read('Releases/TypeR-UXP-addon-win.ccx.sha256'),
  'LISEZ-MOI.txt': Buffer.from(guide.replace(/\r?\n/g, '\r\n')),
  'LICENSE.md': read('LICENSE.md'),
};
const zip = zipSync(files, { level: 9 });
const checked = unzipSync(zip);
for (const name of Object.keys(files)) assert(Buffer.from(checked[name]).equals(files[name]), name);
const name = 'TypeR-Addon-Windows.zip';
fs.writeFileSync(path.join(root, 'Releases', name), zip);
fs.writeFileSync(path.join(root, 'Releases', name + '.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  ' + name + '\n');
console.log('Offline addon installer ready: Releases/' + name + ' (' + zip.length + ' bytes)');
