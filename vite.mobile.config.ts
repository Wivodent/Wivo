/**
 * The phone app (Phase 1b): a PWA built from the SAME renderer code as the
 * desktop app — same components, same Supabase client, same i18n, same sound
 * files (public/) — with its own entry (src/renderer/mobile.html) and only the
 * screens the spec allows on a phone. Hosted on Cloudflare Pages:
 *
 *   npm run mobile:build   → dist-mobile/   (build command / output directory)
 *   npm run mobile:dev     → http://localhost:5174
 *
 * The files only the phone needs (manifest, service worker, Cloudflare's
 * _headers/_redirects, the icon) live in src/renderer/mobile-static/ and are
 * added here, so the desktop build does not carry them.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mobileCsp } from './config/csp'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }
const STATIC_DIR = resolve('src/renderer/mobile-static')
const ICON = resolve('src/renderer/src/assets/Wivo Logo.png')

const TYPES: Record<string, string> = {
  '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.png': 'image/png',
}

/** Serve (dev) and emit (build) the phone-only files; name the page index.html. */
/**
 * `_headers` carries this build's own policy (2.2.5, W1, W3): the CSP made for
 * the one Supabase project this phone app is built against
 * (VITE_SUPABASE_URL, set per Pages project), Report-Only at first, so a
 * wrong rule is reported in the browser's console instead of breaking the app.
 */
function headersFor(mode: string): (text: string) => string {
  const env = { ...loadEnv(mode, resolve('.'), 'VITE_'), ...process.env }
  if (!env.VITE_SUPABASE_URL) console.warn('[wivo-mobile] VITE_SUPABASE_URL is not set: the CSP allows any *.supabase.co')
  const csp = mobileCsp({ supabaseUrl: env.VITE_SUPABASE_URL, sentryDsn: env.VITE_SENTRY_DSN })
  return text => text.replace('%CSP_REPORT_ONLY%', csp)
}

function mobileStatic(mode: string): Plugin {
  const fill = headersFor(mode)
  const files = (): [string, Buffer][] => [
    ...readdirSync(STATIC_DIR).map(f => [f, readFileSync(join(STATIC_DIR, f))] as [string, Buffer]),
    ['icon-256.png', readFileSync(ICON)],
  ]
  return {
    name: 'wivo-mobile-static',
    enforce: 'post', // after Vite's own HTML step, so the page exists to rename
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = files().find(([name]) => req.url === `/${name}`)
        if (!hit) return next()
        res.setHeader('Content-Type', TYPES[hit[0].slice(hit[0].lastIndexOf('.'))] ?? 'text/plain')
        res.end(hit[1])
      })
    },
    generateBundle(_options, bundle) {
      for (const [name, source] of files()) {
        this.emitFile({ type: 'asset', fileName: name, source: name === '_headers' ? fill(source.toString('utf8')) : source })
      }
      const page = bundle['mobile.html']
      if (page) page.fileName = 'index.html'
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: resolve('src/renderer'),
  base: '/',
  envDir: resolve('.'),
  publicDir: resolve('src/renderer/public'),
  plugins: [react(), mobileStatic(mode)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      '@shared': resolve('shared'),
    },
  },
  css: { postcss: resolve('postcss.config.cjs') },
  build: {
    outDir: resolve('dist-mobile'),
    emptyOutDir: true,
    rollupOptions: { input: { mobile: resolve('src/renderer/mobile.html') } },
  },
  server: { port: 5174 },
}))
