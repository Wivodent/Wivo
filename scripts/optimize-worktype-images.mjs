#!/usr/bin/env node
/**
 * Makes the app's work type pictures from the large originals:
 *
 *   node scripts/optimize-worktype-images.mjs            every picture
 *   node scripts/optimize-worktype-images.mjs bridge     only bridge.png
 *
 * Originals (PNG, about 1 MB, never committed: /assets-src/ is in .gitignore):
 *   assets-src/worktypes/3d/<id>.png            a work type   (catalogue id)
 *   assets-src/worktypes/3d/options/<id>.png    an option     (option id)
 * Output (committed, bundled with the app):
 *   src/renderer/src/assets/worktypes/3d/<id>.webp            384×384, WebP 85
 *   src/renderer/src/assets/worktypes/3d/options/<id>.webp
 *
 * The work is done by optimize-worktype-images.py (Pillow and numpy). sharp,
 * which would do this in Node, is not one of Wivo's dependencies, and a new
 * dependency for a script run a few times a year was not worth it. Needs
 * Python 3 with `pip install pillow numpy`. What the script does to each
 * picture is described at the top of the .py file.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const script = join(dirname(fileURLToPath(import.meta.url)), 'optimize-worktype-images.py')
const args = process.argv.slice(2)

for (const python of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
  const run = spawnSync(python, [script, ...args], { stdio: 'inherit' })
  if (run.error && run.error.code === 'ENOENT') continue
  process.exit(run.status ?? 1)
}
console.error('Python 3 was not found. Install it, then: pip install pillow numpy')
process.exit(1)
