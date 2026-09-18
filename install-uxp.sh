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
# Merge: keep every other registered plugin, replace only this one. An
# unreadable or unexpected PS.json stops the script instead of being erased.
data = {"plugins": []}
if reg.exists() and reg.read_text().strip():
    data = json.loads(reg.read_text())
if not isinstance(data, dict) or not isinstance(data.setdefault("plugins", []), list):
    sys.exit(f"Unexpected format in {reg}; not modified")
data["plugins"] = [p for p in data["plugins"] if not (isinstance(p, dict) and p.get("pluginId") == plugin_id)]
data["plugins"].append({
  "hostMinVersion": "26.0.0",
  "name": "TypeR Silicon",
  "path": f"$localPlugins/External/{plugin_id}_{version}",
  "pluginId": plugin_id,
  "status": "enabled",
  "type": "uxp",
  "versionString": version,
})
tmp = reg.with_name(reg.name + ".typer-tmp")
tmp.write_text(json.dumps(data, separators=(",", ":")))
tmp.replace(reg)
print(reg.read_text())
PY
echo "Installed TypeR Silicon $version. Restart Photoshop."
