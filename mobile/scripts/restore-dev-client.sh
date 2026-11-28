#!/usr/bin/env bash
# Restore only immutable artifacts made by our trusted development workflow.
# Failure to find or validate one is a normal cache miss, not a CI failure.
set -euo pipefail
platform=${1:?android or ios}
hash=${2:?native fingerprint}
allow_current=${3:-}
if [ -n "$allow_current" ] && { [ "$allow_current" != --allow-current-run ] || [ "$platform" != ios ]; }; then
  echo 'Only an iPad preview can restore the current run’s universal iOS client' >&2
  exit 2
fi
if [[ ! "$hash" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Expected a SHA-256 native fingerprint' >&2
  exit 2
fi
case "$platform" in
  android) binary=android.apk ;;
  ios) binary=ios-app.tar.gz ;;
  *) echo "Unknown platform: $platform" >&2; exit 2 ;;
esac

project=$(cd "$(dirname "$0")/.." && pwd)
folder="$project/test-results/dev-client"
name="navigator-dev-$platform-$hash"
hit=false
tmp=''
finish() {
  if [ -n "$tmp" ]; then rm -rf "$tmp"; fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'hit=%s\n' "$hit" >> "$GITHUB_OUTPUT"; fi
}
trap finish EXIT
miss() { echo "Native development client cache miss: $*" >&2; exit 0; }

# Never use a cache from a pull request or from a local checkout. The native
# artifact is executable, so verify its producer and branch before restoring.
[ "${GITHUB_ACTIONS:-}" = true ] || miss 'not running in GitHub Actions'
case "${GITHUB_EVENT_NAME:-}" in
  push|workflow_dispatch) ;;
  *) miss 'untrusted event' ;;
esac
[ "${GITHUB_REF_TYPE:-branch}" = branch ] || miss 'not a branch ref'
repo=${GITHUB_REPOSITORY:-}
repo_id=${GITHUB_REPOSITORY_ID:-}
branch=${GITHUB_REF_NAME:-}
sha=${GITHUB_SHA:-}
run_id=${GITHUB_RUN_ID:-}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || miss 'missing repository'
[[ "$repo_id" =~ ^[0-9]+$ ]] || miss 'missing repository identity'
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || miss 'missing source commit'
[ -n "$branch" ] || miss 'missing branch'
[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ] || miss 'no Actions read token'

mkdir -p "$folder"
# The path contains only a disposable CI build output. Ensure the caller will
# rebuild on a miss instead of mistakenly reusing a stale file.
rm -f "$folder/$binary"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/navigator-dev-cache.XXXXXX")
if ! gh api --method GET "repos/$repo/actions/artifacts" \
    -f "name=$name" -F per_page=100 > "$tmp/artifacts.json" 2>/dev/null; then
  miss 'artifact listing unavailable'
fi

# Require same repository and head repository, same branch, exact name, and
# the artifact service's SHA-256 digest. Check the full run provenance below.
if ! python3 - "$tmp/artifacts.json" "$name" "$repo_id" "$branch" "$run_id" "$sha" "$allow_current" <<'PY' > "$tmp/candidates"
import json, re, sys
path, name, repo, branch, current_run, sha, allow_current = sys.argv[1:]
artifacts = json.load(open(path)).get('artifacts', [])
artifacts.sort(key=lambda item: item.get('created_at', ''), reverse=True)
count = 0
for art in artifacts:
    run = art.get('workflow_run') or {}
    digest = art.get('digest') or ''
    head = run.get('head_sha') or ''
    if (art.get('name') != name or art.get('expired')
            or not art.get('size_in_bytes', 0) > 0
            or str(run.get('repository_id')) != repo
            or str(run.get('head_repository_id')) != repo
            or run.get('head_branch') != branch
            or (str(run.get('id')) == current_run and (not allow_current or head != sha))
            or not str(run.get('id')).isdigit()
            or not str(art.get('id')).isdigit()
            or not re.fullmatch(r'[0-9a-f]{40}', head)
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest)):
        continue
    print(art['id'], run['id'], head, digest[7:], sep='\t')
    count += 1
    if count == 20:
        break
PY
then miss 'invalid artifact metadata'; fi

while IFS=$'\t' read -r artifact producer head digest; do
  [ -n "$artifact" ] || continue
  if ! gh api "repos/$repo/actions/runs/$producer" > "$tmp/run.json" 2>/dev/null; then continue; fi
  if ! python3 - "$tmp/run.json" "$repo_id" "$branch" "$head" <<'PY'
import json, sys
path, repo, branch, head = sys.argv[1:]
run = json.load(open(path))
# A binary is published immediately after a successful native build. A later
# UI-test failure does not make that native binary incompatible.
ok = (
    run.get('path') == '.github/workflows/mobile-development.yml'
    and run.get('event') in ('push', 'workflow_dispatch')
    and str((run.get('repository') or {}).get('id')) == repo
    and str((run.get('head_repository') or {}).get('id')) == repo
    and run.get('head_branch') == branch
    and run.get('head_sha') == head
    and run.get('status') in ('in_progress', 'completed')
    and run.get('conclusion') not in ('cancelled', 'skipped', 'action_required')
)
raise SystemExit(0 if ok else 1)
PY
  then continue; fi
  # Reject artifacts from a discarded branch history (e.g. after force-push).
  if [ "$head" != "$sha" ]; then
    comparison=$(gh api --method GET "repos/$repo/compare/$head...$sha" \
      -F per_page=1 --jq '.status' 2>/dev/null || true)
    [ "$comparison" = ahead ] || continue
  fi
  if ! gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$tmp/artifact.zip" 2>/dev/null; then continue; fi

  # Manually extract exactly one expected file; never unzip arbitrary paths
  # from an executable artifact into the checkout. Verify the artifact service
  # digest before reading the archive.
  if python3 - "$tmp/artifact.zip" "$digest" "$binary" "$tmp/$binary" <<'PY'
import hashlib, pathlib, shutil, stat, sys, tarfile, zipfile
archive, expected, binary, out = sys.argv[1:]
digest = hashlib.sha256()
with open(archive, 'rb') as src:
    for chunk in iter(lambda: src.read(1024 * 1024), b''):
        digest.update(chunk)
if digest.hexdigest() != expected:
    raise SystemExit('Artifact SHA-256 mismatch')
with zipfile.ZipFile(archive) as z:
    files = [entry for entry in z.infolist() if not entry.is_dir()]
    if len(files) != 1 or files[0].filename != binary:
        raise SystemExit('Artifact does not contain exactly the expected binary')
    info = files[0]
    if stat.S_ISLNK(info.external_attr >> 16) or not 4096 <= info.file_size <= 4 * 1024**3:
        raise SystemExit('Invalid artifact file')
    with z.open(info) as src, open(out, 'wb') as dst:
        shutil.copyfileobj(src, dst)
if binary.endswith('.apk'):
    with zipfile.ZipFile(out) as apk:
        names = set(apk.namelist())
        if 'AndroidManifest.xml' not in names or 'classes.dex' not in names:
            raise SystemExit('Invalid Android APK')
else:
    # Validate the tar archive before the platform script unpacks it.
    app_plist = False
    with tarfile.open(out, 'r:gz') as tar:
        for member in tar:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.isdev():
                raise SystemExit('Unsafe iOS archive entry')
            if path.name == 'Info.plist' and path.parent.name.endswith('.app'):
                app_plist = True
            if member.issym() or member.islnk():
                link = pathlib.PurePosixPath(member.linkname)
                if link.is_absolute():
                    raise SystemExit('Unsafe absolute iOS archive link')
                # Standard framework links (e.g. Versions/Current -> A) stay
                # inside the archive. Reject any relative target that escapes.
                depth = 0
                base = path.parent if member.issym() else pathlib.PurePosixPath()
                for part in (base / link).parts:
                    if part == '..':
                        depth -= 1
                    elif part != '.':
                        depth += 1
                    if depth < 0:
                        raise SystemExit('Unsafe iOS archive link')
    if not app_plist:
        raise SystemExit('Missing simulator app Info.plist')
PY
  then
    mv "$tmp/$binary" "$folder/$binary"
    hit=true
    echo "Native development client restored: $name (run $producer)"
    exit 0
  fi
  rm -f "$tmp/$binary"
done < "$tmp/candidates"
miss 'no validated compatible artifact'
