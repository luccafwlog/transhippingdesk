# Superpowers Skills

A collection of 14 agent skills following the [agentskills.io](https://agentskills.io) specification. These skills enforce disciplined engineering practices — planning before coding, testing before implementation, verification before completion.

Each skill is a directory containing a `SKILL.md` file (with YAML frontmatter) plus optional supporting files (prompts, references, scripts, tests).

## Skills

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

## Structure

```
skills/
├── brainstorming/
│   ├── SKILL.md
│   ├── visual-companion.md
│   ├── spec-document-reviewer-prompt.md
│   └── scripts/
├── dispatching-parallel-agents/
│   └── SKILL.md
├── executing-plans/
│   └── SKILL.md
├── finishing-a-development-branch/
│   └── SKILL.md
├── receiving-code-review/
│   └── SKILL.md
├── requesting-code-review/
│   ├── SKILL.md
│   └── code-reviewer.md
├── subagent-driven-development/
│   ├── SKILL.md
│   ├── implementer-prompt.md
│   ├── spec-reviewer-prompt.md
│   └── code-quality-reviewer-prompt.md
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
├── using-git-worktrees/
│   └── SKILL.md
├── using-superpowers/
│   ├── SKILL.md
│   └── references/
├── verification-before-completion/
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

### With Claude Code

Copy the skill directories to `~/.claude/skills/` or reference them from your project's `.claude/skills/` directory.

### With OpenCode

Skills follow the agentskills.io spec. Each `SKILL.md` has YAML frontmatter with `name` and `description` fields that define when the skill should be invoked.

### With Other Harnesses

The `using-superpowers/references/` directory contains tool name mappings for:
- **Gemini CLI** — `gemini-tools.md`
- **Copilot CLI** — `copilot-tools.md`
- **Codex** — `codex-tools.md`

## License

These skills are part of the Superpowers plugin. See the original source for licensing terms.
