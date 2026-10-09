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
EXT_VERSION=$( (grep -oE '<Extension Id="typer" Version="[^"]+"' "$MANIFEST" 2>/dev/null || true) \
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
MSG_CHOOSE_EN="Which version of TypeR do you want to install?"
MSG_CHOICE_UXP_EN="  1) UXP, recommended (faster, built on Adobe's newer plugin framework)
     Photoshop 2025 (version 26.0) or later"
MSG_CHOICE_LEGACY_EN="  2) Legacy, CEP (works with more Photoshop versions; older and slower, but more thoroughly tested)
     Photoshop CC 2015 (version 16.0) or later; Photoshop 2026 on Apple Silicon must run under Rosetta"
MSG_CHOICE_PROMPT_EN="Your choice [1/2] (Enter = 1): "
MSG_BOTH_INSTALLED_EN="The other version of TypeR is installed too: do not open both panels at the same time (each shortcut would run twice)."
MSG_UXP_NEED_CC_EN="Creative Cloud is required to install the UXP version: install it, then run this script again."
MSG_UXP_DOWNLOAD_EN="Downloading the latest TypeR UXP plugin..."
MSG_UXP_INSTALLING_EN="Installing TypeR (UXP)..."
MSG_UXP_COMPLETE_EN="TypeR is installed: in Photoshop, open it from the menu [Plugins] > [TypeR]. If TypeR was already installed, restart Photoshop."
MSG_UXP_FAILED_EN="The installation failed. Double-click TypeR-UXP.ccx to install it through Creative Cloud."

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
MSG_CHOOSE_FR="Quelle version de TypeR voulez-vous installer ?"
MSG_CHOICE_UXP_FR="  1) UXP, recommandée (plus rapide, basée sur le framework de plugins le plus récent d'Adobe)
     Photoshop 2025 (version 26.0) ou plus récent"
MSG_CHOICE_LEGACY_FR="  2) Legacy, CEP (compatible avec plus de versions de Photoshop ; plus ancienne et plus lente, mais mieux éprouvée)
     Photoshop CC 2015 (version 16.0) ou plus récent ; sur Mac Apple Silicon, Photoshop 2026 doit tourner sous Rosetta"
MSG_CHOICE_PROMPT_FR="Votre choix [1/2] (Entrée = 1) : "
MSG_BOTH_INSTALLED_FR="L'autre version de TypeR est aussi installée : n'ouvrez pas les deux panneaux en même temps (chaque raccourci s'exécuterait deux fois)."
MSG_UXP_NEED_CC_FR="Creative Cloud est nécessaire pour installer la version UXP : installez-le, puis relancez ce script."
MSG_UXP_DOWNLOAD_FR="Téléchargement du dernier plugin TypeR UXP..."
MSG_UXP_INSTALLING_FR="Installation de TypeR (UXP)..."
MSG_UXP_COMPLETE_FR="TypeR est installé : dans Photoshop, ouvrez-le depuis le menu [Plug-ins] > [TypeR]. Si TypeR était déjà installé, redémarrez Photoshop."
MSG_UXP_FAILED_FR="L'installation a échoué. Double-cliquez sur TypeR-UXP.ccx pour l'installer avec Creative Cloud."

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
MSG_CHOOSE_ES="¿Qué versión de TypeR quieres instalar?"
MSG_CHOICE_UXP_ES="  1) UXP, recomendada (más rápida, basada en el framework de plugins más reciente de Adobe)
     Photoshop 2025 (versión 26.0) o posterior"
MSG_CHOICE_LEGACY_ES="  2) Legacy, CEP (compatible con más versiones de Photoshop; más antigua y lenta, pero más probada)
     Photoshop CC 2015 (versión 16.0) o posterior; en Mac Apple Silicon, Photoshop 2026 debe ejecutarse con Rosetta"
MSG_CHOICE_PROMPT_ES="Tu elección [1/2] (Enter = 1): "
MSG_BOTH_INSTALLED_ES="La otra versión de TypeR también está instalada: no abras ambos paneles a la vez (cada atajo se ejecutaría dos veces)."
MSG_UXP_NEED_CC_ES="Se necesita Creative Cloud para instalar la versión UXP: instálalo y vuelve a ejecutar este script."
MSG_UXP_DOWNLOAD_ES="Descargando el último plugin TypeR UXP..."
MSG_UXP_INSTALLING_ES="Instalando TypeR (UXP)..."
MSG_UXP_COMPLETE_ES="TypeR está instalado: en Photoshop, ábrelo desde el menú [Plugins] > [TypeR]. Si TypeR ya estaba instalado, reinicia Photoshop."
MSG_UXP_FAILED_ES="La instalación falló. Haz doble clic en TypeR-UXP.ccx para instalarlo con Creative Cloud."

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
MSG_CHOOSE_PT="Qual versão do TypeR você quer instalar?"
MSG_CHOICE_UXP_PT="  1) UXP, recomendada (mais rápida, baseada no framework de plugins mais recente da Adobe)
     Photoshop 2025 (versão 26.0) ou mais recente"
MSG_CHOICE_LEGACY_PT="  2) Legacy, CEP (compatível com mais versões do Photoshop; mais antiga e lenta, mas mais testada)
     Photoshop CC 2015 (versão 16.0) ou mais recente; em Mac Apple Silicon, o Photoshop 2026 deve rodar com Rosetta"
MSG_CHOICE_PROMPT_PT="Sua escolha [1/2] (Enter = 1): "
MSG_BOTH_INSTALLED_PT="A outra versão do TypeR também está instalada: não abra os dois painéis ao mesmo tempo (cada atalho seria executado duas vezes)."
MSG_UXP_NEED_CC_PT="O Creative Cloud é necessário para instalar a versão UXP: instale-o e execute este script novamente."
MSG_UXP_DOWNLOAD_PT="Baixando o plugin TypeR UXP mais recente..."
MSG_UXP_INSTALLING_PT="Instalando o TypeR (UXP)..."
MSG_UXP_COMPLETE_PT="O TypeR está instalado: no Photoshop, abra-o pelo menu [Plug-ins] > [TypeR]. Se o TypeR já estava instalado, reinicie o Photoshop."
MSG_UXP_FAILED_PT="A instalação falhou. Clique duas vezes em TypeR-UXP.ccx para instalá-lo com o Creative Cloud."

# —————————————————————————————————————————————————————————————
# Affectation des messages en fonction de la langue
# —————————————————————————————————————————————————————————————
case "$LANGUAGE" in
  fr) LANGUAGE_SUFFIX=FR ;;
  es) LANGUAGE_SUFFIX=ES ;;
  pt) LANGUAGE_SUFFIX=PT ;;
  *) LANGUAGE_SUFFIX=EN ;;
esac
for name in INSTALL CLOSE_PHOTOSHOP PRESS_KEY INSTALL_COMPLETE OPEN_PHOTOSHOP PRESS_ENTER CREDITS TYPERTOOLS DISCORD \
  CHOOSE CHOICE_UXP CHOICE_LEGACY CHOICE_PROMPT BOTH_INSTALLED UXP_NEED_CC UXP_DOWNLOAD UXP_INSTALLING UXP_COMPLETE UXP_FAILED; do
  localized="MSG_${name}_${LANGUAGE_SUFFIX}"
  printf -v "MSG_$name" '%s' "${!localized}"
done

# —————————————————————————————————————————————————————————————
# Arguments : --uxp | --legacy (--cep), --silent, un paquet .ccx pour UXP
# Sans choix, une console interactive demande la version ; une installation
# scriptée (mise à jour, tests) installe la version Legacy.
# —————————————————————————————————————————————————————————————
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EDITION=""
SILENT=0
UXP_PACKAGE=""
for argument in "$@"; do
  case "$argument" in
    --silent) SILENT=1 ;;
    --uxp) EDITION=uxp ;;
    --legacy|--cep) EDITION=legacy ;;
    *.ccx) UXP_PACKAGE="$argument" ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done
INTERACTIVE=0
if [ -t 0 ] && [ "$SILENT" -eq 0 ] && [ "${TYPER_INSTALL_VALIDATE_ONLY:-}" != 1 ]; then INTERACTIVE=1; fi
if [ -z "$EDITION" ]; then
  EDITION=legacy
  if [ "$INTERACTIVE" -eq 1 ]; then
    printf '%s\n\n%s\n%s\n\n' "$MSG_CHOOSE" "$MSG_CHOICE_UXP" "$MSG_CHOICE_LEGACY"
    while true; do
      read -r -p "$MSG_CHOICE_PROMPT" choice
      case "$choice" in
        ""|1) EDITION=uxp; break ;;
        2) EDITION=legacy; break ;;
      esac
    done
    echo
  fi
fi

CEP_DESTDIR="${TYPER_INSTALL_TARGET:-${HOME}/Library/Application Support/Adobe/CEP/extensions/typertools}"
UXP_PLUGINS="${HOME}/Library/Application Support/Adobe/UXP/Plugins/External"

# —————————————————————————————————————————————————————————————
# Version UXP : le paquet .ccx (à côté de ce script, sinon la dernière
# version publiée), installé par l'installeur de plugins de Creative Cloud
# —————————————————————————————————————————————————————————————
if [ "$EDITION" = uxp ]; then
  UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
  [ -x "$UPIA" ] || { printf '%s\n' "$MSG_UXP_NEED_CC" >&2; exit 1; }
  PACKAGE="${UXP_PACKAGE:-$SCRIPT_DIR/TypeR-UXP.ccx}"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  # The installer reads the package from a temporary folder: macOS would ask
  # Creative Cloud for access to Desktop or Downloads otherwise
  if [ -f "$PACKAGE" ]; then
    cp "$PACKAGE" "$WORK/TypeR-UXP.ccx"
  else
    printf '%s\n' "$MSG_UXP_DOWNLOAD"
    curl -fL --retry 2 -o "$WORK/TypeR-UXP.ccx" "https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx"
  fi
  printf '%s\n' "$MSG_UXP_INSTALLING"
  if ! "$UPIA" --install "$WORK/TypeR-UXP.ccx"; then
    printf '%s\n' "$MSG_UXP_FAILED" >&2
    exit 1
  fi
  printf '\n%s\n' "$MSG_UXP_COMPLETE"
  if [ -d "$CEP_DESTDIR/CSXS" ]; then printf '%s\n' "$MSG_BOTH_INSTALLED"; fi
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

DESTDIR="$CEP_DESTDIR"
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
if compgen -G "$UXP_PLUGINS/com.scanr.typer_*" >/dev/null; then printf '%s\n' "$MSG_BOTH_INSTALLED"; fi
