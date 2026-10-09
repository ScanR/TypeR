#!/bin/bash
# Installs the TypeR UXP plugin (Photoshop 2025 and later), without asking
# which version to install: the same as ./install_mac.sh --uxp
#   ./install_uxp_mac.sh                 installs TypeR-UXP.ccx next to this script,
#                                        or the latest release when there is none
#   ./install_uxp_mac.sh path/to/x.ccx   installs that package
# Double-clicking TypeR-UXP.ccx does the same through Creative Cloud.
exec bash "$(cd "$(dirname "$0")" && pwd)/install_mac.sh" --uxp "$@"
