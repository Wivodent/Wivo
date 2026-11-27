import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { buildCommit } from './scripts/build-commit.mjs'

// The short commit, as a VITE_ variable the renderer reads like any other (lib/buildInfo): for the
// version line only. Not a define: the dev and release builds define nothing under import.meta.env
// (config/testCopyEnv.test.ts).
process.env.VITE_APP_COMMIT = buildCommit()
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { testCopyDefine } from './config/testCopyEnv'
import { testFakeDefine } from './config/testFakeEnv'
import { desktopCsp } from './config/csp'

/**
 * The desktop window's Content-Security-Policy (config/csp.ts), as a meta tag
 * in index.html. Packaged builds only: the dev server's React refresh is an
 * inline script, and `npm run dev` would stop. updater.html has its own.
 */
function desktopCspPlugin(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ['MAIN_VITE_', 'VITE_']), ...process.env }
  const csp = desktopCsp({ apiUrl: env.MAIN_VITE_WIVO_API })
  return {
    name: 'wivo-desktop-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!ctx.filename.split('\\').join('/').endsWith('/index.html')) return html
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    },
  }
}

// Read the version straight off package.json rather than
// process.env.npm_package_version, which is only set when the build runs
// through an npm script and is undefined under a direct `electron-vite dev`.
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: ({ mode }) => ({
    // Test mode (`npm run dev:test`) takes the test copy's URL and anon key
    // from config/test-copy.env and loads no .env file: production's .env,
    // or a leftover .env.test, cannot fill a gap (config/testCopyEnv.ts).
    envDir: mode === 'test' ? resolve('config') : undefined,
    // TWO entries. `updater.html` is the splash shown while the app is being
    // replaced on disk — see its own comment for why it is not a route in the
    // main bundle. After changing this, confirm `out/renderer/updater.html`
    // actually exists; a splash that 404s is a frozen white box at the one
    // moment it must not be.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          updater: resolve('src/renderer/updater.html')
        }
      }
    },
    // Lets the renderer show the app version (sidebar footer) in both dev and
    // a packaged build — nothing else exposes it to the UI.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // `npm run dev:fake`: test mode against one's own project of fake data
      // (config/testFakeEnv.ts, docs/TEST-PROJECT.md) instead of the test copy.
      ...(mode === 'test' ? (process.env['WIVO_TEST_TARGET'] === 'fake' ? testFakeDefine() : testCopyDefine()) : {})
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        // Dependency-free code the web portal will also import — see
        // shared/README.md. A source alias rather than a workspace package on
        // purpose: externalizeDepsPlugin() above would mark a package external
        // and electron-builder ships out/**/* with no node_modules.
        // For the same reason, main and preload must never import from here.
        '@shared': resolve('shared')
      }
    },
    plugins: [react(), desktopCspPlugin(mode)],
    css: {
      postcss: resolve('postcss.config.cjs')
    }
  })
})
