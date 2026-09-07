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
EXT_VERSION=$(grep -oE '<Extension Id="typer" Version="[^"]+"' "$MANIFEST" \
  | sed -E 's/.*Version="([^"]+)".*/\1/')
# (optionnel : debug)
# echo "Version détectée : $EXT_VERSION"

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

if [ -t 0 ] && [ "${1:-}" != "--silent" ] && [ "${TYPER_INSTALL_VALIDATE_ONLY:-}" != 1 ]; then
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
