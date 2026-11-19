import { spawnSync } from 'node:child_process'

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

// The branch work starts from and merges back into: the one origin/HEAD names, else main or master. Null when
// the repository has neither. A clone sets origin/HEAD; a repository that was pushed to GitHub from this folder
// has none until setup runs `git remote set-head origin --auto`.
export function defaultBranch(root: string): string | null {
  const head = git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '')
  if (head) return head
  const named = git(root, 'for-each-ref', '--format=%(refname:lstrip=-1)', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master')
  return named.split('\n').find(Boolean) ?? null
}
