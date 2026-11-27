#!/usr/bin/env bash
set -euo pipefail
url=$1
archive=$2
sha=$3
curl --fail --silent --show-error --location --retry 3 "$url" -o "$archive"
python3 - "$archive" "$sha" <<'PY'
import hashlib, sys
with open(sys.argv[1], 'rb') as f:
    actual = hashlib.file_digest(f, 'sha256').hexdigest()
assert actual == sys.argv[2], 'Download checksum mismatch'
PY
