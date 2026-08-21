# Agent Skills

A unified collection of 50 agent skills following the [agentskills.io](https://agentskills.io) specification. Each skill enforces disciplined practices — planning, testing, verification, or specialized workflows.

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

These are vendored from https://github.com/mattpocock/skills/tree/release/v1.2. Local folder names occasionally differ from the upstream slug (noted below) to avoid clashing with a pre-existing local name; content otherwise tracks upstream. `mattpocock/skills`'s own `code-review` skill was **intentionally not vendored** — it shares its name with this project's built-in `/code-review` skill, and vendoring it would shadow that built-in.

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

Note: `tdd` overlaps in purpose with the Superpowers `test-driven-development` skill below — both are vendored under their upstream names; which one triggers depends on your phrasing. `wayfinder`'s Research ticket type invokes `/research` (above); its Prototype ticket type invokes `/prototype` (above).

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
| **eli5** *(Third-party)* | Explain any topic, code, concept, or error tailored to a specific audience's level of understanding (age, education level, job role, or relationship). |

## Structure

```
skills/
├── README.md
├── ask-matt/
│   └── SKILL.md
├── autoreview/
│   └── SKILL.md
├── brainstorming/
│   ├── SKILL.md
│   ├── visual-companion.md
│   ├── spec-document-reviewer-prompt.md
│   └── scripts/
├── caveman/
│   └── SKILL.md
├── codebase-design/
│   ├── SKILL.md
│   ├── DEEPENING.md
│   └── DESIGN-IT-TWICE.md
├── design-audit/
│   └── SKILL.md
├── diagnosing-bugs/
│   ├── SKILL.md
│   └── scripts/
│       └── hitl-loop.template.sh
├── dispatching-parallel-agents/
│   └── SKILL.md
├── domain-modeling/
│   ├── SKILL.md
│   ├── ADR-FORMAT.md
│   └── CONTEXT-FORMAT.md
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
├── grilling/
│   └── SKILL.md
├── handoff/
│   └── SKILL.md
├── implement/
│   └── SKILL.md
├── import-parser/
│   └── SKILL.md
├── improve/
│   ├── SKILL.md
│   └── references/
│       ├── audit-playbook.md
│       ├── plan-template.md
│       └── closing-the-loop.md
├── improve-codebase-architecture/
│   ├── SKILL.md
│   └── HTML-REPORT.md
├── invoice-pdf/
│   └── SKILL.md
├── loop-me/
│   └── SKILL.md
├── make-interfaces-feel-better/
│   └── SKILL.md
├── prototype/
│   ├── SKILL.md
│   ├── LOGIC.md
│   └── UI.md
├── react-query-pattern/
│   └── SKILL.md
├── receiving-code-review/
│   └── SKILL.md
├── requesting-code-review/
│   ├── SKILL.md
│   └── code-reviewer.md
├── research/
│   └── SKILL.md
├── resolving-merge-conflicts/
│   └── SKILL.md
├── security-audit-penetration-testing/
│   └── SKILL.md
├── setup-matt-pocock-skills/
│   ├── SKILL.md
│   ├── domain.md
│   ├── issue-tracker-github.md
│   ├── issue-tracker-gitlab.md
│   ├── issue-tracker-local.md
│   └── triage-labels.md
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
├── tdd/
│   ├── SKILL.md
│   ├── mocking.md
│   └── tests.md
├── test-driven-development/
│   ├── SKILL.md
│   └── testing-anti-patterns.md
├── thermo-nuclear-code-quality-review/
│   └── SKILL.md
├── to-spec/
│   └── SKILL.md
├── to-tickets/
│   └── SKILL.md
├── triage/
│   ├── SKILL.md
│   ├── AGENT-BRIEF.md
│   └── OUT-OF-SCOPE.md
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

Codex then discovers every skill from `~/.codex/skills/` at session start.
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
