#!/usr/bin/env bash
# Publish the pipeline's artifacts so a git-triggered Netlify build can use them.
#
# Run on the machine that holds the FEC data, after scripts/07, 09 and 10 have
# passed their acceptance checks. It packs data/artifacts (exactly the files
# the site already serves from web/public/data, nothing upstream of them)
# into one archive and uploads it to the repo's `data` GitHub Release, which
# web/scripts/fetch-data.mjs downloads on every Netlify build.
#
# Needs the GitHub CLI, logged in: `gh auth login`.
#
# Afterwards, the next merge to main deploys with this data. To deploy it
# without a merge: Netlify > Deploys > Trigger deploy.
set -euo pipefail

cd "$(dirname "$0")/.."
ART=data/artifacts
TAG=data

# The artifacts web/scripts/require-data.mjs insists on; the build fails
# without them, so refuse to upload an archive that lacks one.
[ -d "$ART" ] || { echo "no $ART: run the pipeline first" >&2; exit 1; }
for f in districts states meta sectors senate; do
  ls "$ART"/"$f"-*-v*.* >/dev/null 2>&1 || { echo "$ART has no $f artifact" >&2; exit 1; }
done

OUT=$(mktemp -d)/artifacts.tar.gz
# -h follows symlinks; no uid/gid so the archive doesn't carry local users.
tar -czh --owner=0 --group=0 -f "$OUT" -C "$ART" . 2>/dev/null \
  || tar -czh -f "$OUT" -C "$ART" .   # BSD tar (macOS) has no --owner
echo "packed $(du -h "$OUT" | cut -f1) from $ART"

if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --title "Site data" --latest=false \
    --notes "Published artifacts for the Netlify build. Replaced by scripts/publish_data.sh on each data refresh; not a code release."
fi
gh release upload "$TAG" "$OUT" --clobber
echo "uploaded to release '$TAG'. The next merge to main deploys it."
