#!/usr/bin/env node
// Install every committed skill (skills/<name>/SKILL.md) into the user-level
// skill directories of both harnesses, so they are discovered at session start
// in every environment:
//   - Claude Code: ~/.claude/skills/   (called from .claude/hooks/session-start.sh)
//   - Codex:       ~/.codex/skills/    (called from the Codex worktree setup script)
//
// skills/ is the single source of truth. Node (already required for npm install)
// runs identically on Windows/macOS/Linux, avoiding a bash-vs-PowerShell split.
//
// ponytail: skills removed from skills/ are not purged from the global dirs — a
// deleted skill leaves a stale copy until the user clears it. Upgrade path: track
// installed names in a manifest and prune the diff. Not worth it for a small set.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const source = path.join(root, 'skills')

const targets = [
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.codex', 'skills'),
]

const skills = fs
  .readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(source, name, 'SKILL.md')))

for (const target of targets) {
  fs.mkdirSync(target, { recursive: true })
  for (const name of skills) {
    const dest = path.join(target, name)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(source, name), dest, { recursive: true })
  }
  console.log(`Installed ${skills.length} skills into ${target}`)
}
