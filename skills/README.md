# Agent Skills

A unified collection of 30 agent skills following the [agentskills.io](https://agentskills.io) specification. Each skill enforces disciplined practices — planning, testing, verification, or specialized workflows.

Each skill is a directory containing a `SKILL.md` file (with YAML frontmatter) plus optional supporting files (prompts, references, scripts, tests).

## Superpowers (Core Engineering Skills)

| Skill | Description |
|-------|-------------|
| **brainstorming** | Turn ideas into designs through collaborative dialogue. Mandatory design/approval gate before implementation. |
| **dispatching-parallel-agents** | Dispatch independent agents for parallel investigation of unrelated problems. |
| **executing-plans** | Load and execute a written implementation plan in a separate session with review checkpoints. |
| **finishing-a-development-branch** | Guide branch completion: verify tests, detect environment, present merge/PR/keep/discard options. |
| **receiving-code-review** | Handle code review feedback with technical rigor — verify before implementing, no performative agreement. |
| **requesting-code-review** | Dispatch code reviewer subagents at key checkpoints (after tasks, before merge). |
| **subagent-driven-development** | Execute plans by dispatching a fresh subagent per task, with two-stage review. |
| **systematic-debugging** | 4-phase debugging: Root Cause Investigation, Pattern Analysis, Hypothesis Testing, Implementation. |
| **test-driven-development** | Strict TDD: Red-Green-Refactor cycle, iron law of "no code without failing test first". |
| **using-git-worktrees** | Detect existing isolation, prefer native worktree tools, fall back to git worktree. |
| **using-superpowers** | Meta-skill: how to discover and invoke skills, instruction priority, rationalization prevention. |
| **verification-before-completion** | "No completion claims without fresh verification evidence" — run command, read output, then claim. |
| **writing-plans** | Write comprehensive implementation plans for engineers with zero codebase context. |
| **writing-skills** | Meta-skill: how to create new skills using TDD (RED-GREEN-REFACTOR for documentation). |

## Project & Domain Skills

| Skill | Description |
|-------|-------------|
| **design-audit** | Full-site UI/UX audit playbook for Transhipping Desk: boot real app, screenshot every page, audit, prioritize P0-P3, apply safe fixes. |
| **import-parser** | Add or change CSV, XLSX, EDI, EDIFACT, fixed-width, Baplie, vehicle, container, customer, CE Mercante, Granito, or Vazios import behavior. |
| **invoice-pdf** | Add or change printable local-charge or Demurrage invoice documents, browser print behavior, layout, fiscal formatting, PIX QR rendering. |
| **react-query-pattern** | Add or change Supabase data access, TanStack React Query hooks, cache keys, invalidation, mutations, reusable remote state. |
| **supabase-migration** | Create or review Supabase migrations involving tables, columns, indexes, constraints, foreign keys, RLS, grants, views, functions, triggers, RPCs. |

## Design & UX Skills

| Skill | Description |
|-------|-------------|
| **frontend-design** | Create distinctive, production-grade frontend interfaces with high design quality. Avoids generic AI aesthetics. |
| **ui-ux-pro-max** | UI/UX design intelligence: 50+ styles, 161 color palettes, 57 font pairings, 99 UX guidelines, 25 chart types across 10 stacks. |

## Code Quality & Review Skills

| Skill | Description |
|-------|-------------|
| **autoreview** | Auto Review closeout. Codex review is the default engine. Run structured review as a closeout check. |
| **security-audit-penetration-testing** | Complete security audit framework with 6 phases: discovery, resources, audit, plan, testing, reporting. |
| **thermo-nuclear-code-quality-review** | Extremely strict maintainability review for abstraction quality, giant files (1k-line threshold), and spaghetti-condition growth. Biased toward ambitious "code judo" restructuring. |

## Codebase Audit & Planning Skills

| Skill | Description |
|-------|-------------|
| **improve** | Read-only senior-advisor audit of any codebase (bugs, security, perf, tests, tech debt, deps, DX, docs, direction) that produces self-contained implementation plans for other models/agents to execute. Never edits source code itself. |

## Workflow & Communication Skills

| Skill | Description |
|-------|-------------|
| **caveman** | Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler while keeping technical accuracy. |
| **grill-me** | Interview the user relentlessly about a plan or design until reaching shared understanding. |
| **grill-me-with-docs** | Grilling session that challenges plans against existing domain model, sharpens terminology, updates docs inline. |
| **handoff** | Compact the current conversation into a handoff document for another agent to pick up. |
| **wayfinder** | Plan a huge chunk of work as a shared map of investigation tickets on the issue tracker, resolved one at a time until the way to the goal is clear. |

## Structure

```
skills/
├── README.md
├── autoreview/
│   └── SKILL.md
├── brainstorming/
│   ├── SKILL.md
│   ├── visual-companion.md
│   ├── spec-document-reviewer-prompt.md
│   └── scripts/
├── caveman/
│   └── SKILL.md
├── design-audit/
│   └── SKILL.md
├── dispatching-parallel-agents/
│   └── SKILL.md
├── executing-plans/
│   └── SKILL.md
├── finishing-a-development-branch/
│   └── SKILL.md
├── frontend-design/
│   ├── SKILL.md
│   └── LICENSE.txt
├── grill-me/
│   └── SKILL.md
├── grill-me-with-docs/
│   └── SKILL.md
├── handoff/
│   └── SKILL.md
├── import-parser/
│   └── SKILL.md
├── improve/
│   ├── SKILL.md
│   └── references/
│       ├── audit-playbook.md
│       ├── plan-template.md
│       └── closing-the-loop.md
├── invoice-pdf/
│   └── SKILL.md
├── react-query-pattern/
│   └── SKILL.md
├── receiving-code-review/
│   └── SKILL.md
├── requesting-code-review/
│   ├── SKILL.md
│   └── code-reviewer.md
├── security-audit-penetration-testing/
│   └── SKILL.md
├── subagent-driven-development/
│   ├── SKILL.md
│   ├── implementer-prompt.md
│   ├── spec-reviewer-prompt.md
│   └── code-quality-reviewer-prompt.md
├── supabase-migration/
│   └── SKILL.md
├── systematic-debugging/
│   ├── SKILL.md
│   ├── root-cause-tracing.md
│   ├── defense-in-depth.md
│   ├── condition-based-waiting.md
│   ├── condition-based-waiting-example.ts
│   ├── find-polluter.sh
│   └── test-*.md
├── test-driven-development/
│   ├── SKILL.md
│   └── testing-anti-patterns.md
├── thermo-nuclear-code-quality-review/
│   └── SKILL.md
├── ui-ux-pro-max/
│   └── SKILL.md
├── using-git-worktrees/
│   └── SKILL.md
├── using-superpowers/
│   ├── SKILL.md
│   └── references/
├── verification-before-completion/
│   └── SKILL.md
├── wayfinder/
│   └── SKILL.md
├── writing-plans/
│   ├── SKILL.md
│   └── plan-document-reviewer-prompt.md
└── writing-skills/
    ├── SKILL.md
    ├── anthropic-best-practices.md
    ├── persuasion-principles.md
    └── examples/
```

## Usage

This directory is the **single source of truth**. Both harnesses discover the
skills at session start from their user-level skill dirs, populated from here by
`scripts/skills/install-skills.mjs` (one Node script, same on Windows/macOS/Linux):

| Harness | Installed into | Triggered by |
|---------|----------------|--------------|
| Claude Code | `~/.claude/skills/` | `.claude/hooks/session-start.sh` (cloud + local) |
| Codex | `~/.codex/skills/` | your Codex worktree **Script de configuração** (cloud + local) |

To add or edit a skill, change it here only — never hand-maintain copies in
`~/.claude/skills`, `~/.codex/skills`, or ZIP bundles.

### Claude Code

Nothing to do: the `SessionStart` hook runs the installer, provisioning both
`~/.claude/skills/` and `~/.codex/skills/` in every cloud and local session.

### Codex

Codex does not run the Claude hook, so add one line to your Codex environment's
worktree setup script (all OS tabs — Node is cross-platform):

```bash
node scripts/skills/install-skills.mjs
```

Codex then discovers every skill from `~/.codex/skills/` at session start.

### With OpenCode

Skills follow the agentskills.io spec. Each `SKILL.md` has YAML frontmatter with
`name` and `description` fields that define when the skill should be invoked.

### With Other Harnesses

The `using-superpowers/references/` directory contains tool name mappings for:
- **Gemini CLI** — `gemini-tools.md`
- **Copilot CLI** — `copilot-tools.md`
- **Codex** — `codex-tools.md`

## License

Superpowers skills: see original source for licensing terms.
Frontend Design: see `frontend-design/LICENSE.txt`.
Improve: MIT — see `improve/SKILL.md` frontmatter (author: shadcn, source: https://github.com/shadcn/improve).
