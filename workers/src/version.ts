/**
 * What this worker process actually is — logged at startup.
 *
 * Read from the package manifest rather than repeated here: scripts/version.sh
 * keeps that manifest in step with the root VERSION file, and a second literal
 * would be one more place to forget. Resolved from the compiled file's own
 * location, so `dist/index.js` in the container and `src/index.ts` in
 * development both find the manifest one directory up.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readManifestVersion(): string {
  try {
    const manifest = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? 'unknown';
  } catch {
    // A missing manifest must not stop ingestion.
    return 'unknown';
  }
}

export const APP_VERSION = readManifestVersion();

/** Short commit the image was built from, or 'unknown' outside a build. */
export const GIT_REVISION = process.env.GIT_SHA?.trim() || 'unknown';
