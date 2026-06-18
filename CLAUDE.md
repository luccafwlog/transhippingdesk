# CLAUDE.md

Follow [`AGENTS.md`](./AGENTS.md) as the canonical behavioral and project
instruction file.

## Claude Code integration

- Project playbooks live in `.claude/skills/`.
- Hooks in `.claude/hooks/` guard destructive commands, protected files, and
  edited TypeScript linting.
- `src/types/database.ts`, `src/lib/pix.ts`, and existing migration files are
  protected; do not bypass the guard without explicit authorization.
- Read `docs/README.md` before broad documentation or architecture changes.
- Run `npm run docs:check` after changing Markdown, routes, ADRs, or playbooks.

The executable repository is authoritative when a historical document differs
from current behavior. Correct the living document and preserve the historical
record.
