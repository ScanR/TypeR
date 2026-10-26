#!/bin/bash
set -uo pipefail

# —————————————————————————————————————————————————————————————
# TypeR is a CEP extension. Recent Photoshop builds (2026 / v27) dropped
# CEP from their Apple Silicon code: the TypeR panel only exists when
# Photoshop runs its Intel code through Rosetta. Recent macOS versions also
# ignore Finder's "Open using Rosetta" option, so this script creates a
# launcher that always opens Photoshop with Rosetta.
# —————————————————————————————————————————————————————————————
EXT_DIR="${TYPER_INSTALL_TARGET:-${HOME}/Library/Application Support/Adobe/CEP/extensions/typertools}"
LAUNCHER_DIR="${TYPER_LAUNCHER_DIR:-${HOME}/Applications}"

[ "$(uname -s)" = Darwin ] || { echo 'This script is for macOS only.' >&2; exit 1; }

LANGUAGE=$((defaults read -g AppleLocale 2>/dev/null || printf 'en') | cut -d"_" -f1)

msg() {
  case "$LANGUAGE:$1" in
    fr:title) printf '%s' "Lancement de Photoshop avec Rosetta pour TypeR (Mac Apple Silicon)" ;;
    es:title) printf '%s' "Abrir Photoshop con Rosetta para TypeR (Mac Apple Silicon)" ;;
    pt:title) printf '%s' "Abrir o Photoshop com o Rosetta para o TypeR (Mac Apple Silicon)" ;;
    *:title) printf '%s' "Open Photoshop with Rosetta for TypeR (Apple Silicon Mac)" ;;
    fr:close) printf '%s' "Fermez Photoshop (s'il est ouvert)." ;;
    es:close) printf '%s' "Cierra Photoshop (si está abierto)." ;;
    pt:close) printf '%s' "Feche o Photoshop (se estiver aberto)." ;;
    *:close) printf '%s' "Close Photoshop (if it is open)." ;;
    fr:enter) printf '%s' "Appuyez sur Entrée pour continuer" ;;
    es:enter) printf '%s' "Presiona Enter para continuar" ;;
    pt:enter) printf '%s' "Pressione Enter para continuar" ;;
    *:enter) printf '%s' "Press Enter to continue" ;;
    fr:intel) printf '%s' "Mac Intel détecté : rien à corriger." ;;
    es:intel) printf '%s' "Mac Intel detectado: nada que corregir." ;;
    pt:intel) printf '%s' "Mac Intel detectado: nada a corrigir." ;;
    *:intel) printf '%s' "Intel Mac detected: nothing to fix." ;;
    fr:none) printf '%s' "Aucune installation de Photoshop trouvée." ;;
    es:none) printf '%s' "No se encontró ninguna instalación de Photoshop." ;;
    pt:none) printf '%s' "Nenhuma instalação do Photoshop encontrada." ;;
    *:none) printf '%s' "No Photoshop installation was found." ;;
    fr:checking) printf '%s' "Vérification de" ;;
    es:checking) printf '%s' "Comprobando" ;;
    pt:checking) printf '%s' "Verificando" ;;
    *:checking) printf '%s' "Checking" ;;
    fr:native) printf '%s' "charge les extensions sans Rosetta, rien à faire." ;;
    es:native) printf '%s' "carga las extensiones sin Rosetta, nada que hacer." ;;
    pt:native) printf '%s' "carrega as extensões sem o Rosetta, nada a fazer." ;;
    *:native) printf '%s' "loads extensions without Rosetta, nothing to do." ;;
    fr:needs_rosetta) printf '%s' "n'a les extensions (TypeR) qu'avec Rosetta." ;;
    es:needs_rosetta) printf '%s' "solo tiene extensiones (TypeR) con Rosetta." ;;
    pt:needs_rosetta) printf '%s' "só tem extensões (TypeR) com o Rosetta." ;;
    *:needs_rosetta) printf '%s' "only has extensions (TypeR) under Rosetta." ;;
    fr:no_cep) printf '%s' "ne prend plus en charge les extensions CEP : TypeR ne peut pas y fonctionner." ;;
    es:no_cep) printf '%s' "ya no admite extensiones CEP: TypeR no puede funcionar en él." ;;
    pt:no_cep) printf '%s' "não oferece mais extensões CEP: o TypeR não pode funcionar nele." ;;
    *:no_cep) printf '%s' "no longer supports CEP extensions: TypeR cannot run in it." ;;
    fr:installing_rosetta) printf '%s' "Installation de Rosetta (votre mot de passe peut être demandé)..." ;;
    es:installing_rosetta) printf '%s' "Instalando Rosetta (puede pedirse tu contraseña)..." ;;
    pt:installing_rosetta) printf '%s' "Instalando o Rosetta (sua senha pode ser solicitada)..." ;;
    *:installing_rosetta) printf '%s' "Installing Rosetta (your password may be requested)..." ;;
    fr:rosetta_missing) printf '%s' "Rosetta n'est pas disponible sur ce Mac : lancez « softwareupdate --install-rosetta » puis relancez ce script." ;;
    es:rosetta_missing) printf '%s' "Rosetta no está disponible en este Mac: ejecuta «softwareupdate --install-rosetta» y vuelve a ejecutar este script." ;;
    pt:rosetta_missing) printf '%s' "O Rosetta não está disponível neste Mac: execute «softwareupdate --install-rosetta» e rode este script de novo." ;;
    *:rosetta_missing) printf '%s' "Rosetta is not available on this Mac: run \"softwareupdate --install-rosetta\", then run this script again." ;;
    fr:launcher) printf '%s' "Lanceur créé (à mettre dans le Dock, utilisez-le à la place de Photoshop) :" ;;
    es:launcher) printf '%s' "Lanzador creado (ponlo en el Dock y úsalo en lugar de Photoshop):" ;;
    pt:launcher) printf '%s' "Atalho criado (coloque no Dock e use-o no lugar do Photoshop):" ;;
    *:launcher) printf '%s' "Launcher created (put it in the Dock and use it instead of Photoshop):" ;;
    fr:launcher_fail) printf '%s' "Impossible de créer le lanceur. Ouvrez Photoshop avec : open --arch x86_64 -a" ;;
    es:launcher_fail) printf '%s' "No se pudo crear el lanzador. Abre Photoshop con: open --arch x86_64 -a" ;;
    pt:launcher_fail) printf '%s' "Não foi possível criar o atalho. Abra o Photoshop com: open --arch x86_64 -a" ;;
    *:launcher_fail) printf '%s' "Could not create the launcher. Open Photoshop with: open --arch x86_64 -a" ;;
    fr:dialog_native) printf '%s' "Photoshop est ouvert sans Rosetta, TypeR n'y apparaît pas. Le quitter et le rouvrir avec Rosetta ?" ;;
    es:dialog_native) printf '%s' "Photoshop está abierto sin Rosetta y TypeR no aparece. ¿Cerrarlo y volver a abrirlo con Rosetta?" ;;
    pt:dialog_native) printf '%s' "O Photoshop está aberto sem o Rosetta e o TypeR não aparece. Fechar e reabrir com o Rosetta?" ;;
    *:dialog_native) printf '%s' "Photoshop is open without Rosetta, so TypeR is missing. Quit and reopen it with Rosetta?" ;;
    fr:relaunch) printf '%s' "Relancer" ;;
    es:relaunch) printf '%s' "Reabrir" ;;
    pt:relaunch) printf '%s' "Reabrir" ;;
    *:relaunch) printf '%s' "Relaunch" ;;
    fr:cancel) printf '%s' "Annuler" ;;
    es:cancel) printf '%s' "Cancelar" ;;
    pt:cancel) printf '%s' "Cancelar" ;;
    *:cancel) printf '%s' "Cancel" ;;
    fr:quarantine) printf '%s' "Blocage de téléchargement macOS retiré des fichiers TypeR." ;;
    es:quarantine) printf '%s' "Bloqueo de descarga de macOS eliminado de los archivos de TypeR." ;;
    pt:quarantine) printf '%s' "Bloqueio de download do macOS removido dos arquivos do TypeR." ;;
    *:quarantine) printf '%s' "Removed the macOS download quarantine from TypeR files." ;;
    fr:not_installed) printf '%s' "TypeR n'est pas encore installé : lancez ./install_mac.sh." ;;
    es:not_installed) printf '%s' "TypeR aún no está instalado: ejecuta ./install_mac.sh." ;;
    pt:not_installed) printf '%s' "O TypeR ainda não está instalado: execute ./install_mac.sh." ;;
    *:not_installed) printf '%s' "TypeR is not installed yet: run ./install_mac.sh." ;;
    fr:done) printf '%s' "Terminé. Ouvrez Photoshop avec le lanceur, puis [Fenêtre] > [Extensions (héritées)] > [TypeR]." ;;
    es:done) printf '%s' "Listo. Abre Photoshop con el lanzador y luego [Ventana] > [Extensiones (heredadas)] > [TypeR]." ;;
    pt:done) printf '%s' "Concluído. Abra o Photoshop pelo atalho e depois [Janela] > [Extensões (herdadas)] > [TypeR]." ;;
    *:done) printf '%s' "Done. Open Photoshop with the launcher, then [Window] > [Extensions (Legacy)] > [TypeR]." ;;
  esac
}

say() { printf '%s\n' "$(msg "$1")"; }

FROM_INSTALLER=0
[ "${1:-}" = "--from-installer" ] && FROM_INSTALLER=1

if [ "$FROM_INSTALLER" -eq 0 ]; then
  say title
  if [ -t 0 ] && [ "${1:-}" != "--silent" ]; then
    say close
    read -r -p "$(msg enter) "
  fi
fi

if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" != 1 ]; then
  [ "$FROM_INSTALLER" -eq 1 ] || say intel
  exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/typer-rosetta.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# —————————————————————————————————————————————————————————————
# Photoshop installations
# —————————————————————————————————————————————————————————————
PHOTOSHOP_APPS=()
while IFS= read -r app; do
  [ -d "$app" ] || continue
  case "$app" in */.Trash/*) continue ;; esac
  case " ${PHOTOSHOP_APPS[*]-} " in *" $app "*) continue ;; esac
  PHOTOSHOP_APPS+=("$app")
done < <(
  for app in /Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app "$HOME"/Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app; do
    [ -d "$app" ] && printf '%s\n' "$app"
  done
  mdfind "kMDItemCFBundleIdentifier == 'com.adobe.Photoshop'" 2>/dev/null
)

# CEP lives in Photoshop's own code, so check each architecture separately.
slice_has_cep() {
  local executable="$1" arch="$2" thin="$WORK/slice"
  lipo -archs "$executable" 2>/dev/null | tr ' ' '\n' | grep -qx "$arch" || return 1
  if lipo -info "$executable" 2>/dev/null | grep -q '^Non-fat'; then thin="$executable"
  else lipo "$executable" -thin "$arch" -output "$thin" 2>/dev/null || return 1
  fi
  LC_ALL=C grep -q TCEPManager "$thin"
  local status=$?
  rm -f "$WORK/slice"
  return $status
}

rosetta_available() { arch -x86_64 /usr/bin/true 2>/dev/null; }

# Small AppleScript app: opens this Photoshop with Rosetta, and offers to
# relaunch it when it is already running natively.
create_launcher() {
  local app="$1" name="$2" executable="$3" launcher="$LAUNCHER_DIR/$2 (TypeR).app" script="$WORK/launcher.applescript"
  local escaped="${app//\\/\\\\}"; escaped="${escaped//\"/\\\"}"
  local escaped_executable="${executable//\\/\\\\}"; escaped_executable="${escaped_executable//\"/\\\"}"
  cat > "$script" <<APPLESCRIPT
set photoshopApp to "$escaped"
set photoshopBinary to "$escaped_executable( |\$)"
set runningPid to do shell script "pgrep -f " & quoted form of photoshopBinary & " | head -n 1 || true"
if runningPid is not "" then
  set processFlags to do shell script "ps -o flags= -p " & runningPid & " | tr -d ' '"
  if processFlags is "" then set processFlags to "0"
  set isTranslated to do shell script "[ \$((0x" & processFlags & " & 0x20000)) -ne 0 ] && echo yes || echo no"
  if isTranslated is "no" then
    display dialog "$(msg dialog_native)" buttons {"$(msg cancel)", "$(msg relaunch)"} default button 2 cancel button 1 with icon caution
    tell application id "com.adobe.Photoshop" to quit
    repeat 120 times
      if (do shell script "pgrep -f " & quoted form of photoshopBinary & " >/dev/null && echo running || echo stopped") is "stopped" then exit repeat
      delay 0.5
    end repeat
  end if
end if
do shell script "open --arch x86_64 -a " & quoted form of photoshopApp
APPLESCRIPT
  mkdir -p "$LAUNCHER_DIR" || return 1
  rm -rf "$launcher"
  osacompile -o "$launcher" "$script" >/dev/null 2>&1 || return 1
  local icon
  icon="$(defaults read "$app/Contents/Info.plist" CFBundleIconFile 2>/dev/null || true)"
  [ -n "$icon" ] && [ "${icon%.icns}" = "$icon" ] && icon="$icon.icns"
  if [ -n "$icon" ] && [ -f "$app/Contents/Resources/$icon" ]; then
    cp "$app/Contents/Resources/$icon" "$launcher/Contents/Resources/applet.icns"
    codesign --force --deep --sign - "$launcher" >/dev/null 2>&1
    touch "$launcher"
  fi
  printf '%s\n  %s\n' "$(msg launcher)" "$launcher"
}

if [ "${#PHOTOSHOP_APPS[@]}" -eq 0 ]; then
  say none
else
  for app in "${PHOTOSHOP_APPS[@]}"; do
    name="$(basename "$app" .app)"
    version="$(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)"
    executable="$app/Contents/MacOS/$(defaults read "$app/Contents/Info.plist" CFBundleExecutable 2>/dev/null || printf '%s' "$name")"
    printf '%s %s %s...\n' "$(msg checking)" "$name" "$version"
    if slice_has_cep "$executable" arm64; then
      printf '  %s\n' "$(msg native)"
    elif slice_has_cep "$executable" x86_64; then
      printf '  %s\n' "$(msg needs_rosetta)"
      if ! rosetta_available; then
        say installing_rosetta
        softwareupdate --install-rosetta --agree-to-license >/dev/null 2>&1 || true
      fi
      if ! rosetta_available; then say rosetta_missing; continue; fi
      create_launcher "$app" "$name" "$executable" || printf '%s %q\n' "$(msg launcher_fail)" "$app"
    else
      printf '  %s\n' "$(msg no_cep)"
    fi
  done
fi

# —————————————————————————————————————————————————————————————
# Unsigned extension: debug mode for every CEP version, no quarantine flag.
# —————————————————————————————————————————————————————————————
if [ "$FROM_INSTALLER" -eq 0 ]; then
  for version in {6..18}; do defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1; done
fi
if [ -d "$EXT_DIR" ]; then
  if xattr -r "$EXT_DIR" 2>/dev/null | grep -q com.apple.quarantine; then
    xattr -dr com.apple.quarantine "$EXT_DIR" 2>/dev/null && say quarantine
  fi
elif [ "$FROM_INSTALLER" -eq 0 ]; then
  say not_installed
fi

[ "$FROM_INSTALLER" -eq 1 ] || say done
exit 0
