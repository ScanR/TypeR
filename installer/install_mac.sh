#!/bin/bash
set -euo pipefail

# —————————————————————————————————————————————————————————————
# Dossier de l'archive, parent de installer/ (pour pointer sur manifest.xml)
# —————————————————————————————————————————————————————————————
SRCDIR=$(cd "${TYPER_INSTALL_SOURCE:-$(dirname "$0")/..}" && pwd)

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
MSG_CLOSE_PHOTOSHOP_EN="Photoshop is open: close it first."
MSG_PRESS_KEY_EN="Press any key to continue"
MSG_INSTALL_COMPLETE_EN="Installation completed."
MSG_OPEN_PHOTOSHOP_EN="Open Photoshop and in the menu click the following: [Window] > [Extensions] > [TypeR]"
MSG_PRESS_ENTER_EN="Press Enter to continue"
MSG_CREDITS_EN="TypeR developed by Sakushi & SeanR."
MSG_TYPERTOOLS_EN="typertools, developed by Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_EN="ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"
MSG_TITLE_EN="TypeR installer"
MSG_PS_FOUND_EN="Photoshop found:"
MSG_PS_NONE_EN="Photoshop was not found on this computer."
MSG_UXP_NAME_EN="New TypeR (UXP)"
MSG_UXP_DESC_EN="Faster, built on Adobe's newer plugin framework."
MSG_UXP_REQ_EN="Photoshop 2025 (version 26.0) or later"
MSG_UXP_TOO_OLD_EN="Your Photoshop is too old for this version."
MSG_LEGACY_NAME_EN="Legacy (CEP)"
MSG_LEGACY_DESC_EN="Older and slower."
MSG_LEGACY_REQ_EN="Photoshop CC 2015 (version 16.0) or later"
MSG_LEGACY_ROSETTA_EN="On this Mac, Photoshop 2026 and later need Rosetta: a launcher will be created."
MSG_RECOMMENDED_EN="(recommended)"
MSG_KEYS_EN="↑/↓ choose  ·  Enter install  ·  Q quit"
MSG_CANCELLED_EN="Installation cancelled."
MSG_CHOICE_PROMPT_EN="Your choice [1/2] (Enter = %s): "
MSG_CHOOSE_EN="Which version of TypeR do you want to install?"
MSG_BOTH_INSTALLED_EN="The other version of TypeR is installed too: do not open both panels at the same time (each shortcut would run twice)."
MSG_UXP_DOWNLOAD_EN="Downloading the new TypeR (UXP)..."
MSG_UXP_INSTALLING_EN="Installing the new TypeR (UXP)..."
MSG_UXP_COMPLETE_EN="TypeR is installed: in Photoshop, open it from the menu [Plugins] > [TypeR]. If TypeR was already installed, restart Photoshop."
MSG_UXP_COMPLETE_MANUAL_EN="TypeR is installed: restart Photoshop if it is open, then open TypeR from the menu [Plugins] > [TypeR]."
MSG_STATUS_UPDATE_EN="Installed version: {old}, updates to {new}"
MSG_STATUS_CURRENT_EN="Installed version: {new}, up to date"
MSG_STATUS_NEWER_EN="Installed version: {old}, newer than this archive ({new})"
MSG_CHOOSE_UPDATE_EN="Which version of TypeR do you want to update or install?"
MSG_UPDATED_EN="TypeR was updated: {old} → {new}"
MSG_UXP_FAILED_EN="The installation failed. Close Photoshop and run this script again."

# —————————————————————————————————————————————————————————————
# Messages en français
# —————————————————————————————————————————————————————————————
MSG_CLOSE_PHOTOSHOP_FR="Photoshop est ouvert : fermez-le d'abord."
MSG_PRESS_KEY_FR="Appuyez sur une touche pour continuer"
MSG_INSTALL_COMPLETE_FR="Installation terminée."
MSG_OPEN_PHOTOSHOP_FR="Ouvrez Photoshop et dans le menu cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
MSG_PRESS_ENTER_FR="Appuyez sur Entrée pour continuer"
MSG_CREDITS_FR="TypeR développé par Sakushi & SeanR."
MSG_TYPERTOOLS_FR="typertools, développé par Swirt : https://swirt.github.io/typertools/"
MSG_DISCORD_FR="Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
MSG_TITLE_FR="Installation de TypeR"
MSG_PS_FOUND_FR="Photoshop détecté :"
MSG_PS_NONE_FR="Photoshop n'a pas été trouvé sur cet ordinateur."
MSG_UXP_NAME_FR="Nouveau TypeR (UXP)"
MSG_UXP_DESC_FR="Plus rapide, basé sur le framework de plugins le plus récent d'Adobe."
MSG_UXP_REQ_FR="Photoshop 2025 (version 26.0) ou plus récent"
MSG_UXP_TOO_OLD_FR="Votre Photoshop est trop ancien pour cette version."
MSG_LEGACY_NAME_FR="Legacy (CEP)"
MSG_LEGACY_DESC_FR="Plus ancienne et plus lente."
MSG_LEGACY_REQ_FR="Photoshop CC 2015 (version 16.0) ou plus récent"
MSG_LEGACY_ROSETTA_FR="Sur ce Mac, Photoshop 2026 et plus récent ont besoin de Rosetta : un lanceur sera créé."
MSG_RECOMMENDED_FR="(recommandé)"
MSG_KEYS_FR="↑/↓ choisir  ·  Entrée installer  ·  Q quitter"
MSG_CANCELLED_FR="Installation annulée."
MSG_CHOICE_PROMPT_FR="Votre choix [1/2] (Entrée = %s) : "
MSG_CHOOSE_FR="Quelle version de TypeR voulez-vous installer ?"
MSG_BOTH_INSTALLED_FR="L'autre version de TypeR est aussi installée : n'ouvrez pas les deux panneaux en même temps (chaque raccourci s'exécuterait deux fois)."
MSG_UXP_DOWNLOAD_FR="Téléchargement du nouveau TypeR (UXP)..."
MSG_UXP_INSTALLING_FR="Installation du nouveau TypeR (UXP)..."
MSG_UXP_COMPLETE_FR="TypeR est installé : dans Photoshop, ouvrez-le depuis le menu [Plug-ins] > [TypeR]. Si TypeR était déjà installé, redémarrez Photoshop."
MSG_UXP_COMPLETE_MANUAL_FR="TypeR est installé : redémarrez Photoshop s'il est ouvert, puis ouvrez TypeR depuis le menu [Plug-ins] > [TypeR]."
MSG_STATUS_UPDATE_FR="Version installée : {old}, mise à jour vers {new}"
MSG_STATUS_CURRENT_FR="Version installée : {new}, à jour"
MSG_STATUS_NEWER_FR="Version installée : {old}, plus récente que cette archive ({new})"
MSG_CHOOSE_UPDATE_FR="Quelle version de TypeR voulez-vous mettre à jour ou installer ?"
MSG_UPDATED_FR="TypeR a été mis à jour : {old} → {new}"
MSG_UXP_FAILED_FR="L'installation a échoué. Fermez Photoshop et relancez ce script."

# —————————————————————————————————————————————————————————————
# Messages en espagnol
# —————————————————————————————————————————————————————————————
MSG_CLOSE_PHOTOSHOP_ES="Photoshop está abierto: ciérralo primero."
MSG_PRESS_KEY_ES="Presiona cualquier tecla para continuar"
MSG_INSTALL_COMPLETE_ES="Instalación completada."
MSG_OPEN_PHOTOSHOP_ES="Abre Photoshop y en el menú haz clic en: [Ventana] > [Extensiones] > [TypeR]"
MSG_PRESS_ENTER_ES="Presiona Enter para continuar"
MSG_CREDITS_ES="TypeR desarrollado por Sakushi & SeanR."
MSG_TYPERTOOLS_ES="typertools, desarrollado por Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_ES="Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
MSG_TITLE_ES="Instalador de TypeR"
MSG_PS_FOUND_ES="Photoshop detectado:"
MSG_PS_NONE_ES="No se encontró Photoshop en este ordenador."
MSG_UXP_NAME_ES="Nuevo TypeR (UXP)"
MSG_UXP_DESC_ES="Más rápido, basado en el framework de plugins más reciente de Adobe."
MSG_UXP_REQ_ES="Photoshop 2025 (versión 26.0) o posterior"
MSG_UXP_TOO_OLD_ES="Tu Photoshop es demasiado antiguo para esta versión."
MSG_LEGACY_NAME_ES="Legacy (CEP)"
MSG_LEGACY_DESC_ES="Más antigua y lenta."
MSG_LEGACY_REQ_ES="Photoshop CC 2015 (versión 16.0) o posterior"
MSG_LEGACY_ROSETTA_ES="En este Mac, Photoshop 2026 y posteriores necesitan Rosetta: se creará un lanzador."
MSG_RECOMMENDED_ES="(recomendado)"
MSG_KEYS_ES="↑/↓ elegir  ·  Enter instalar  ·  Q salir"
MSG_CANCELLED_ES="Instalación cancelada."
MSG_CHOICE_PROMPT_ES="Tu elección [1/2] (Enter = %s): "
MSG_CHOOSE_ES="¿Qué versión de TypeR quieres instalar?"
MSG_BOTH_INSTALLED_ES="La otra versión de TypeR también está instalada: no abras ambos paneles a la vez (cada atajo se ejecutaría dos veces)."
MSG_UXP_DOWNLOAD_ES="Descargando el nuevo TypeR (UXP)..."
MSG_UXP_INSTALLING_ES="Instalando el nuevo TypeR (UXP)..."
MSG_UXP_COMPLETE_ES="TypeR está instalado: en Photoshop, ábrelo desde el menú [Plugins] > [TypeR]. Si TypeR ya estaba instalado, reinicia Photoshop."
MSG_UXP_COMPLETE_MANUAL_ES="TypeR está instalado: reinicia Photoshop si está abierto y abre TypeR desde el menú [Plugins] > [TypeR]."
MSG_STATUS_UPDATE_ES="Versión instalada: {old}, se actualiza a {new}"
MSG_STATUS_CURRENT_ES="Versión instalada: {new}, al día"
MSG_STATUS_NEWER_ES="Versión instalada: {old}, más reciente que este archivo ({new})"
MSG_CHOOSE_UPDATE_ES="¿Qué versión de TypeR quieres actualizar o instalar?"
MSG_UPDATED_ES="TypeR se ha actualizado: {old} → {new}"
MSG_UXP_FAILED_ES="La instalación falló. Cierra Photoshop y vuelve a ejecutar este script."

# —————————————————————————————————————————————————————————————
# Messages en portugais
# —————————————————————————————————————————————————————————————
MSG_CLOSE_PHOTOSHOP_PT="O Photoshop está aberto: feche-o primeiro."
MSG_PRESS_KEY_PT="Pressione qualquer tecla para continuar"
MSG_INSTALL_COMPLETE_PT="Instalação concluída."
MSG_OPEN_PHOTOSHOP_PT="Abra o Photoshop e no menu clique em: [Janela] > [Extensões] > [TypeR]"
MSG_PRESS_ENTER_PT="Pressione Enter para continuar"
MSG_CREDITS_PT="TypeR desenvolvido por Sakushi & SeanR."
MSG_TYPERTOOLS_PT="typertools, desenvolvido por Swirt: https://swirt.github.io/typertools/"
MSG_DISCORD_PT="Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
MSG_TITLE_PT="Instalador do TypeR"
MSG_PS_FOUND_PT="Photoshop detectado:"
MSG_PS_NONE_PT="O Photoshop não foi encontrado neste computador."
MSG_UXP_NAME_PT="Novo TypeR (UXP)"
MSG_UXP_DESC_PT="Mais rápido, baseado no framework de plugins mais recente da Adobe."
MSG_UXP_REQ_PT="Photoshop 2025 (versão 26.0) ou mais recente"
MSG_UXP_TOO_OLD_PT="O seu Photoshop é antigo demais para esta versão."
MSG_LEGACY_NAME_PT="Legacy (CEP)"
MSG_LEGACY_DESC_PT="Mais antiga e lenta."
MSG_LEGACY_REQ_PT="Photoshop CC 2015 (versão 16.0) ou mais recente"
MSG_LEGACY_ROSETTA_PT="Neste Mac, o Photoshop 2026 e mais recentes precisam do Rosetta: um iniciador será criado."
MSG_RECOMMENDED_PT="(recomendado)"
MSG_KEYS_PT="↑/↓ escolher  ·  Enter instalar  ·  Q sair"
MSG_CANCELLED_PT="Instalação cancelada."
MSG_CHOICE_PROMPT_PT="Sua escolha [1/2] (Enter = %s): "
MSG_CHOOSE_PT="Qual versão do TypeR você quer instalar?"
MSG_BOTH_INSTALLED_PT="A outra versão do TypeR também está instalada: não abra os dois painéis ao mesmo tempo (cada atalho seria executado duas vezes)."
MSG_UXP_DOWNLOAD_PT="Baixando o novo TypeR (UXP)..."
MSG_UXP_INSTALLING_PT="Instalando o novo TypeR (UXP)..."
MSG_UXP_COMPLETE_PT="O TypeR está instalado: no Photoshop, abra-o pelo menu [Plug-ins] > [TypeR]. Se o TypeR já estava instalado, reinicie o Photoshop."
MSG_UXP_COMPLETE_MANUAL_PT="O TypeR está instalado: reinicie o Photoshop se estiver aberto e abra o TypeR pelo menu [Plug-ins] > [TypeR]."
MSG_STATUS_UPDATE_PT="Versão instalada: {old}, atualiza para {new}"
MSG_STATUS_CURRENT_PT="Versão instalada: {new}, atualizada"
MSG_STATUS_NEWER_PT="Versão instalada: {old}, mais recente que este arquivo ({new})"
MSG_CHOOSE_UPDATE_PT="Qual versão do TypeR você quer atualizar ou instalar?"
MSG_UPDATED_PT="O TypeR foi atualizado: {old} → {new}"
MSG_UXP_FAILED_PT="A instalação falhou. Feche o Photoshop e execute este script novamente."

# —————————————————————————————————————————————————————————————
# Affectation des messages en fonction de la langue
# —————————————————————————————————————————————————————————————
case "$LANGUAGE" in
  fr) LANGUAGE_SUFFIX=FR ;;
  es) LANGUAGE_SUFFIX=ES ;;
  pt) LANGUAGE_SUFFIX=PT ;;
  *) LANGUAGE_SUFFIX=EN ;;
esac
for name in CLOSE_PHOTOSHOP PRESS_KEY INSTALL_COMPLETE OPEN_PHOTOSHOP PRESS_ENTER CREDITS TYPERTOOLS DISCORD \
  TITLE PS_FOUND PS_NONE UXP_NAME UXP_DESC UXP_REQ UXP_TOO_OLD LEGACY_NAME LEGACY_DESC LEGACY_REQ LEGACY_ROSETTA RECOMMENDED KEYS CANCELLED \
  CHOOSE CHOICE_PROMPT BOTH_INSTALLED UXP_DOWNLOAD UXP_INSTALLING UXP_COMPLETE UXP_COMPLETE_MANUAL UXP_FAILED \
  STATUS_UPDATE STATUS_CURRENT STATUS_NEWER CHOOSE_UPDATE UPDATED; do
  localized="MSG_${name}_${LANGUAGE_SUFFIX}"
  printf -v "MSG_$name" '%s' "${!localized}"
done

# —————————————————————————————————————————————————————————————
# Arguments : --uxp | --legacy (--cep), --silent, un paquet .ccx pour UXP
# Sans choix, une console interactive affiche le menu ; une installation
# scriptée (mise à jour, tests) installe la version Legacy.
# —————————————————————————————————————————————————————————————
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

# Colors and the arrow menu need a real terminal
FANCY=0
if [ "$INTERACTIVE" -eq 1 ] && [ -t 1 ] && [ "${TERM:-dumb}" != dumb ]; then FANCY=1; fi
if [ "$FANCY" -eq 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; CYAN=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

print_header() {
  local title="$MSG_TITLE${EXT_VERSION:+  $EXT_VERSION}" line
  line="$(printf '─%.0s' $(seq 1 $((${#title} + 4))))"
  printf '\n  %s╭%s╮%s\n  %s│%s  %s%s%s  %s│%s\n  %s╰%s╯%s\n\n' \
    "$CYAN" "$line" "$RESET" "$CYAN" "$RESET" "$BOLD" "$title" "$RESET" "$CYAN" "$RESET" "$CYAN" "$line" "$RESET"
}

# Photoshop installations, one "name=version" per line.
# TYPER_PHOTOSHOP_VERSIONS="name=version;..." replaces the search in tests.
list_photoshops() {
  if [ -n "${TYPER_PHOTOSHOP_VERSIONS+set}" ]; then
    [ -z "$TYPER_PHOTOSHOP_VERSIONS" ] || printf '%s\n' "$TYPER_PHOTOSHOP_VERSIONS" | tr ';' '\n'
    return 0
  fi
  local app seen="" version
  while IFS= read -r app; do
    [ -d "$app" ] || continue
    case "$app" in */.Trash/*) continue ;; esac
    case "$seen" in *"|$app|"*) continue ;; esac
    seen="$seen|$app|"
    version="$(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)"
    printf '%s=%s\n' "$(basename "$app" .app | sed 's/^Adobe //')" "$version"
  done < <(
    for app in /Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app "$HOME"/Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app; do
      if [ -d "$app" ]; then printf '%s\n' "$app"; fi
    done
    if command -v mdfind >/dev/null 2>&1; then mdfind "kMDItemCFBundleIdentifier == 'com.adobe.Photoshop'" 2>/dev/null || true; fi
  )
}

# The newest Photoshop decides: UXP needs version 26, Legacy works with the
# older ones. No Photoshop found (or no version read): no recommendation.
RECOMMENDED=""
PHOTOSHOPS=""
PHOTOSHOP_MAJOR=0
detect_photoshops() {
  local name version major
  while IFS='=' read -r name version; do
    [ -n "$name" ] || continue
    PHOTOSHOPS="$PHOTOSHOPS${PHOTOSHOPS:+, }$name${version:+ ($version)}"
    major="${version%%.*}"
    case "$major" in ''|*[!0-9]*) continue ;; esac
    if [ "$major" -gt "$PHOTOSHOP_MAJOR" ]; then PHOTOSHOP_MAJOR="$major"; fi
  done < <(list_photoshops)
  if [ "$PHOTOSHOP_MAJOR" -ge 26 ]; then RECOMMENDED=uxp
  elif [ "$PHOTOSHOP_MAJOR" -gt 0 ]; then RECOMMENDED=legacy
  fi
}

# What is installed: the versions found before the installation changes them
CEP_DESTDIR="${TYPER_INSTALL_TARGET:-${HOME}/Library/Application Support/Adobe/CEP/extensions/typertools}"
UXP_ROOT="${TYPER_UXP_ROOT:-${HOME}/Library/Application Support/Adobe/UXP}"
UXP_PLUGINS="$UXP_ROOT/Plugins/External"
UXP_REGISTRY="$UXP_ROOT/PluginsInfo/v1/PS.json"

compare_versions() {
  awk -v left="$1" -v right="$2" 'BEGIN {
    left_count = split(left, left_parts, /[^0-9]+/)
    right_count = split(right, right_parts, /[^0-9]+/)
    count = left_count > right_count ? left_count : right_count
    for (i = 1; i <= count; i++) {
      left_part = left_parts[i] + 0; right_part = right_parts[i] + 0
      if (left_part > right_part) { print 1; exit }
      if (left_part < right_part) { print -1; exit }
    }
    print 0
  }'
}

installed_legacy_version() {
  (grep -oE '<Extension Id="typer" Version="[^"]+"' "$CEP_DESTDIR/CSXS/manifest.xml" 2>/dev/null || true) \
    | sed -E 's/.*Version="([^"]+)".*/\1/' | head -n 1
}

# After an update by hand, the previous folder stays until Photoshop runs the new one
installed_plugin_version() {
  local folder version newest=""
  for folder in "$UXP_PLUGINS"/com.scanr.typer_*; do
    [ -d "$folder" ] || continue
    version="${folder##*/com.scanr.typer_}"
    case "$version" in *.installing) continue ;; esac
    if [ -z "$newest" ] || [ "$(compare_versions "$version" "$newest")" = 1 ]; then newest="$version"; fi
  done
  printf '%s' "$newest"
}

LEGACY_VERSION="$(installed_legacy_version)"
PLUGIN_VERSION="$(installed_plugin_version)"

format_versions() {
  local text="$1"
  text="${text//\{old\}/$2}"
  printf '%s' "${text//\{new\}/$3}"
}

# The line under a version already installed, compared with this archive's
version_status() {
  local installed="$1"
  if [ -z "$installed" ] || [ -z "$EXT_VERSION" ]; then return 0; fi
  case "$(compare_versions "$installed" "$EXT_VERSION")" in
    -1) format_versions "$MSG_STATUS_UPDATE" "$installed" "$EXT_VERSION" ;;
    1) format_versions "$MSG_STATUS_NEWER" "$installed" "$EXT_VERSION" ;;
    *) format_versions "$MSG_STATUS_CURRENT" "$installed" "$EXT_VERSION" ;;
  esac
}

# Says it when a version really changed
print_update_line() {
  if [ -n "$1" ] && [ -n "$2" ] && [ "$1" != "$2" ]; then
    printf '\n  %s✓ %s%s\n' "$GREEN" "$(format_versions "$MSG_UPDATED" "$1" "$2")" "$RESET"
  fi
}

draw_option() {
  local selected="$1" name="$2" recommended="$3" description="$4" requirement="$5" warning="${6:-}" status="${7:-}" arrow="  " style=""
  if [ "$selected" -eq 1 ]; then arrow="${CYAN}❯${RESET} "; style="$BOLD$CYAN"; fi
  printf '  %s%s%s%s' "$arrow" "$style" "$name" "$RESET"
  if [ "$recommended" -eq 1 ]; then printf '  %s%s%s' "$GREEN" "$MSG_RECOMMENDED" "$RESET"; fi
  printf '\n'
  if [ -n "$status" ]; then printf '      %s%s%s\n' "$GREEN" "$status" "$RESET"; fi
  printf '      %s%s%s\n      %s%s%s\n' "$DIM" "$description" "$RESET" "$DIM" "$requirement" "$RESET"
  if [ -n "$warning" ]; then printf '      %s%s%s\n' "$YELLOW" "$warning" "$RESET"; fi
  printf '\n'
}

choose_message() {
  if [ -n "$LEGACY_VERSION$PLUGIN_VERSION" ]; then printf '%s' "$MSG_CHOOSE_UPDATE"; else printf '%s' "$MSG_CHOOSE"; fi
}

draw_menu() {
  local uxp_warning="" legacy_warning="" uxp_recommended=0 legacy_recommended=0
  if [ "$RECOMMENDED" = uxp ]; then uxp_recommended=1; fi
  if [ "$RECOMMENDED" = legacy ]; then legacy_recommended=1; uxp_warning="$MSG_UXP_TOO_OLD"; fi
  if [ "$PHOTOSHOP_MAJOR" -ge 27 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then legacy_warning="$MSG_LEGACY_ROSETTA"; fi
  printf '\033[H\033[J'
  print_header
  if [ -n "$PHOTOSHOPS" ]; then printf '  %s %s%s%s\n\n' "$MSG_PS_FOUND" "$BOLD" "$PHOTOSHOPS" "$RESET"
  else printf '  %s%s%s\n\n' "$YELLOW" "$MSG_PS_NONE" "$RESET"
  fi
  printf '  %s\n\n' "$(choose_message)"
  draw_option "$([ "$1" = uxp ] && echo 1 || echo 0)" "$MSG_UXP_NAME" "$uxp_recommended" "$MSG_UXP_DESC" "$MSG_UXP_REQ" "$uxp_warning" "$(version_status "$PLUGIN_VERSION")"
  draw_option "$([ "$1" = legacy ] && echo 1 || echo 0)" "$MSG_LEGACY_NAME" "$legacy_recommended" "$MSG_LEGACY_DESC" "$MSG_LEGACY_REQ" "$legacy_warning" "$(version_status "$LEGACY_VERSION")"
  printf '  %s%s%s\n' "$DIM" "$MSG_KEYS" "$RESET"
}

cancel_install() {
  printf '\033[?25h'
  stty echo 2>/dev/null || true
  printf '\n  %s\n\n' "$MSG_CANCELLED"
  exit 130
}

# Any arrow moves between the two versions, 1 and 2 pick one directly.
# A lone Escape waits for the rest of a sequence: read has no shorter timeout on macOS's bash 3.2.
choose_with_menu() {
  local cursor="${RECOMMENDED:-uxp}" key rest
  trap cancel_install INT TERM
  printf '\033[?25l'
  while true; do
    draw_menu "$cursor"
    IFS= read -rsn1 key || cancel_install
    case "$key" in
      $'\033')
        rest=""
        IFS= read -rsn2 -t 1 rest || true
        case "$rest" in
          '[A'|'[B'|'[C'|'[D'|OA|OB|OC|OD) if [ "$cursor" = uxp ]; then cursor=legacy; else cursor=uxp; fi ;;
        esac ;;
      1) cursor=uxp ;;
      2) cursor=legacy ;;
      j|k) if [ "$cursor" = uxp ]; then cursor=legacy; else cursor=uxp; fi ;;
      q|Q) cancel_install ;;
      "") break ;;
    esac
  done
  printf '\033[?25h\033[H\033[J'
  trap - INT TERM
  EDITION="$cursor"
}

# Without a real terminal (output piped): the same choice as a question
choose_with_prompt() {
  local default=1 choice uxp_tag="" legacy_tag="" uxp_status legacy_status
  uxp_status="$(version_status "$PLUGIN_VERSION")"
  legacy_status="$(version_status "$LEGACY_VERSION")"
  if [ "$RECOMMENDED" = legacy ]; then default=2; legacy_tag=" $MSG_RECOMMENDED"; fi
  if [ "$RECOMMENDED" = uxp ]; then uxp_tag=" $MSG_RECOMMENDED"; fi
  printf '%s\n\n  1) %s%s\n' "$(choose_message)" "$MSG_UXP_NAME" "$uxp_tag"
  if [ -n "$uxp_status" ]; then printf '     %s\n' "$uxp_status"; fi
  printf '     %s\n  2) %s%s\n' "$MSG_UXP_REQ" "$MSG_LEGACY_NAME" "$legacy_tag"
  if [ -n "$legacy_status" ]; then printf '     %s\n' "$legacy_status"; fi
  printf '     %s\n\n' "$MSG_LEGACY_REQ"
  while true; do
    read -r -p "${MSG_CHOICE_PROMPT//%s/$default}" choice
    case "${choice:-$default}" in
      1) EDITION=uxp; break ;;
      2) EDITION=legacy; break ;;
    esac
  done
  echo
}

if [ "${TYPER_INSTALL_PROBE:-}" = recommendation ]; then
  detect_photoshops
  printf 'recommended=%s\nphotoshops=%s\n' "$RECOMMENDED" "$PHOTOSHOPS"
  exit 0
fi
if [ "${TYPER_INSTALL_PROBE:-}" = installed ]; then
  if [ -n "$PLUGIN_VERSION" ]; then printf 'installed=uxp\n'; fi
  printf 'legacy=%s\nuxp=%s\n' "$LEGACY_VERSION" "$PLUGIN_VERSION"
  exit 0
fi
if [ -z "$EDITION" ]; then
  EDITION=legacy
  if [ "$INTERACTIVE" -eq 1 ]; then
    detect_photoshops
    if [ "$FANCY" -eq 1 ]; then choose_with_menu; else choose_with_prompt; fi
  fi
fi
if [ "${TYPER_INSTALL_PROBE:-}" = choice ]; then
  printf 'edition=%s\n' "$EDITION"
  exit 0
fi
if [ "$FANCY" -eq 1 ]; then print_header; fi

# Every failure ends on what to do and where to ask for help
on_exit() {
  local status="${1:-$?}"
  if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
    printf '\n  %s%s%s\n' "$RED" "$MSG_UXP_FAILED" "$RESET" >&2
    if [ "$INTERACTIVE" -eq 1 ]; then printf '  %s\n\n' "$MSG_DISCORD" >&2; fi
  fi
  return 0
}
trap on_exit EXIT

print_credits() {
  if [ "$FANCY" -eq 1 ]; then
    printf '\n  %s%s\n  %s\n  %s%s\n\n' "$DIM" "$MSG_CREDITS" "$MSG_TYPERTOOLS" "$MSG_DISCORD" "$RESET"
  fi
}

photoshop_is_running() { pgrep -f '/Contents/MacOS/Adobe Photoshop' >/dev/null 2>&1; }

# —————————————————————————————————————————————————————————————
# Version UXP : le paquet .ccx (celui de l'archive, sinon la dernière
# version publiée), installé par l'installeur de plugins de Creative Cloud.
# Sans lui, ou s'il échoue, le paquet est extrait là où il l'aurait mis et
# inscrit dans PS.json, que Photoshop lit à son démarrage (dans une sous-coque
# pour que set -e ne coupe pas le repli)
# —————————————————————————————————————————————————————————————
# uxp_json folder <manifest> : the plugin's folder name, for a TypeR package only
# uxp_json register <manifest> <PS.json> <output> : PS.json with the plugin
# added, other plugins kept; an unreadable PS.json is an error
uxp_json() {
  osascript -l JavaScript - "$@" <<'JXA'
ObjC.import("Foundation");
function read(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return text.isNil() ? "" : text.js;
}
function run(argv) {
  const manifest = JSON.parse(read(argv[1]));
  if (manifest.id !== "com.scanr.typer" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(String(manifest.version || ""))) throw new Error("Not a TypeR package");
  const folder = manifest.id + "_" + manifest.version;
  if (argv[0] === "folder") return folder;
  const text = read(argv[2]).trim();
  const registry = text ? JSON.parse(text) : {};
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("Invalid PS.json");
  if (registry.plugins !== undefined && !Array.isArray(registry.plugins)) throw new Error("Invalid PS.json");
  const plugins = (registry.plugins || []).filter((plugin) => !plugin || plugin.pluginId !== manifest.id);
  plugins.push({
    hostMinVersion: manifest.host.minVersion,
    name: manifest.name,
    path: "$localPlugins/External/" + folder,
    pluginId: manifest.id,
    status: "enabled",
    type: "uxp",
    versionString: manifest.version,
  });
  registry.plugins = plugins;
  if (!$(JSON.stringify(registry)).writeToFileAtomicallyEncodingError(argv[3], true, $.NSUTF8StringEncoding, null)) throw new Error("Cannot write " + argv[3]);
  return folder;
}
JXA
}

install_uxp_manually() (
  set -e
  package="$1"
  unzip -p "$package" manifest.json > "$WORK/manifest.json"
  folder="$(uxp_json folder "$WORK/manifest.json")"
  uxp_json register "$WORK/manifest.json" "$UXP_REGISTRY" "$WORK/PS.json" >/dev/null
  staging="$UXP_PLUGINS/$folder.installing"
  rm -rf "$staging"
  mkdir -p "$staging"
  if ! unzip -q -o "$package" -d "$staging"; then rm -rf "$staging"; exit 1; fi
  rm -rf "${UXP_PLUGINS:?}/$folder"
  mv "$staging" "$UXP_PLUGINS/$folder"
  mkdir -p "$(dirname "$UXP_REGISTRY")"
  cp "$WORK/PS.json" "$UXP_REGISTRY.tmp"
  mv "$UXP_REGISTRY.tmp" "$UXP_REGISTRY"
)

# A Legacy panel still installed is called "TypeR (old)" in Photoshop from its
# next start (app_src/legacyPanelName.js). Never fails the installation.
rename_legacy_panel() {
  local manifest="$CEP_DESTDIR/CSXS/manifest.xml"
  [ -f "$manifest" ] || return 0
  if ! { sed 's#<Menu>TypeR</Menu>#<Menu>TypeR (old)</Menu>#' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"; }; then
    rm -f "$manifest.tmp"
  fi
  return 0
}

if [ "$EDITION" = uxp ]; then
  UPIA="${TYPER_INSTALL_UPIA:-/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent}"
  CREATIVE_CLOUD="/Applications/Utilities/Adobe Creative Cloud/ACC/Creative Cloud.app"
  PACKAGE="${UXP_PACKAGE:-$SRCDIR/TypeR-UXP.ccx}"
  WORK="$(mktemp -d)"
  trap 'status=$?; rm -rf "$WORK"; on_exit "$status"' EXIT
  # The installer reads the package from a temporary folder: macOS would ask
  # Creative Cloud for access to Desktop or Downloads otherwise
  if [ -f "$PACKAGE" ]; then
    cp "$PACKAGE" "$WORK/TypeR-UXP.ccx"
  else
    printf '  %s\n' "$MSG_UXP_DOWNLOAD"
    curl -fL --retry 2 --progress-bar -o "$WORK/TypeR-UXP.ccx" "https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx"
  fi
  # A package extracted from a downloaded archive is still marked as downloaded
  xattr -d com.apple.quarantine "$WORK/TypeR-UXP.ccx" 2>/dev/null || true
  printf '  %s\n' "$MSG_UXP_INSTALLING"
  # Creative Cloud's plugin installer can fail or hang without a working
  # Creative Cloud session: after a limit, the package is installed by hand.
  run_upia() {
    local pid ticks=0 limit=$((${TYPER_INSTALL_UPIA_TIMEOUT:-60} * 10))
    "$UPIA" --install "$WORK/TypeR-UXP.ccx" >"$WORK/upia.log" 2>&1 &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$ticks" -ge "$limit" ]; then
        kill "$pid" 2>/dev/null || true
        return 124
      fi
      sleep 0.1
      ticks=$((ticks + 1))
    done
    wait "$pid"
  }
  # The installer's exit code does not tell: a failure can still exit with 0
  COMPLETE_MESSAGE=""
  if [ -x "$UPIA" ] && [ "${TYPER_INSTALL_NO_UPIA:-}" != 1 ] && { [ -d "$CREATIVE_CLOUD" ] || [ -n "${TYPER_INSTALL_UPIA:-}" ]; }; then
    if run_upia && ! grep -qi 'fail' "$WORK/upia.log"; then COMPLETE_MESSAGE="$MSG_UXP_COMPLETE"; fi
  fi
  if [ -z "$COMPLETE_MESSAGE" ]; then
    if install_uxp_manually "$WORK/TypeR-UXP.ccx"; then
      COMPLETE_MESSAGE="$MSG_UXP_COMPLETE_MANUAL"
    else
      if [ -f "$WORK/upia.log" ]; then cat "$WORK/upia.log" >&2; fi
      exit 1
    fi
  fi
  rename_legacy_panel
  print_update_line "$PLUGIN_VERSION" "$(installed_plugin_version)"
  printf '\n  %s✓ %s%s\n' "$GREEN" "$COMPLETE_MESSAGE" "$RESET"
  if [ -d "$CEP_DESTDIR/CSXS" ]; then printf '  %s%s%s\n' "$YELLOW" "$MSG_BOTH_INSTALLED" "$RESET"; fi
  print_credits
  exit 0
fi

if [ "$INTERACTIVE" -eq 1 ] && photoshop_is_running; then
  printf '  %s%s%s\n' "$YELLOW" "$MSG_CLOSE_PHOTOSHOP" "$RESET"
  read -r -p "  $MSG_PRESS_ENTER "
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
# Finder writes .DS_Store files in the folders it shows.
done < <(find "$SRCDIR/app" "$SRCDIR/CSXS" "$SRCDIR/icons" "$SRCDIR/locale" -type f ! -name .DS_Store -print)
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
  on_exit "$status"
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
  # Apple Silicon: Photoshop 2026+ only loads extensions under Rosetta; create a launcher for it.
  ROSETTA_FIX="$(cd "$(dirname "$0")" && pwd)/fix_mac_rosetta.sh"
  if [ -f "$ROSETTA_FIX" ]; then TYPER_INSTALL_TARGET="$DESTDIR" bash "$ROSETTA_FIX" --from-installer || true; fi
fi
print_update_line "$LEGACY_VERSION" "$EXT_VERSION"
printf '\n  %s✓ %s%s\n  %s\n' "$GREEN" "$MSG_INSTALL_COMPLETE" "$RESET" "$MSG_OPEN_PHOTOSHOP"
if compgen -G "$UXP_PLUGINS/com.scanr.typer_*" >/dev/null; then printf '  %s%s%s\n' "$YELLOW" "$MSG_BOTH_INSTALLED" "$RESET"; fi
print_credits
