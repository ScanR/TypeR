#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
src="$root/uxp"
manifest="$src/manifest.json"
test -f "$manifest"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$manifest")"
id="fr.scanr.typer.silicon"
ext="$HOME/Library/Application Support/Adobe/UXP/Plugins/External"
dest="$ext/${id}_${version}"
reg="$HOME/Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json"
mkdir -p "$ext" "$(dirname "$reg")"
rm -rf "$ext"/${id}_*
mkdir -p "$dest"
rsync -a --delete --exclude '.DS_Store' --exclude 'typer-keys' "$src/" "$dest/"
python3 - "$reg" "$id" "$version" <<'PY'
import json, sys
from pathlib import Path
reg, plugin_id, version = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
reg.write_text(json.dumps({"plugins":[{
  "hostMinVersion": "26.0.0",
  "name": "TypeR Silicon",
  "path": f"$localPlugins/External/{plugin_id}_{version}",
  "pluginId": plugin_id,
  "status": "enabled",
  "type": "uxp",
  "versionString": version,
}]}, separators=(",", ":")))
print(reg.read_text())
PY
echo "Installed TypeR Silicon $version. Restart Photoshop."
