/**
 * Move the hand-written `[Unreleased]` section under a new version heading.
 *
 * Deliberately NOT a generated changelog. Commit subjects say what changed to
 * someone who reads diffs; the Unreleased prose says what changed to a fire
 * brigade. Automating the version number is worth it because getting it wrong
 * is silent and undetectable — automating the prose would trade the only part
 * a reader actually benefits from for a list they could get from `git log`.
 *
 * If nothing was written under Unreleased, the commit subjects go in instead,
 * marked as needing a human. A release with an empty changelog entry is worse
 * than an untidy one.
 *
 * Usage: node scripts/changelog.mjs <version> <date> <previousTag|""> [subjects...]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [version, date, previousTag, ...subjects] = process.argv.slice(2);
const FILE = 'CHANGELOG.md';
const REPO = 'https://github.com/michifueby/OpenFireWatch';

let text = readFileSync(FILE, 'utf8');

const unreleasedHeading = '## [Unreleased]';
const start = text.indexOf(unreleasedHeading);
if (start === -1) {
  console.error(`error: no "${unreleasedHeading}" heading in ${FILE}`);
  process.exit(1);
}

const bodyStart = start + unreleasedHeading.length;
// The Unreleased body runs to the next version heading, or to the link
// definitions at the foot of the file.
const nextHeading = text.indexOf('\n## ', bodyStart);
const linkDefs = text.indexOf('\n[Unreleased]:');
const bodyEnd =
  nextHeading === -1 ? (linkDefs === -1 ? text.length : linkDefs) : nextHeading;

const captured = text.slice(bodyStart, bodyEnd).trim();
const body =
  captured ||
  [
    '### Changed',
    '',
    '<!-- Written from commit subjects: no Unreleased notes existed at release',
    '     time. Worth rewriting for a reader who does not read diffs. -->',
    ...subjects.map((subject) => `- ${subject}`),
  ].join('\n');

text =
  text.slice(0, start) +
  `${unreleasedHeading}\n\n## [${version}] — ${date}\n\n${body}\n` +
  text.slice(bodyEnd);

// Link definitions: Unreleased now compares against the new tag, the new
// version against the one before it.
text = text.replace(
  /^\[Unreleased\]:.*$/m,
  `[Unreleased]: ${REPO}/compare/v${version}...HEAD`,
);
const newLink = previousTag
  ? `[${version}]: ${REPO}/compare/${previousTag}...v${version}`
  : `[${version}]: ${REPO}/releases/tag/v${version}`;
text = text.replace(
  /^(\[Unreleased\]:.*)$/m,
  `$1\n${newLink}`,
);

writeFileSync(FILE, text);
console.log(`CHANGELOG.md: [${version}] — ${date}`);
