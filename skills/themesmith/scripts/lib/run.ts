// The steps every push shares, in GitHub and CLI mode: format, build, dev-mode check, theme checks.
// A script records each step and stops at the first failure, printing JSON that names it. Commands of the same
// kind (two builds, say) run at the same time.
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { sh } from './exec.ts'
import { globMatch, type Command, type Profile } from './profile.ts'

export type Step = { step: string; ok: boolean; detail?: string }

// This skill's folder, wherever it is installed: profile commands write it as {skill}.
export const SKILL_DIR = resolve(import.meta.dir, '../..')

export const FORMATTABLE = /\.(liquid|json|js|ts|tsx|jsx|css|scss|md)$/

export class Run {
  readonly steps: Step[] = []
  constructor(readonly root: string) {}

  ok(step: string, detail?: string) {
    this.steps.push({ step, ok: true, detail })
  }

  finish(extra: Record<string, unknown> = {}): never {
    const ok = this.steps.every((s) => s.ok)
    console.log(JSON.stringify({ ok, ...extra, steps: this.steps }, null, 2))
    process.exit(ok ? 0 : 1)
  }

  fail(step: string, detail: string, extra: Record<string, unknown> = {}): never {
    this.steps.push({ step, ok: false, detail })
    this.finish(extra)
  }

  // Runs commands together and records a step for each, in order; stops at the first that failed.
  async commands(step: string, commands: Command[], vars: (command: Command) => Record<string, string>) {
    const results = await Promise.all(
      commands.map(async (command) => {
        const all: Record<string, string> = { skill: shellQuote(SKILL_DIR), ...vars(command) }
        const cmd = command.run.replace(/\{(\w+)\}/g, (match, key) => all[key] ?? match)
        return { cmd, r: await sh(cmd, { cwd: join(this.root, command.cwd) }) }
      })
    )
    for (const { cmd, r } of results) {
      if (!r.ok) this.fail(step, `\`${cmd}\` failed:\n${r.out.split('\n').slice(-30).join('\n')}`)
      this.ok(step, cmd)
    }
  }

  devModeLeftovers(profile: Profile): string[] {
    return profile.devModeMarkers
      .filter((m) => existsSync(join(this.root, m.file)) && readFileSync(join(this.root, m.file), 'utf8').includes(m.contains))
      .map((m) => `${m.file} still contains "${m.contains}"`)
  }

  // `changed` are root-relative paths. Files the build writes are neither formatted nor checked.
  async prepare(profile: Profile, changed: string[]) {
    const own = changed.filter((f) => !profile.generated.some((g) => globMatch(g, f)))
    const files = own.filter((f) => FORMATTABLE.test(f))
    const filesFor = (command: Command) => files.map((f) => shellQuote(relative(join(this.root, command.cwd), join(this.root, f)))).join(' ')
    if (files.length > 0) await this.commands('format', profile.format, (c) => ({ store: profile.store, files: filesFor(c) }))
    await this.commands('build', profile.build, () => ({ store: profile.store }))
    const leftovers = this.devModeLeftovers(profile)
    if (leftovers.length > 0) {
      this.fail('dev mode check', `The build left dev-mode files behind, so pushing would break the preview theme: ${leftovers.join('; ')}. Stop any running dev server and try again.`)
    }
    this.ok('dev mode check')
    await this.commands('checks', profile.checks, (c) => ({ store: profile.store, files: filesFor(c) }))
  }
}

export function shellQuote(path: string): string {
  return `"${path.replace(/(["\\$`])/g, '\\$1')}"`
}

export function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}
