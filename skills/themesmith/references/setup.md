# Setup

Setup runs from start to finish before any work on the person's request. Don't read, plan, or edit theme files for the request until step 4 says setup is complete, even for changes that look easy to undo. Follow "How to talk to the person" in SKILL.md in every message.

## 1. Bun

Every script runs with Bun. If `bun --version` fails, ask first:

> Bun isn't installed. It runs the tools that keep your store safe while we work. OK to install it?

After a yes, install it, then say `✅ Bun <version> installed`:

- Mac or Linux: `curl -fsSL https://bun.sh/install | bash`, then use `~/.bun/bin/bun` until a new terminal opens.
- Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`, then use `%USERPROFILE%\.bun\bin\bun.exe` until a new terminal opens.

## 2. Check, and ask once

```bash
bun <skill>/scripts/doctor.ts
```

It checks everything at the same time, in a few seconds, and changes nothing. Send one message, then wait for the answer:

> This theme needs a quick one-time setup before I [their request in a few words]. Here's what I found:
>
> [the `chart` from the doctor, as is]
>
> I'll save these settings for this theme:
> [the `confirm` list from the doctor, as is]
>
> OK to install what's missing and save these settings? Tell me if you want anything different.

That is the only question. Don't ask about branches or anything else the doctor already worked out: it protects the base branch (and any branch GitHub Actions uses as a base) without asking. Once Shopify sign-in works, it also finds the branch the live theme follows, if it isn't protected yet: `--fix` protects it. Leave out the settings part when the theme already has its profile, and ask about the store only when `confirm` does: it wasn't found, several stores match ("which one: …?"), or it is marked as a guess. Use your question tool if you have one, with two short options (go ahead, or change something). If they want something different, such as no GitHub CLI or a different store, note it for step 3. If they say no to everything, explain in one line what won't work, and stop.

## 3. Set everything up at once

```bash
bun <skill>/scripts/doctor.ts --fix [--store <x>.myshopify.com] [--skip <tool,...>]
```

Pass only what the person changed or added in step 2; everything else comes from the confirmed settings. `--skip` takes tool names from the chart's `tools` list (`gh`, `npm`, and so on) for installs they declined. Turning down the GitHub CLI (`gh`) is remembered for this theme: setup finishes without it, and you give the person a link to open each pull request on GitHub themselves. The other tools are needed. Before running it, say one line: "Setting up now. This takes a minute or two."

It installs and updates the tools in parallel, saves the profile, and sets up the theme's formatting and checking tools and its `AGENTS.md` rules. The rules tell any agent that opens the theme without the skill how to install it on that computer. Then, in the background, it starts the sign-ins and a full Theme Check of the theme. When it finishes, send one message:

> [its `chart`, as is]
>
> One last step: sign in so I can preview your theme.
> - **Shopify:** open [signIn.shopify.url] and confirm code **[code]**.
> - **GitHub:** open [signIn.github.url] and enter code **[code]**.
>
> Tell me when you're done.

Leave out a sign-in whose `status` is `ok`, and the whole sign-in part when both are. Anything in `needsYou` comes next, one plain line each: an install that needs their computer password (give them the command to run), or one they do themselves (give them the link).

## 4. Finish

When they say they've signed in (or right away, if there was nothing to sign in to):

```bash
bun <skill>/scripts/doctor.ts --wait
```

It waits for the sign-ins and the full Theme Check, then checks everything again. If `ready` is `true`, send:

> ✅ Setup is done. [themeCheck.summary in plain words, e.g. "Shopify's checker found no problems in your theme."] Now [their request in a few words].

If the full Theme Check found errors, say how many in one line. They were already in the theme before this work, and they don't block it. If anything else is still ✗, fix it with step 3 and run `--wait` again. If **Theme files at the top of this folder** is ✗, the theme lives in a subfolder (its `detail` names it): tell the person themesmith can't work on a theme set up that way yet, and stop.

Then start the request with its workflow. In GitHub mode, `start.ts` commits the setup files as the first commit of that work.

## Changing the settings later

The profile is `.agents/themesmith.json`: `store`, `mode` (`github` or `cli`), `protectedBranches` (globs allowed), and `dev`, `build`, `format`, and `checks` commands (each `{ "cwd", "run" }`; `{skill}`, `{store}`, and `{files}` are filled in when they run), plus `devModeMarkers` and `generated`. Edit it when the person asks, then run the doctor. Notes about this theme for other agents (sections to leave alone, naming habits) go in `.agents/themesmith.md`.

## Installing the skills elsewhere

You are reading this, so the skills are installed for this agent. When the person asks to set up another computer or another agent:

**For a whole computer (the usual way).** Every theme on the computer gets the skills, and one `git pull` updates them all. Clone the themesmith repository somewhere the person keeps code, then link the skills into the user skill folders. Claude Code reads `~/.claude/skills`. Codex, Cursor, and other agents read `~/.agents/skills`:

```bash
git clone https://github.com/Negative-Space-Dev/themesmith ~/themesmith
bun ~/themesmith/install.ts
bun ~/themesmith/install.ts --dir <that agent's user skills folder>   # an agent that reads neither folder
```

**Inside one theme instead (optional).** Only for a theme that must carry its own copy. Every update then has to be done in that theme, instead of one `git pull` for the whole computer. From the theme's root folder:

```bash
bun <skill>/scripts/update.ts install https://github.com/Negative-Space-Dev/themesmith
```

This copies every skill into `.agents/skills/` and records the version in `.agents/themesmith.lock.json`, which later updates merge from. Codex and Cursor read `.agents/skills/` directly. For Claude Code, or another agent that keeps skills in its own folder:

```bash
bun .agents/skills/themesmith/scripts/agents.ts add claude   # or --dir <that agent's skills folder>
```

It writes short pointer skills into the agent's folder rather than copies, so there is one version to edit.

Either way, an agent sees new skills only in a new session.
