#!/usr/bin/env bash
#
# OpenFireWatch — work out the next version from the commits, and cut it.
#
# The version number is the one piece of release metadata that is silently
# wrong when a human forgets: nothing fails, nothing warns, the number just
# stops describing what shipped. So it is derived rather than typed, from the
# Conventional Commit prefixes the project already uses.
#
#   feat:              → minor      a capability that was not there before
#   fix: / perf:       → patch      same capabilities, working better
#   BREAKING CHANGE /  → see below
#   feat!: fix!: …
#   docs: build: ci:   → no release nothing a user of the software can observe
#   chore: refactor:
#   style: test:
#
# While the version is below 1.0.0, a breaking change bumps the MINOR, not the
# major — SemVer reserves 0.x for exactly that, and CONTRIBUTING.md commits to
# 1.0.0 meaning something specific for this project: the hazard zones having
# been reviewed by the fire service that would rely on them. Reaching 1.0.0 by
# accident, because somebody renamed a field, would spend that signal.
#
# Usage:
#   scripts/release.sh              cut the release the commits call for
#   scripts/release.sh --dry-run    print what it would do, change nothing
#   scripts/release.sh --print      print just the next version (or nothing)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-run}"

current="$(cat VERSION)"
# Most recent version tag, if any. A repository with no tags releases
# everything in its history.
previous_tag="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
range="${previous_tag:+${previous_tag}..}HEAD"

breaking=0
feature=0
patch=0
subjects=()

# Held in a variable: inside [[ =~ ]] an inline pattern with parentheses is
# parsed as shell syntax, not as a regex.
BREAKING_SUBJECT='^[a-zA-Z]+(\([^)]*\))?!:'


while read -r sha; do
  [[ -z "$sha" ]] && continue
  subject="$(git log -1 --pretty=%s "$sha")"
  full="$(git log -1 --pretty=%B "$sha")"

  # `type(scope)!: …` and a `BREAKING CHANGE:` footer are the two ways
  # Conventional Commits marks a break; both are honoured.
  if [[ "$subject" =~ $BREAKING_SUBJECT ]] || [[ "$full" == *"BREAKING CHANGE:"* ]]; then
    breaking=1
  fi

  type="${subject%%[(!:]*}"
  case "$type" in
    feat) feature=1; subjects+=("$subject") ;;
    fix|perf) patch=1; subjects+=("$subject") ;;
    # Everything else changes nothing a user of the software can observe, so
    # it rides along in the next release rather than causing one.
    *) ;;
  esac
done <<< "$(git rev-list "$range")"

major="${current%%.*}"
rest="${current#*.}"
minor="${rest%%.*}"
patchver="${rest#*.}"
patchver="${patchver%%-*}"

next=""
reason=""
if [[ $breaking -eq 1 && "$major" != "0" ]]; then
  next="$((major + 1)).0.0"; reason="a breaking change"
elif [[ $breaking -eq 1 ]]; then
  next="${major}.$((minor + 1)).0"; reason="a breaking change (minor while below 1.0.0)"
elif [[ $feature -eq 1 ]]; then
  next="${major}.$((minor + 1)).0"; reason="new features"
elif [[ $patch -eq 1 ]]; then
  next="${major}.${minor}.$((patchver + 1))"; reason="fixes"
fi

if [[ -z "$next" ]]; then
  [[ "$MODE" == "--print" ]] && exit 0
  echo "No release: nothing since ${previous_tag:-the first commit} that a user could observe."
  exit 0
fi

if [[ "$MODE" == "--print" ]]; then
  echo "$next"
  exit 0
fi

echo "${previous_tag:-(no tag)} → v${next}  (${reason}, ${#subjects[@]} relevant commit(s))"
for subject in "${subjects[@]}"; do echo "  · $subject"; done

if [[ "$MODE" == "--dry-run" ]]; then
  echo
  echo "Dry run — nothing changed."
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash first." >&2
  exit 1
fi

scripts/version.sh "$next" >/dev/null
# Date comes from the machine cutting the release, in UTC, so a changelog read
# in another timezone still lines up with the tag.
node scripts/changelog.mjs "$next" "$(date -u +%Y-%m-%d)" "$previous_tag" "${subjects[@]}"

git add -A
git commit -q -m "release: v${next}"
git tag -a "v${next}" -m "OpenFireWatch v${next}"

echo
echo "Released v${next}. Push it with:"
echo "  git push --follow-tags"
