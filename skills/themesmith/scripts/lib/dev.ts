// The local preview: every profile `dev` command, started in the background together. State lives in
// .themesmith/dev.json so later scripts can stop or restart the preview (a save rebuilds the files the dev
// servers serve, so they must restart afterwards).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRunning, shellArgs, startDetached, stopDetached } from './exec.ts'
import type { Profile } from './profile.ts'
import { SKILL_DIR, shellQuote } from './run.ts'
import { splitByDownloaded } from './submodules.ts'

type DevProcess = { pid: number; cwd: string; run: string; log: string }
export type Preview = {
  preview: string
  // Links Shopify's `theme dev` prints: one anyone can open, and the theme editor.
  share: string | null
  editor: string | null
  // An existing page, product and collection: a new template shows on any of them with ?view=<template suffix>.
  samples: { page: string | null; product: string | null; collection: string | null }
}
type DevState = { processes: DevProcess[] } & Partial<Preview>

const stateFile = (root: string) => join(root, '.themesmith', 'dev.json')

function readState(root: string): DevState | null {
  const path = stateFile(root)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as DevState) : null
}

export function devRunning(root: string): boolean {
  return readState(root)?.processes.some((p) => isRunning(p.pid)) ?? false
}

export function stopDev(root: string): number {
  const state = readState(root)
  if (!state) return 0
  for (const p of state.processes) stopDetached(p.pid)
  rmSync(stateFile(root), { force: true })
  return state.processes.length
}

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
const read = (path: string) => (existsSync(path) ? strip(readFileSync(path, 'utf8')) : '')

export type DevResult = { ok: true; preview: Preview } | { ok: false; message: string; verifyUrl?: string; log?: string }

export async function startDev(root: string, profile: Profile, timeoutMs = 180_000): Promise<DevResult> {
  stopDev(root)
  const { runnable } = splitByDownloaded(root, profile.dev)
  if (runnable.length === 0) return { ok: false, message: 'The profile has no dev commands that can run here.' }
  const vars: Record<string, string> = { skill: shellQuote(SKILL_DIR), store: profile.store }
  const processes = runnable.map((command, i) => {
    const run = command.run.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match)
    const log = join(root, '.themesmith', 'dev', `${i}.log`)
    rmSync(log, { force: true })
    return { pid: startDetached(shellArgs(run), { cwd: join(root, command.cwd), log }), cwd: command.cwd, run, log }
  })
  mkdirSync(join(root, '.themesmith'), { recursive: true })
  writeFileSync(stateFile(root), `${JSON.stringify({ processes }, null, 2)}\n`)

  const theme = processes.find((p) => /theme\s+dev/.test(p.run)) ?? processes[0]
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const log = read(theme.log)
    const local = log.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/)?.[0]
    if (local) {
      const preview: Preview = {
        preview: local,
        share: log.match(/https:\/\/\S+preview_theme_id=\d+/)?.[0] ?? null,
        editor: log.match(/https:\/\/\S+\/editor\b\S*/)?.[0]?.replace(/[)\].,]+$/, '') ?? null,
        samples: await samplePages(local),
      }
      writeFileSync(stateFile(root), `${JSON.stringify({ processes, ...preview }, null, 2)}\n`)
      return { ok: true, preview }
    }
    const verifyUrl = /verify your identity/i.test(log) ? log.match(/https:\/\/\S+/)?.[0] : undefined
    const stopped = processes.find((p) => !isRunning(p.pid))
    if (verifyUrl || stopped) {
      stopDev(root)
      const failed = stopped ?? theme
      return {
        ok: false,
        message: verifyUrl ? 'Shopify needs to confirm who you are before the preview can start.' : `\`${failed.run}\` stopped.`,
        ...(verifyUrl ? { verifyUrl } : {}),
        log: read(failed.log).trim().split('\n').slice(-15).join('\n'),
      }
    }
    await Bun.sleep(500)
  }
  stopDev(root)
  return { ok: false, message: 'The preview did not start within 3 minutes.', log: read(theme.log).trim().split('\n').slice(-15).join('\n') }
}

async function samplePages(base: string): Promise<Preview['samples']> {
  try {
    const html = await (await fetch(base, { signal: AbortSignal.timeout(20_000) })).text()
    const first = (kind: string) => html.match(new RegExp(`href="(/${kind}/[a-z0-9][a-z0-9-]*)"`))?.[1] ?? null
    return { page: first('pages'), product: first('products'), collection: first('collections') }
  } catch {
    return { page: null, product: null, collection: null }
  }
}
