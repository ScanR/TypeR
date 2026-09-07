#!/bin/bash
set -e

RELEASE_URL="https://github.com/ScanR/TypeR/releases/latest/download/TypeR.zip"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="${TYPER_UPDATE_TARGET:-$HOME/Library/Application Support/Adobe/CEP/extensions/typertools}"

LANGUAGE_CODE="${LC_ALL:-${LC_MESSAGES:-}}"
if [ -z "$LANGUAGE_CODE" ]; then
  LANGUAGE_CODE="$(defaults read -g AppleLocale 2>/dev/null || printf 'en')"
fi
LANGUAGE_CODE="${LANGUAGE_CODE%%[_-]*}"

case "$LANGUAGE_CODE" in
  ar) LOCALE_FOLDER="ar_AE" ;;
  de) LOCALE_FOLDER="de_DE" ;;
  es) LOCALE_FOLDER="es_SP" ;;
  fr) LOCALE_FOLDER="fr_FR" ;;
  pt) LOCALE_FOLDER="pt_BR" ;;
  ru) LOCALE_FOLDER="ru_RU" ;;
  tr) LOCALE_FOLDER="tr_TR" ;;
  uk) LOCALE_FOLDER="uk_UA" ;;
  vi) LOCALE_FOLDER="vi_VN" ;;
  *) LOCALE_FOLDER="" ;;
esac

locale_value() {
  key="$1"
  fallback="$2"
  for locale_root in "$SCRIPT_DIR/locale" "$DEST_DIR/locale"; do
    if [ -n "$LOCALE_FOLDER" ] && [ -f "$locale_root/$LOCALE_FOLDER/messages.properties" ]; then
      value="$(awk -v prefix="$key=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$locale_root/$LOCALE_FOLDER/messages.properties")"
      if [ -n "$value" ]; then printf '%s' "$value"; return; fi
    fi
    if [ -f "$locale_root/messages.properties" ]; then
      value="$(awk -v prefix="$key=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$locale_root/messages.properties")"
      if [ -n "$value" ]; then printf '%s' "$value"; return; fi
    fi
  done
  printf '%s' "$fallback"
}

format_version_message() {
  printf '%s' "${1/\{version\}/$2}"
}

compare_versions() {
  awk -v left="$1" -v right="$2" 'BEGIN {
    sub(/^v/, "", left); sub(/^v/, "", right)
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

package_version() {
  grep -oE '<Extension Id="typer" Version="[^"]+"' "$1" | head -1 | sed -E 's/.*Version="([^"]+)".*/\1/'
}

TITLE="$(locale_value updaterTitle 'TypeR standalone updater')"
DOWNLOADING="$(locale_value updaterDownloading 'Downloading the latest stable version...')"
INSTALLING="$(locale_value updaterInstalling 'Installing TypeR {version}...')"
ALREADY_CURRENT="$(locale_value updaterAlreadyCurrent 'TypeR {version} is already up to date.')"
SUCCESS="$(locale_value updaterSuccess 'TypeR {version} was updated successfully. Restart Photoshop to apply it.')"
FAILURE="$(locale_value updaterFailure 'Update failed:')"
INVALID_PACKAGE="$(locale_value updaterInvalidPackage 'The downloaded archive is not a valid TypeR package.')"

printf '%s\n' '+------------------------------------------------------------------+'
printf '|  %-64s|\n' "$TITLE"
printf '%s\n\n' '+------------------------------------------------------------------+'

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/typer-update.XXXXXX")"
ARCHIVE_PATH="$WORK_DIR/TypeR.zip"
EXTRACT_DIR="$WORK_DIR/extracted"
FOLDERS="app CSXS icons locale"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$EXTRACT_DIR"
printf '%s\n' "$DOWNLOADING"
if [ -n "${TYPER_UPDATE_ARCHIVE:-}" ]; then
  cp "$TYPER_UPDATE_ARCHIVE" "$ARCHIVE_PATH"
else
  curl -fL --retry 2 --connect-timeout 15 --max-time 180 "$RELEASE_URL" -o "$ARCHIVE_PATH"
fi

if zipinfo -l "$ARCHIVE_PATH" | awk 'substr($1,1,1) == "l" { found=1 } END { exit !found }'; then
  printf '%s %s\n' "$FAILURE" "$INVALID_PACKAGE" >&2
  exit 1
fi
if unzip -Z1 "$ARCHIVE_PATH" 2>/dev/null | tr '\\' '/' | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf '%s %s\n' "$FAILURE" "$INVALID_PACKAGE" >&2
  exit 1
fi
set +e
unzip -q "$ARCHIVE_PATH" -d "$EXTRACT_DIR" 2>"$WORK_DIR/unzip.log"
UNZIP_STATUS=$?
set -e
# Archives built with Windows' Compress-Archive use backslashes and make
# Info-ZIP return 1 as a warning even though every file was extracted.
if [ "$UNZIP_STATUS" -gt 1 ]; then
  cat "$WORK_DIR/unzip.log" >&2
  printf '%s %s\n' "$FAILURE" "$INVALID_PACKAGE" >&2
  exit 1
fi

MANIFEST_PATH=""
PACKAGE_ROOT=""
while IFS= read -r candidate_manifest; do
  candidate_root="$(dirname "$(dirname "$candidate_manifest")")"
  valid_root=1
  for folder in $FOLDERS; do
    if [ ! -d "$candidate_root/$folder" ]; then valid_root=0; break; fi
  done
  if [ "$valid_root" -eq 1 ]; then
    MANIFEST_PATH="$candidate_manifest"
    PACKAGE_ROOT="$candidate_root"
    break
  fi
done < <(find "$EXTRACT_DIR" -type f -path '*/CSXS/manifest.xml' -print)

if [ -z "$PACKAGE_ROOT" ]; then
  printf '%s %s\n' "$FAILURE" "$INVALID_PACKAGE" >&2
  exit 1
fi

PACKAGE_VERSION="$(package_version "$MANIFEST_PATH")"
if [ -z "$PACKAGE_VERSION" ]; then
  printf '%s %s\n' "$FAILURE" "$INVALID_PACKAGE" >&2
  exit 1
fi

TYPER_INSTALL_SOURCE="$PACKAGE_ROOT" TYPER_INSTALL_TARGET="$DEST_DIR" TYPER_INSTALL_SKIP_DEBUG="${TYPER_UPDATE_SKIP_DEBUG:-}" bash "$SCRIPT_DIR/install_mac.sh" --silent
format_version_message "$SUCCESS" "$PACKAGE_VERSION"
printf '\n'
