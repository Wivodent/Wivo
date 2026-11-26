import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { externalAllowed, isAppUrl } from './navigation'

describe('what may be handed to the operating system (2.2.5, A2)', () => {
  it('https, mailto and tel only', () => {
    for (const u of ['https://wivodent.com', 'mailto:help@wivodent.com', 'tel:+3725551234']) expect(externalAllowed(u), u).toBe(true)
    for (const u of ['http://example.com', 'file:///C:/Windows/System32/calc.exe', 'smb://host/share', 'ms-msdt:/id', 'javascript:alert(1)', 'otpauth://totp/x', 'not a url', ''])
      expect(externalAllowed(u), u).toBe(false)
  })
})

describe('the window stays on Wivo (A3)', () => {
  it('development: the dev server\'s origin, any path', () => {
    expect(isAppUrl('http://localhost:5173/#/jobs', 'http://localhost:5173/')).toBe(true)
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(isAppUrl('https://evil.example/', 'http://localhost:5173/')).toBe(false)
  })

  it('packaged: the renderer\'s own file, nothing else on the disk', () => {
    const app = 'file:///C:/Program%20Files/Wivo/resources/app.asar/out/renderer/index.html'
    expect(isAppUrl(`${app}#/settings`, app)).toBe(true)
    expect(isAppUrl('file:///C:/Users/x/evil.html', app)).toBe(false)
    expect(isAppUrl('https://wivodent.com', app)).toBe(false)
  })
})

describe('the preload gives the page window.wivo only (A1)', () => {
  it('no window.electron: not process.env, not every IPC channel', () => {
    // The code, without its comments (one of them tells this story).
    const preload = readFileSync(join(__dirname, '..', 'preload', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(preload).not.toMatch(/exposeInMainWorld\(\s*['"]electron['"]/)
    expect(preload).not.toMatch(/from '@electron-toolkit\/preload'/)
    expect(preload).not.toMatch(/process\.env/)
  })
})
