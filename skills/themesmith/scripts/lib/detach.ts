// Windows only: runs a cmd.exe command line attached to this process, which startDetached (exec.ts) started
// detached. cmd.exe started detached itself writes nothing to its log; started from a detached Bun, it does.
//   bun detach.ts cmd.exe /d /s /c "<command>"
const child = Bun.spawn(process.argv.slice(2), { stdio: ['ignore', 'inherit', 'inherit'], windowsVerbatimArguments: true })
process.exit(await child.exited)

export {}
