import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

// The native baseline is frozen; descendant App changes do not relabel its reader.
export const baselineReader = gunzipSync(fs.readFileSync(new URL('./progressSync.ts.gz', import.meta.url)));
