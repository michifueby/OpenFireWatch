/**
 * What this process actually is — reported by /api/health and the OpenAPI
 * document, and logged at startup.
 *
 * The release version is read from the package manifest rather than repeated
 * here, because scripts/version.sh already keeps that manifest in step with
 * the root VERSION file; a second literal would be a fifth place to forget.
 *
 * The revision is separate on purpose. Between releases the version does not
 * move, so it cannot answer the question that actually gets asked after a
 * deploy — "is the fix I just pushed the one that is running?". The commit
 * can, and it is baked in at image build time (see the Dockerfile).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Resolved from the compiled file, not from cwd: `dist/main.js` and
 *  `src/main.ts` both sit exactly one directory below the manifest, so this
 *  works identically in the container and in `npm run start:dev`. */
function readManifestVersion(): string {
  try {
    const manifest = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? 'unknown';
  } catch {
    // A missing manifest must not stop the API from serving alerts.
    return 'unknown';
  }
}

export const APP_VERSION = readManifestVersion();

/** Short commit the image was built from, or 'unknown' outside a build. */
export const GIT_REVISION = process.env.GIT_SHA?.trim() || 'unknown';
