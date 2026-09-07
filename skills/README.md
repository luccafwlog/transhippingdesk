# Agent Skills

A unified collection of 50 agent skills following the [agentskills.io](https://agentskills.io) specification. Skills provide task-specific guidance for planning, implementation and specialist workflows.

Each skill is a directory containing a `SKILL.md` file (with YAML frontmatter) plus optional supporting files (prompts, references, scripts, tests).

## Skill sources

Every skill below is tagged with where it comes from:

| Tag | Meaning |
|-----|---------|
| **mattpocock/skills** | Vendored from [github.com/mattpocock/skills](https://github.com/mattpocock/skills) at tag `release/v1.2`. See the dedicated section below. |
| **Superpowers** | Vendored from the [obra/superpowers](https://github.com/obra/superpowers) skill set. |
| **Project** | Authored for this repository (Transhipping Desk domain/workflow skills). |
| **Third-party** | Vendored from another named author/source (credited per skill). |

## Mattpocock Skills (mattpocock/skills @ release/v1.2)

These are vendored from https://github.com/mattpocock/skills/tree/release/v1.2. Local folder names occasionally differ from the upstream slug (noted below) to avoid clashing with a pre-existing local name; content is locally adapted; it is not an exact upstream mirror. `mattpocock/skills`'s own `code-review` skill was **intentionally not vendored** — it shares its name with this project's built-in `/code-review` skill, and vendoring it would shadow that built-in.

| Skill | Upstream path | Description |
|-------|----------------|-------------|
| **grilling** | `skills/productivity/grilling` | Shared interview engine: maps the decision as a design tree, asks each round's frontier of questions together with a recommended answer, dispatches sub-agents for facts. Invoked by grill-me, grill-me-with-docs, and other grilling-flavored skills. |
| **grill-me** | `skills/productivity/grill-me` | A relentless interview to sharpen a plan or design. Runs a `/grilling` session. |
| **grill-me-with-docs** | `skills/engineering/grill-with-docs` (renamed locally) | A relentless interview to sharpen a plan or design, which also creates docs (ADRs and glossary) as we go. Runs `/grilling` with `/domain-modeling`. |
| **domain-modeling** | `skills/engineering/domain-modeling` | Build and sharpen a project's domain model — challenge terms, invent edge-case scenarios, write CONTEXT.md and ADRs down as they crystallise. Invoked by grill-me-with-docs and other skills that maintain the domain model. |
| **handoff** | `skills/in-progress/claude-handoff` (renamed locally; upstream "in-progress" = experimental) | Hand the current conversation off to a fresh background agent (`claude --bg`) that picks up the work immediately. |
| **loop-me** | `skills/in-progress/loop-me` (upstream "in-progress" = experimental) | Grill me about specs for the workflows I want to build, within this workspace. |
| **wayfinder** | `skills/engineering/wayfinder` | Plan a huge chunk of work as a shared map of decision tickets on the issue tracker, resolved one at a time until the way to the goal is clear. |
| **ask-matt** | `skills/engineering/ask-matt` | Router over the mattpocock skill set — ask which skill or flow fits your situation. |
| **codebase-design** | `skills/engineering/codebase-design` | Shared vocabulary for designing deep modules: leverage, locality, testability, where a seam goes. |
| **diagnosing-bugs** | `skills/engineering/diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. |
| **implement** | `skills/engineering/implement` | Implement a piece of work based on a spec or set of tickets; uses `/tdd` at pre-agreed seams. |
| **improve-codebase-architecture** | `skills/engineering/improve-codebase-architecture` | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. |
| **prototype** | `skills/engineering/prototype` | Build a throwaway prototype to answer a design question — a state model, a UI look, a logic sanity check. |
| **research** | `skills/engineering/research` | Investigate a question against high-trust primary sources via a background agent, capture findings as a Markdown file. |
| **resolving-merge-conflicts** | `skills/engineering/resolving-merge-conflicts` | Resolve an in-progress git merge/rebase conflict by tracing each side's original intent. |
| **setup-matt-pocock-skills** | `skills/engineering/setup-matt-pocock-skills` | Configure a repo for the engineering skills — issue tracker, triage label vocabulary, domain doc layout. Run once before first use of the other engineering skills. |
| **tdd** | `skills/engineering/tdd` | Test-driven development reference: what a good test is, where tests go, anti-patterns, the rules of the red→green loop. |
| **to-spec** | `skills/engineering/to-spec` | Turn the current conversation into a spec and publish it to the project issue tracker — synthesis, not interview. |
| **to-tickets** | `skills/engineering/to-tickets` | Break a plan/spec/conversation into tracer-bullet tickets with blocking edges, published to the configured tracker. |
| **triage** | `skills/engineering/triage` | Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, write agent-ready briefs. |
| **wait-what** | `skills/productivity/wait-what` | Corrective for a message that didn't land — re-pitches the last message in ASD-STE100 Simplified Technical English using the `CONTEXT.md` vocabulary. |

`tdd` and `test-driven-development` are alternative references for test-first
work; use one appropriate to the request. Likewise choose between general
frontend design, focused polish and a full design audit rather than loading all.

## Local adaptation and discovery

The guidance is maintained for capable agents across models, following
[Eric Provencher's article on skills and prompts](https://x.com/pvncher/status/2095991462416490862).
Descriptions identify specific tasks; entrypoints retain constraints and route
to supporting material only when needed. `AGENTS.md` points to `CLAUDE.md`, whose
source map is contextual. Implementation requests continue through validation
without mandatory design, test-boundary or delivery menus.

Preserve concrete production, migration and file protections. Editing a skill
is not permission to change external services or global agent configuration.
Do not bulk-load this catalog or install additional overlapping skills merely
because they exist. Existing invocation metadata is preserved.

The `emil-design-eng` and `ui-ux-pro-max` entrypoints route to topic references.
The UI/UX copy has no upstream search script or database; its written guidance
is usable directly. Historical provenance below remains attached to each source.

See the [instruction audit](../docs/archive/audits/2026-09-06-instrucoes-agentes-skills.md)
for the changes, structural checks and remaining installation limits.

## Superpowers (Core Engineering Skills)

| Skill | Description |
|-------|-------------|
| **brainstorming** | Turn ideas into designs through collaborative dialogue. Resolve material choices without a mandatory gate for clear implementation requests. |
| **dispatching-parallel-agents** | Dispatch independent agents for parallel investigation of unrelated problems. |
| **executing-plans** | Execute an existing plan through validation and completion. |
| **finishing-a-development-branch** | Carry out the requested integration or cleanup and preserve workspace ownership. |
| **receiving-code-review** | Handle code review feedback with technical rigor — verify before implementing, no performative agreement. |
| **requesting-code-review** | Arrange a focused independent review when requested or warranted by risk. |
| **subagent-driven-development** | Coordinate authorized subagents with independent task ownership. |
| **systematic-debugging** | Trace the reported failure with reproducible evidence and focused probes. |
| **test-driven-development** | Test-first behavior and regression reproduction without deleting existing work. |
| **using-git-worktrees** | Detect existing isolation, prefer native worktree tools, fall back to git worktree. |
| **using-superpowers** | Help select relevant guidance when workflow choice is unclear. |
| **verification-before-completion** | Match completion claims to evidence; reuse results for unchanged code. |
| **writing-plans** | Write outcome-based plans for substantial coordination or handoff. |
| **writing-skills** | Maintain concise descriptions, scoped guidance and progressive references. |

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
| **ui-ux-pro-max** | Written UI/UX criteria, routed by accessibility, layout, flows and review. |

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
| **eli5** *(Third-party)* | Explain any topic, code, concept, or error tailored to a specific audience's level of understanding (age, education level, job role, or relationship). |

## Structure

Each `skills/<name>/SKILL.md` is the discovery entrypoint. Optional `references/`,
prompts and scripts are linked from the owning skill. Inspect that directory
when the selected task needs its supporting files.

## Usage

This directory is the **single source of truth**. Both harnesses discover the
skills at session start from their user-level skill dirs, populated from here by
`scripts/skills/install-skills.mjs` (one Node script, same on Windows/macOS/Linux):

| Harness | Installed into | Triggered by |
|---------|----------------|--------------|
| Claude Code | `~/.claude/skills/` | `.claude/hooks/session-start.sh` (cloud + local) |
| Codex | `~/.codex/skills/` | your Codex worktree **Script de configuração** (cloud + local) |
| OpenCode | `./skills/` via `opencode.json` | `/skill-name` in the prompt |

To add or edit a skill, change it here only — never hand-maintain copies in
`~/.claude/skills`, `~/.codex/skills`, or ZIP bundles.

Skills vendored from `mattpocock/skills` intentionally exclude that repo's own
`agents/*.yaml` metadata files (cross-harness routing config for the `skills.sh`
installer) — this project's own `install-skills.mjs` is the installer here, so
that metadata has no consumer.

### Claude Code

Nothing to do: the `SessionStart` hook runs the installer, provisioning both
`~/.claude/skills/` and `~/.codex/skills/` in every cloud and local session.

### Codex

Codex does not run the Claude hook, so add one line to your Codex environment's
worktree setup script (all OS tabs — Node is cross-platform):

```bash
node scripts/skills/install-skills.mjs
```

The installer replaces matching global skill directories for Claude Code,
Codex and Antigravity (`~/.gemini/config/skills/`). Run it deliberately when you
want to synchronize these copies; it is not needed to validate a repository edit.
Existing sessions keep their already loaded catalog. New Codex sessions discover
the installed skills from `~/.codex/skills/`. The installer does not manage
`~/.agents/skills/` or copies supplied by plugins; overlaps there need separate
user-level maintenance.
In Codex/T3, use `/skills` to open the skill picker; Codex does not expose each
skill as a separate `/skill-name` command in the main slash catalog.

### With OpenCode

Skills follow the agentskills.io spec. Each `SKILL.md` has YAML frontmatter with
`name` and `description` fields that define when the skill should be invoked.

### With Other Harnesses

The `using-superpowers/references/` directory contains tool name mappings for:
- **Gemini CLI** — `gemini-tools.md`
- **Copilot CLI** — `copilot-tools.md`
- **Codex** — `codex-tools.md`

## License

Mattpocock skills: see https://github.com/mattpocock/skills for licensing terms.
Superpowers skills: see original source for licensing terms.
Frontend Design: see `frontend-design/LICENSE.txt`.
Improve: MIT — see `improve/SKILL.md` frontmatter (author: shadcn, source: https://github.com/shadcn/improve).
