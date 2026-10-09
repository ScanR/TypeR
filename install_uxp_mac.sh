#!/bin/bash
# Installs the TypeR UXP plugin (Photoshop 2026 and later, Apple Silicon or Intel).
#   ./install_uxp_mac.sh                 installs TypeR-UXP.ccx next to this script,
#                                        or the latest release when there is none
#   ./install_uxp_mac.sh path/to/x.ccx   installs that package
# Double-clicking TypeR-UXP.ccx does the same through Creative Cloud.
set -euo pipefail

RELEASE_URL="https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LANGUAGE="$( (defaults read -g AppleLocale 2>/dev/null || printf 'en') | cut -d"_" -f1)"

say() {
  if [ "$LANGUAGE" = "fr" ]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi
}

if [ ! -x "$UPIA" ]; then
  say "Creative Cloud is required: install it, then run this script again." \
      "Creative Cloud est nécessaire : installez-le, puis relancez ce script."
  exit 1
fi

PACKAGE="${1:-$SCRIPT_DIR/TypeR-UXP.ccx}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# The installer reads the package from a temporary folder: macOS would ask
# Creative Cloud for access to Desktop or Downloads otherwise
if [ -f "$PACKAGE" ]; then
  cp "$PACKAGE" "$WORK/TypeR-UXP.ccx"
else
  say "Downloading the latest TypeR UXP plugin..." "Téléchargement du dernier plugin TypeR UXP..."
  curl -fL --retry 2 -o "$WORK/TypeR-UXP.ccx" "$RELEASE_URL"
fi

say "Installing TypeR..." "Installation de TypeR..."
if "$UPIA" --install "$WORK/TypeR-UXP.ccx"; then
  say "TypeR is installed: open it from Photoshop's Plugins menu. If TypeR was already installed, restart Photoshop." \
      "TypeR est installé : ouvrez-le depuis le menu Plug-ins de Photoshop. Si TypeR était déjà installé, redémarrez Photoshop."
else
  say "The installation failed. Double-click TypeR-UXP.ccx to install it through Creative Cloud." \
      "L'installation a échoué. Double-cliquez sur TypeR-UXP.ccx pour l'installer avec Creative Cloud."
  exit 1
fi
