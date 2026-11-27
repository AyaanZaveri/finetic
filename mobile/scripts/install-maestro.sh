#!/usr/bin/env bash
set -euo pipefail
version=cli-2.13.0
sha=ccc536679ed35e3a84b7e9e5c364f2371204c291fb331fec8c00e3e496dda5ff
archive="${RUNNER_TEMP:-/tmp}/navigator-maestro.zip"
install_dir="${RUNNER_TEMP:-/tmp}/navigator-maestro"
curl --fail --silent --show-error --location --retry 3 "https://github.com/mobile-dev-inc/Maestro/releases/download/$version/maestro.zip" -o "$archive"
python3 - "$archive" "$sha" <<'PY'
import hashlib, pathlib, sys
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() == sys.argv[2], 'Maestro checksum mismatch'
PY
mkdir -p "$install_dir"
unzip -q "$archive" -d "$install_dir"
maestro_bin=$(find "$install_dir" -type f -path '*/bin/maestro' -print -quit)
test -n "$maestro_bin"
chmod +x "$maestro_bin"
printf '%s\n' "$(dirname "$maestro_bin")" >> "$GITHUB_PATH"
