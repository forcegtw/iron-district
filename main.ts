// Entry point for the threejs-fps-01 make.fun submission, written for this session.
//
// What this program does, in plain terms:
//   * It assembles the deliverable folder the judge consumes. By default that
//     destination is /output, but MAKEFUN_OUTPUT_DIR overrides it so the same
//     script works anywhere.
//   * The game itself is static: this repo's game/ directory (index.html plus
//     ES modules served straight from disk, pulling three.js through an import
//     map). We copy it wholesale into the output.
//   * Screenshots live in screenshots/ next to this file. Only PNG or JPEG
//     images ship; the first one by name becomes the cover image. We wipe any
//     images lingering in the destination first, then copy fresh ones in if
//     the source folder exists, and list them in the dossier.
//   * Finally we produce dossier.json through the vendored
//     vendor/makefun-threejs.ts buildDossier helper, passing the scorer's own
//     caps so an invalid entry fails here instead of at the gate.
//
// To preview the game: run `node serve.ts` and visit http://localhost:8080.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });

// 1. Ship the game files, unmodified.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// 2. Ship screenshots. Clean the destination first so leftovers from an
//    earlier run can never leak into the dossier.
const shotsDest = join(outDir, 'screenshots');
mkdirSync(shotsDest, { recursive: true });
for (const name of readdirSync(shotsDest)) {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) rmSync(join(shotsDest, name));
}
const shotsSrc = join(repoRoot, 'screenshots');
const hasShots = existsSync(shotsSrc);
if (hasShots) cpSync(shotsSrc, shotsDest, { recursive: true });

// 3. Write the judge-facing summary. Caps mirror reference/gate.json: text size,
//    at most 4 screenshots of 256 KiB each, and the game/ file-count and byte
//    budgets (993 files, 48 MiB) that keep the whole /output under its 1000
//    entries including screenshots/ and dossier.json itself.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
