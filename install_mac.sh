#!/bin/bash
set -euo pipefail

# —————————————————————————————————————————————————————————————
# Répertoire du script (pour pointer sur manifest.xml)
# —————————————————————————————————————————————————————————————
SRCDIR=$(cd "${TYPER_INSTALL_SOURCE:-$(dirname "$0")}" && pwd)

# —————————————————————————————————————————————————————————————
# Récupération de la version depuis CSXS/manifest.xml
# —————————————————————————————————————————————————————————————
MANIFEST="$SRCDIR/CSXS/manifest.xml"
EXT_VERSION=""
if [ -f "$MANIFEST" ]; then
  EXT_VERSION=$(grep -oE '<Extension Id="typer" Version="[^"]+"' "$MANIFEST" \
    | sed -E 's/.*Version="([^"]+)".*/\1/')
fi
# (optionnel : debug)
# echo "Version détectée : $EXT_VERSION"

# —————————————————————————————————————————————————————————————
# Options : --silent, --uxp, --cep (ou TYPER_INSTALL_EDITION=uxp|cep)
# Sans choix explicite, une installation non interactive reste en CEP.
# —————————————————————————————————————————————————————————————
SILENT=0
EDITION="${TYPER_INSTALL_EDITION:-}"
EDITION_FLAG=""
for argument in "$@"; do
  case "$argument" in
    --silent) SILENT=1 ;;
    --uxp|--cep)
      if [ -n "$EDITION_FLAG" ] && [ "$EDITION_FLAG" != "${argument#--}" ]; then
        echo 'Choose only one of --uxp or --cep' >&2; exit 2
      fi
      EDITION_FLAG="${argument#--}" ;;
    *) echo "Unknown option: $argument (use --uxp, --cep or --silent)" >&2; exit 2 ;;
  esac
done
[ -z "$EDITION_FLAG" ] || EDITION="$EDITION_FLAG"
EDITION="$(printf '%s' "$EDITION" | tr '[:upper:]' '[:lower:]')"
case "$EDITION" in
  ""|uxp|cep) ;;
  legacy) EDITION=cep ;;
  *) echo "Invalid TYPER_INSTALL_EDITION: $EDITION (use uxp or cep)" >&2; exit 2 ;;
esac
INTERACTIVE=0
if [ -t 0 ] && [ "$SILENT" -eq 0 ] && [ "${TYPER_INSTALL_VALIDATE_ONLY:-}" != 1 ]; then INTERACTIVE=1; fi

# Édition UXP : archive .ccx livrée à côté de ce script
UXP_ID="fr.scanr.typer.silicon"
UXP_CCX="$SRCDIR/TypeR-Silicon.ccx"
UXP_MIN_VERSION="26.0.0"
UXP_VERSION=""
if [ -f "$UXP_CCX" ]; then
  UXP_MANIFEST_JSON="$(unzip -p "$UXP_CCX" manifest.json 2>/dev/null || true)"
  if [ -n "$UXP_MANIFEST_JSON" ]; then
    UXP_MIN_VERSION="$(printf '%s' "$UXP_MANIFEST_JSON" | plutil -extract host.minVersion raw -o - - 2>/dev/null || printf '%s' "$UXP_MIN_VERSION")"
    UXP_VERSION="$(printf '%s' "$UXP_MANIFEST_JSON" | plutil -extract version raw -o - - 2>/dev/null || true)"
  fi
fi
UXP_MIN_MAJOR="${UXP_MIN_VERSION%%.*}"
case "$UXP_MIN_MAJOR" in ''|*[!0-9]*) UXP_MIN_MAJOR=26 ;; esac
# Photoshop 21 = 2020, donc 26 = 2025
UXP_MIN_YEAR=$((UXP_MIN_MAJOR + 1999))

# —————————————————————————————————————————————————————————————
# Détection de la langue système
# —————————————————————————————————————————————————————————————
LANGUAGE=$((defaults read -g AppleLocale 2>/dev/null || printf 'en') | cut -d"_" -f1)

# —————————————————————————————————————————————————————————————
# Messages en anglais
# —————————————————————————————————————————————————————————————
MSG_INSTALL_EN="Photoshop extension TypeR v$EXT_VERSION will be installed."
MSG_CLOSE_PHOTOSHOP_EN="Close Photoshop (if it is open)."
MSG_PRESS_KEY_EN="Press any key to continue"
MSG_INSTALL_COMPLETE_EN="Installation completed."
MSG_OPEN_PHOTOSHOP_EN="Open Photoshop and in the menu click the following: [Window] > [Extensions] > [TypeR]"
MSG_PRESS_ENTER_EN="Press Enter to continue"
MSG_CREDITS_EN="TypeR developed by Sakushi & SeanR."
MSG_TYPERTOOLS_EN="typertools, developed by Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_EN="ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"

# —————————————————————————————————————————————————————————————
# Messages en français
# —————————————————————————————————————————————————————————————
MSG_INSTALL_FR="L'extension Photoshop TypeR v$EXT_VERSION sera installée."
MSG_CLOSE_PHOTOSHOP_FR="Fermez Photoshop (s'il est ouvert)."
MSG_PRESS_KEY_FR="Appuyez sur une touche pour continuer"
MSG_INSTALL_COMPLETE_FR="Installation terminée."
MSG_OPEN_PHOTOSHOP_FR="Ouvrez Photoshop et dans le menu cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
MSG_PRESS_ENTER_FR="Appuyez sur Entrée pour continuer"
MSG_CREDITS_FR="TypeR développé par Sakushi & SeanR."
MSG_TYPERTOOLS_FR="typertools, développé par Swirt : https://swirt.github.io/typertools/"
MSG_DISCORD_FR="Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"

# —————————————————————————————————————————————————————————————
# Messages en espagnol
# —————————————————————————————————————————————————————————————
MSG_INSTALL_ES="La extensión de Photoshop TypeR v$EXT_VERSION será instalada."
MSG_CLOSE_PHOTOSHOP_ES="Cierra Photoshop (si está abierto)."
MSG_PRESS_KEY_ES="Presiona cualquier tecla para continuar"
MSG_INSTALL_COMPLETE_ES="Instalación completada."
MSG_OPEN_PHOTOSHOP_ES="Abre Photoshop y en el menú haz clic en: [Ventana] > [Extensiones] > [TypeR]"
MSG_PRESS_ENTER_ES="Presiona Enter para continuar"
MSG_CREDITS_ES="TypeR desarrollado por Sakushi & SeanR."
MSG_TYPERTOOLS_ES="typertools, desarrollado por Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_ES="Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"

# —————————————————————————————————————————————————————————————
# Messages en portugais
# —————————————————————————————————————————————————————————————
MSG_INSTALL_PT="A extensão Photoshop TypeR v$EXT_VERSION será instalada."
MSG_CLOSE_PHOTOSHOP_PT="Feche o Photoshop (se estiver aberto)."
MSG_PRESS_KEY_PT="Pressione qualquer tecla para continuar"
MSG_INSTALL_COMPLETE_PT="Instalação concluída."
MSG_OPEN_PHOTOSHOP_PT="Abra o Photoshop e no menu clique em: [Janela] > [Extensões] > [TypeR]"
MSG_PRESS_ENTER_PT="Pressione Enter para continuar"
MSG_CREDITS_PT="TypeR desenvolvido por Sakushi & SeanR."
MSG_TYPERTOOLS_PT="typertools, desenvolvido por Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_PT="Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"

# —————————————————————————————————————————————————————————————
# Affectation des messages en fonction de la langue
# —————————————————————————————————————————————————————————————
if [ "$LANGUAGE" = "fr" ]; then
  MSG_INSTALL=$MSG_INSTALL_FR
  MSG_CLOSE_PHOTOSHOP=$MSG_CLOSE_PHOTOSHOP_FR
  MSG_PRESS_KEY=$MSG_PRESS_KEY_FR
  MSG_INSTALL_COMPLETE=$MSG_INSTALL_COMPLETE_FR
  MSG_OPEN_PHOTOSHOP=$MSG_OPEN_PHOTOSHOP_FR
  MSG_PRESS_ENTER=$MSG_PRESS_ENTER_FR
  MSG_CREDITS=$MSG_CREDITS_FR
  MSG_TYPERTOOLS=$MSG_TYPERTOOLS_FR
  MSG_DISCORD=$MSG_DISCORD_FR
elif [ "$LANGUAGE" = "es" ]; then
  MSG_INSTALL=$MSG_INSTALL_ES
  MSG_CLOSE_PHOTOSHOP=$MSG_CLOSE_PHOTOSHOP_ES
  MSG_PRESS_KEY=$MSG_PRESS_KEY_ES
  MSG_INSTALL_COMPLETE=$MSG_INSTALL_COMPLETE_ES
  MSG_OPEN_PHOTOSHOP=$MSG_OPEN_PHOTOSHOP_ES
  MSG_PRESS_ENTER=$MSG_PRESS_ENTER_ES
  MSG_CREDITS=$MSG_CREDITS_ES
  MSG_TYPERTOOLS=$MSG_TYPERTOOLS_ES
  MSG_DISCORD=$MSG_DISCORD_ES
elif [ "$LANGUAGE" = "pt" ]; then
  MSG_INSTALL=$MSG_INSTALL_PT
  MSG_CLOSE_PHOTOSHOP=$MSG_CLOSE_PHOTOSHOP_PT
  MSG_PRESS_KEY=$MSG_PRESS_KEY_PT
  MSG_INSTALL_COMPLETE=$MSG_INSTALL_COMPLETE_PT
  MSG_OPEN_PHOTOSHOP=$MSG_OPEN_PHOTOSHOP_PT
  MSG_PRESS_ENTER=$MSG_PRESS_ENTER_PT
  MSG_CREDITS=$MSG_CREDITS_PT
  MSG_TYPERTOOLS=$MSG_TYPERTOOLS_PT
  MSG_DISCORD=$MSG_DISCORD_PT
else
  MSG_INSTALL=$MSG_INSTALL_EN
  MSG_CLOSE_PHOTOSHOP=$MSG_CLOSE_PHOTOSHOP_EN
  MSG_PRESS_KEY=$MSG_PRESS_KEY_EN
  MSG_INSTALL_COMPLETE=$MSG_INSTALL_COMPLETE_EN
  MSG_OPEN_PHOTOSHOP=$MSG_OPEN_PHOTOSHOP_EN
  MSG_PRESS_ENTER=$MSG_PRESS_ENTER_EN
  MSG_CREDITS=$MSG_CREDITS_EN
  MSG_TYPERTOOLS=$MSG_TYPERTOOLS_EN
  MSG_DISCORD=$MSG_DISCORD_EN
fi

# —————————————————————————————————————————————————————————————
# Messages du choix d'édition (français / anglais)
# —————————————————————————————————————————————————————————————
if [ "$LANGUAGE" = "fr" ]; then
  MSG_CHOOSE="Choisissez l'édition de TypeR à installer :"
  MSG_OPTION_UXP="  1) UXP (nouvelle édition, recommandée) : Photoshop $UXP_MIN_YEAR (v$UXP_MIN_MAJOR.0) ou plus récent, y compris sur Apple Silicon."
  MSG_OPTION_CEP="  2) Legacy (CEP) : anciennes versions de Photoshop, antérieures à $UXP_MIN_YEAR (v$UXP_MIN_MAJOR.0)."
  MSG_DETECTED="Photoshop détecté :"
  MSG_NONE_DETECTED="Aucun Photoshop détecté dans /Applications."
  MSG_CHOICE="Votre choix"
  MSG_INVALID_CHOICE="Répondez 1 (UXP) ou 2 (Legacy CEP)."
  MSG_INSTALL_UXP="Le plugin Photoshop TypeR Silicon (UXP) v$UXP_VERSION sera installé."
  MSG_OPEN_UXP="Ouvrez Photoshop et dans le menu cliquez sur : [Plug-ins] > [TypeR Silicon]"
  MSG_UXP_FALLBACK="Si TypeR Silicon n'apparaît pas, double-cliquez sur TypeR-Silicon.ccx pour l'installer avec Creative Cloud."
else
  MSG_CHOOSE="Choose the TypeR edition to install:"
  MSG_OPTION_UXP="  1) UXP (new edition, recommended): Photoshop $UXP_MIN_YEAR (v$UXP_MIN_MAJOR.0) or newer, including Apple Silicon."
  MSG_OPTION_CEP="  2) Legacy (CEP): older Photoshop versions, before $UXP_MIN_YEAR (v$UXP_MIN_MAJOR.0)."
  MSG_DETECTED="Detected Photoshop:"
  MSG_NONE_DETECTED="No Photoshop found in /Applications."
  MSG_CHOICE="Your choice"
  MSG_INVALID_CHOICE="Answer 1 (UXP) or 2 (Legacy CEP)."
  MSG_INSTALL_UXP="Photoshop plugin TypeR Silicon (UXP) v$UXP_VERSION will be installed."
  MSG_OPEN_UXP="Open Photoshop and in the menu click the following: [Plugins] > [TypeR Silicon]"
  MSG_UXP_FALLBACK="If TypeR Silicon is missing, double-click TypeR-Silicon.ccx to install it with Creative Cloud."
fi

# The newest installed Photoshop only selects the recommended default answer.
detect_photoshop_version() {
  best=""
  best_major=0
  for app in /Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app; do
    [ -f "$app/Contents/Info.plist" ] || continue
    found="$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)"
    major="${found%%.*}"
    case "$major" in ''|*[!0-9]*) continue ;; esac
    if [ "$major" -gt "$best_major" ]; then best_major="$major"; best="$found"; fi
  done
  printf '%s' "$best"
}

if [ -z "$EDITION" ] && [ "$INTERACTIVE" -eq 1 ]; then
  PHOTOSHOP_VERSION="$(detect_photoshop_version)"
  DEFAULT_CHOICE=1
  if [ -n "$PHOTOSHOP_VERSION" ] && [ "${PHOTOSHOP_VERSION%%.*}" -lt "$UXP_MIN_MAJOR" ]; then DEFAULT_CHOICE=2; fi
  printf '%s\n' "$MSG_CHOOSE" "$MSG_OPTION_UXP" "$MSG_OPTION_CEP"
  if [ -n "$PHOTOSHOP_VERSION" ]; then printf '%s %s\n' "$MSG_DETECTED" "$PHOTOSHOP_VERSION"; else printf '%s\n' "$MSG_NONE_DETECTED"; fi
  while [ -z "$EDITION" ]; do
    read -r -p "$MSG_CHOICE [$DEFAULT_CHOICE] : " answer
    case "$(printf '%s' "${answer:-$DEFAULT_CHOICE}" | tr '[:upper:]' '[:lower:]')" in
      1|uxp) EDITION=uxp ;;
      2|cep|legacy) EDITION=cep ;;
      *) printf '%s\n' "$MSG_INVALID_CHOICE" ;;
    esac
  done
fi
# Scripted runs (updaters, CI) keep the historical CEP behaviour.
[ -n "$EDITION" ] || EDITION=cep

# —————————————————————————————————————————————————————————————
# Installation de l'édition UXP (TypeR Silicon)
# —————————————————————————————————————————————————————————————
install_uxp() {
  [ -f "$UXP_CCX" ] && [ ! -L "$UXP_CCX" ] && [ -s "$UXP_CCX" ] || { echo 'Incomplete TypeR package: TypeR-Silicon.ccx' >&2; exit 1; }
  # Reject unsafe archive paths and links before extracting anything.
  entries="$(zipinfo -1 "$UXP_CCX")" || { echo 'Invalid UXP package' >&2; exit 1; }
  if ! printf '%s\n' "$entries" | awk '
    !/^[A-Za-z0-9_@.+\/-]+$/ || /^\// || /\/\// || /(^|\/)\.\.?(\/|$)/ { exit 1 }
    $0 == "manifest.json" { manifest = 1 }
    END { if (!manifest) exit 1 }
  '; then echo 'Unsafe or incomplete UXP package' >&2; exit 1; fi
  if zipinfo "$UXP_CCX" | grep -q '^l'; then echo 'UXP package contains symbolic links' >&2; exit 1; fi
  manifest_json="$(unzip -p "$UXP_CCX" manifest.json)"
  [ "$(printf '%s' "$manifest_json" | plutil -extract id raw -o - -)" = "$UXP_ID" ] || { echo 'Invalid UXP plugin identity' >&2; exit 1; }
  [ "$(printf '%s' "$manifest_json" | plutil -extract host.app raw -o - -)" = PS ] || { echo 'UXP package is not a Photoshop plugin' >&2; exit 1; }
  printf '%s' "$UXP_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo 'Invalid UXP plugin version' >&2; exit 1; }
  printf '%s' "$UXP_MIN_VERSION" | grep -Eq '^[0-9]+(\.[0-9]+)*$' || { echo 'Invalid UXP host version' >&2; exit 1; }
  if [ "${TYPER_INSTALL_VALIDATE_ONLY:-}" = 1 ]; then exit 0; fi

  uxp_root="$HOME/Library/Application Support/Adobe/UXP"
  external="$uxp_root/Plugins/External"
  registry="$uxp_root/PluginsInfo/v1/PS.json"
  destination="$external/${UXP_ID}_${UXP_VERSION}"
  mkdir -p "$external" "$(dirname "$registry")"
  [ ! -L "$registry" ] && [ ! -L "$external" ] || { echo 'Refusing to follow a symbolic link in the UXP folders' >&2; exit 1; }
  UXP_WORK="$(mktemp -d "$uxp_root/Plugins/.typer-uxp-install.XXXXXX")"
  UXP_MOVED=""
  UXP_INSTALLED=0
  UXP_SUCCESS=0
  trap uxp_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  mkdir "$UXP_WORK/stage" "$UXP_WORK/backup"
  ditto -x -k "$UXP_CCX" "$UXP_WORK/stage/plugin"
  [ -z "$(find "$UXP_WORK/stage/plugin" -type l -print -quit)" ] || { echo 'UXP package contains symbolic links' >&2; exit 1; }
  [ -s "$UXP_WORK/stage/plugin/manifest.json" ] || { echo 'Incomplete UXP package' >&2; exit 1; }
  xattr -dr com.apple.quarantine "$UXP_WORK/stage/plugin" 2>/dev/null || true
  # Merge into PS.json: other plugins are kept, only TypeR Silicon is replaced.
  # An unreadable PS.json aborts the installation instead of being overwritten.
  merge_ps_registry "$registry" "$UXP_WORK/PS.json" "$UXP_ID" "$UXP_VERSION" "$UXP_MIN_VERSION"
  for previous in "$external/${UXP_ID}"_*; do
    [ -e "$previous" ] || [ -L "$previous" ] || continue
    name="$(basename "$previous")"
    mv "$previous" "$UXP_WORK/backup/$name"
    UXP_MOVED="$UXP_MOVED $name"
  done
  mv "$UXP_WORK/stage/plugin" "$destination"
  UXP_INSTALLED=1
  mv "$UXP_WORK/PS.json" "$registry"
  UXP_SUCCESS=1
}
uxp_cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$UXP_SUCCESS" -eq 0 ]; then
    failed=0
    if [ "$UXP_INSTALLED" -eq 1 ]; then rm -rf "$destination" || failed=1; fi
    for name in $UXP_MOVED; do mv "$UXP_WORK/backup/$name" "$external/$name" || failed=1; done
    if [ "$failed" -ne 0 ]; then echo "Recovery backup retained: $UXP_WORK" >&2; exit 1; fi
    [ "$status" -ne 0 ] || status=1
    printf '%s\n' "$MSG_UXP_FALLBACK" >&2
  fi
  rm -rf "$UXP_WORK"
  exit "$status"
}
# PS.json merge with JavaScript for Automation (built into macOS, no python3
# or Xcode tools needed on the user's machine).
merge_ps_registry() {
  osascript -l JavaScript - "$@" >/dev/null <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  const [registry, output, pluginId, version, minVersion] = argv;
  let document = { plugins: [] };
  if ($.NSFileManager.defaultManager.fileExistsAtPath(registry)) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(registry, $.NSUTF8StringEncoding, null);
    if (text.isNil()) throw new Error('Cannot read ' + registry);
    const raw = ObjC.unwrap(text);
    if (raw.trim()) document = JSON.parse(raw);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Unexpected PS.json format');
  if (document.plugins === undefined) document.plugins = [];
  if (!Array.isArray(document.plugins)) throw new Error('Unexpected PS.json plugins format');
  document.plugins = document.plugins.filter(plugin => !plugin || plugin.pluginId !== pluginId);
  document.plugins.push({
    hostMinVersion: minVersion,
    name: 'TypeR Silicon',
    path: '$localPlugins/External/' + pluginId + '_' + version,
    pluginId: pluginId,
    status: 'enabled',
    type: 'uxp',
    versionString: version,
  });
  if (!$(JSON.stringify(document)).writeToFileAtomicallyEncodingError(output, true, $.NSUTF8StringEncoding, null)) throw new Error('Cannot write ' + output);
  return 'ok';
}
JXA
}

if [ "$EDITION" = uxp ]; then
  if [ "$INTERACTIVE" -eq 1 ]; then
    printf '%s\n' "$MSG_INSTALL_UXP" "$MSG_CLOSE_PHOTOSHOP"
    read -r -p "$MSG_PRESS_ENTER "
  fi
  install_uxp
  printf '%s\n' "$MSG_INSTALL_COMPLETE" "$MSG_OPEN_UXP"
  exit 0
fi

if [ "$INTERACTIVE" -eq 1 ]; then
  printf '%s\n' "$MSG_INSTALL" "$MSG_CLOSE_PHOTOSHOP"
  read -r -p "$MSG_PRESS_ENTER "
fi
# Validate the entire source before creating or moving destination files.
[ -f "$SRCDIR/app/package.sha256" ] || { echo 'Incomplete TypeR package: missing inventory' >&2; exit 1; }
for required in app/index.html app/index.js app/modern.html app/legacy.html app/modern.index.js app/legacy.index.js app/modern.css app/legacy.css app/host.jsx CSXS/manifest.xml locale/messages.properties icons/iconNormal.png; do
  [ -s "$SRCDIR/$required" ] || { echo "Incomplete TypeR package: $required" >&2; exit 1; }
done
[ -n "$EXT_VERSION" ] || { echo 'Invalid TypeR version' >&2; exit 1; }
grep -q 'ExtensionBundleId="com.scanr.typer"' "$MANIFEST"
grep -q "ExtensionBundleVersion=\"$EXT_VERSION\"" "$MANIFEST"
if ! awk '
  !/^[a-f0-9]+  (app|CSXS|icons|locale)\/[A-Za-z0-9_@.\/-]+$/ { exit 1 }
  length($1) != 64 || $2 ~ /(^|\/)\.\.?($|\/)/ || $2 ~ /\/\// || $2 == "app/package.sha256" { exit 1 }
  { if (seen[tolower($2)]++) exit 1; count++ }
  END { if (!count) exit 1 }
' "$SRCDIR/app/package.sha256"; then echo 'Invalid package inventory' >&2; exit 1; fi
for folder in app CSXS icons locale; do
  [ -d "$SRCDIR/$folder" ] && [ ! -L "$SRCDIR/$folder" ] || exit 1
  [ -z "$(find "$SRCDIR/$folder" -type l -print -quit)" ] || { echo 'Package contains symbolic links' >&2; exit 1; }
done
(cd "$SRCDIR" && shasum -a 256 -c app/package.sha256 >/dev/null)
# Every copied application file must be covered by the inventory.
while IFS= read -r filename; do
  relative="${filename#"$SRCDIR/"}"
  [ "$relative" = app/package.sha256 ] && continue
  awk -v name="$relative" '$2 == name { found=1 } END { exit !found }' "$SRCDIR/app/package.sha256" || { echo "Unlisted file: $relative" >&2; exit 1; }
done < <(find "$SRCDIR/app" "$SRCDIR/CSXS" "$SRCDIR/icons" "$SRCDIR/locale" -type f -print)
if [ "${TYPER_INSTALL_VALIDATE_ONLY:-}" = 1 ]; then exit 0; fi

DESTDIR="${TYPER_INSTALL_TARGET:-${HOME}/Library/Application Support/Adobe/CEP/extensions/typertools}"
[ "$DESTDIR" != / ] && [ ! -L "$DESTDIR" ] || exit 1
mkdir -p "$DESTDIR"
DESTDIR="$(cd "$DESTDIR" && pwd)"
[ "$DESTDIR" != "$SRCDIR" ] || { echo 'Source and destination must differ' >&2; exit 1; }
WORKDIR="$(mktemp -d "$DESTDIR/.typer-install.XXXXXX")"
MOVED=""
INSTALLED=""
SUCCESS=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$SUCCESS" -eq 0 ]; then
    failed=0
    for folder in $INSTALLED; do rm -rf "$DESTDIR/$folder" || failed=1; done
    for folder in $MOVED; do mv "$WORKDIR/backup/$folder" "$DESTDIR/$folder" || failed=1; done
    if [ "$failed" -ne 0 ]; then echo "Recovery backup retained: $WORKDIR" >&2; exit 1; fi
  fi
  rm -rf "$WORKDIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$WORKDIR/stage" "$WORKDIR/backup"
for folder in app CSXS icons locale; do cp -R "$SRCDIR/$folder" "$WORKDIR/stage/$folder"; done
(cd "$WORKDIR/stage" && shasum -a 256 -c app/package.sha256 >/dev/null)
for folder in app CSXS icons locale; do
  if [ -e "$DESTDIR/$folder" ] || [ -L "$DESTDIR/$folder" ]; then
    mv "$DESTDIR/$folder" "$WORKDIR/backup/$folder"
    MOVED="$MOVED $folder"
  fi
  mv "$WORKDIR/stage/$folder" "$DESTDIR/$folder"
  INSTALLED="$INSTALLED $folder"
done
SUCCESS=1
# A complete offline repair supersedes any interrupted in-place transaction.
if [ -f "$DESTDIR/.typer-update-journal.json" ]; then rm "$DESTDIR/.typer-update-journal.json"; fi
if [ -z "${TYPER_INSTALL_SKIP_DEBUG:-}" ]; then
  for version in {6..18}; do defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1; done
fi
printf '%s\n' "$MSG_INSTALL_COMPLETE" "$MSG_OPEN_PHOTOSHOP"
