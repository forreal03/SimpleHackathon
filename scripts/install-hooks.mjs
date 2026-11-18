// Turns on the commit rules of docs/SPEC.md 18.5 for this clone: writes a small commit-msg and
// pre-push hook into the clone's git directory that run .githooks/<name>, and points core.hooksPath
// there. Only these two hooks are installed, so a branch that adds another file to .githooks
// (post-checkout, for example) cannot run it just by being checked out.
// Runs from `npm install` (the root "prepare" script); core.hooksPath gets an absolute path, so run
// `npm install` again after moving the clone. Outside a git checkout of this repository (an unpacked
// tarball, also one inside another repository), or without git, it does nothing.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = ['commit-msg', 'pre-push'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  // An empty prefix means root is the top of its own work tree, not a folder inside another repository.
  if (git('rev-parse', '--is-inside-work-tree') === 'true' && git('rev-parse', '--show-prefix') === '') {
    const dir = path.join(path.resolve(root, git('rev-parse', '--git-common-dir')), 'shk-hooks');
    mkdirSync(dir, { recursive: true });
    for (const name of HOOKS) {
      const file = path.join(dir, name);
      writeFileSync(file, `#!/bin/sh\n[ -f .githooks/${name} ] || exit 0\nexec sh .githooks/${name} "$@"\n`);
      chmodSync(file, 0o755);
    }
    git('config', 'core.hooksPath', dir.split(path.sep).join('/'));
  }
} catch {
  // not a git checkout (for example an unpacked tarball) or git is missing: nothing to set up
}
