#!/usr/bin/env bash
#
# OpenFireWatch — the one place a version number is changed.
#
# The version lived in four files that had to be edited in step: three
# package.json manifests and a hard-coded string in the API's OpenAPI config.
# Nothing enforced that they agreed, so the first thing to drift would have
# been the number a responder reads off the screen while reporting a problem.
#
# The root VERSION file is now the single source of truth. This script copies
# it everywhere it has to appear, and `--check` proves it did — which is what
# CI runs, so a manifest edited by hand fails the build instead of quietly
# disagreeing with the release it claims to be.
#
# Usage:
#   scripts/version.sh 1.2.3     set a new version everywhere
#   scripts/version.sh --check   verify every copy matches VERSION
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PACKAGES=(backend frontend workers)
GENERATED_TS="frontend/src/app/core/version.ts"

# Node is required to build any part of this project, so it is a safe
# dependency here — unlike jq, which is not installed on a plain runner.
read_manifest_version() {
  node -p "require('./$1/package.json').version"
}

# SemVer, as published at semver.org. Rejecting anything else here is what
# keeps "0.1" or "v1.0.0" from reaching a git tag and an image label.
assert_semver() {
  if ! [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "error: '$1' is not a semantic version (expected e.g. 1.2.3)" >&2
    exit 1
  fi
}

write_generated_ts() {
  cat > "$GENERATED_TS" <<TS
/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/version.sh from the root VERSION file, and committed so
 * that a plain \`npm run build\` needs no extra tooling. CI verifies it still
 * matches; run \`scripts/version.sh --check\` to verify it locally.
 */

/** The released version this bundle was built from. */
export const APP_VERSION = '$1';
TS
}

case "${1:-}" in
  --check)
    expected="$(cat VERSION)"
    assert_semver "$expected"
    status=0

    for package in "${PACKAGES[@]}"; do
      actual="$(read_manifest_version "$package")"
      if [[ "$actual" != "$expected" ]]; then
        echo "drift: $package/package.json is $actual, VERSION is $expected" >&2
        status=1
      fi
    done

    if ! grep -q "APP_VERSION = '$expected'" "$GENERATED_TS" 2>/dev/null; then
      echo "drift: $GENERATED_TS does not carry $expected" >&2
      status=1
    fi

    if [[ $status -eq 0 ]]; then
      echo "version $expected is consistent across VERSION, $(IFS=,; echo "${PACKAGES[*]}") and the frontend bundle"
    else
      echo "run: scripts/version.sh $expected" >&2
    fi
    exit $status
    ;;

  '' | -h | --help)
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

version="$1"
assert_semver "$version"

printf '%s\n' "$version" > VERSION

for package in "${PACKAGES[@]}"; do
  # `npm version` rather than editing JSON: it also updates the two version
  # fields inside package-lock.json, which a hand-written sed would miss and
  # `npm ci` would later reject.
  ( cd "$package" && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null )
done

write_generated_ts "$version"

cat <<DONE
version set to $version

Still to do, in this order:
  1. record what changed in CHANGELOG.md under [$version]
  2. git commit -am "release: v$version"
  3. git tag -a "v$version" -m "OpenFireWatch v$version" && git push --follow-tags
DONE
