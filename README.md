# themesmith

Agent skills for working on Shopify themes safely, for developers and for merchants who have never used Git or a terminal. They work with Claude Code, Codex, Cursor, and other agents that read Agent Skills.

| Skill | What it does |
| --- | --- |
| `themesmith` | Previews, saves, and publishes theme changes through branches and pull requests (GitHub-connected themes) or unpublished draft themes (Shopify CLI). It never pushes to `main` or the live theme without an explicit override, always builds first, never pushes a dev-mode build, and refuses to overwrite a theme someone edited in the Shopify admin. |
| `theme-code-review` | Reviews changed theme code against Shopify best practices. |

## Install

To install, give your AI agent (Claude Code, Codex, Cursor, …) this page's link and ask it to install themesmith. The steps below are written for the agent.

### For AI agents: installing themesmith

You are installing themesmith for the person you're helping, on this computer. Do every step yourself; tell them in one short line what you're doing and why ("Installing themesmith, the tool that keeps your Shopify store safe while we work on it."). One install covers every theme on this computer.

1. **Bun.** Run `bun --version`. If it fails, install it:
   - Mac or Linux: `curl -fsSL https://bun.sh/install | bash`, then use `~/.bun/bin/bun` until a new terminal opens.
   - Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`, then use `%USERPROFILE%\.bun\bin\bun.exe` until a new terminal opens.
2. **Get themesmith.** If `~/themesmith` doesn't exist, run `git clone https://github.com/Negative-Space-Dev/themesmith ~/themesmith`. If it exists, run `git -C ~/themesmith pull` instead. If Git isn't installed, install it first (Mac: `xcode-select --install`; Windows: `winget install --id Git.Git -e`; Linux: the system's package manager).
3. **Install.** Run `bun ~/themesmith/install.ts`. It links the skills into `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex, Cursor, and others), and installs their packages. For an agent that reads neither folder, add `--dir <that agent's skills folder>`. It prints JSON; `"ok": true` means done.
4. **Check.** `~/.claude/skills/themesmith/SKILL.md` or `~/.agents/skills/themesmith/SKILL.md` exists.
5. **Finish.** Agents only find new skills in a new session. Tell the person: "Themesmith is installed. Start a new session in your theme's folder and ask me to set the theme up, or just ask for the change you want."

Then, in the new session inside a theme folder, the themesmith skill takes over: it checks the computer and the theme, sets up anything missing (it asks first), and keeps itself up to date.

### Updating and removing

Themesmith offers new versions by itself when it runs, and updates when the person says yes. To update by hand: `git -C ~/themesmith pull && bun ~/themesmith/install.ts`. To remove the skills: `bun ~/themesmith/install.ts --uninstall`, then delete `~/themesmith`.

## Teammates

Setting a theme up writes rules into its `AGENTS.md` that every agent reads. When an agent opens the theme on a computer without themesmith, those rules tell it to install themesmith for the whole computer (the steps above) and then start a new session. One install per computer covers every theme on it, and one `git pull` updates them all.

## Develop

```bash
bun install
bun test
bun run typecheck
```

## Releasing

Themesmith's version is the `version` in `skills/themesmith/package.json`. To release, raise it in the pull request that should go out (`0.1.0` to `0.1.1` for a fix, `0.2.0` for a new feature) and merge to `main`. Within a few hours, the doctor on every computer offers the update, and installs it when the person says yes.

## License

MIT. See [LICENSE](LICENSE).
