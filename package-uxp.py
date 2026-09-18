"""Package the native UXP build as a local CCX without including user data."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent
build = root / "uxp"
manifest = json.loads((build / "manifest.json").read_text())
assert manifest["id"] == "fr.scanr.typer.silicon"
assert manifest["host"]["data"]["apiVersion"] == 2
files = [file for file in build.rglob("*") if file.is_file() and file.name not in {".DS_Store", "typer-keys"}]
assert not any(file.suffix in {".jsx", ".jsxinc", ".dylib", ".exe", ".node"} for file in files)
assert not any(file.name.startswith("storage") for file in files)
assert not any(file.name == "typer-keys" for file in files)
assert not any(file.read_bytes()[:4] == b"\xcf\xfa\xed\xfe" or file.read_bytes()[:4] == b"\xca\xfe\xba\xbe" for file in files)
outputs = [root / "TypeR-Silicon.ccx", root / "fr.scanr.typer.silicon_PS.ccx"]
with zipfile.ZipFile(outputs[0], "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    # Adobe's packager writes the manifest as the first ZIP entry.
    for file in sorted(files, key=lambda file: (file.name != "manifest.json", str(file))):
        archive.write(file, file.relative_to(build))
with zipfile.ZipFile(outputs[0]) as archive:
    assert archive.testzip() is None
outputs[1].write_bytes(outputs[0].read_bytes())
for output in outputs:
    print(f"Created {output} ({output.stat().st_size:,} bytes)")
