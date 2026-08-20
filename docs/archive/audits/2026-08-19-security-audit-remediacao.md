# Validação da remediação da auditoria de segurança

Data: 2026-08-19
Escopo: achados SEC-001, SEC-002 e SEC-003 da auditoria do sistema inteiro.

## Correções aplicadas

- SEC-001: `npm audit fix --package-lock-only` atualizou o lockfile para
  `react-router@7.18.2`, `brace-expansion@5.0.9`, `nanoid@3.3.18`,
  `postcss@8.5.26` e `undici@7.29.0`.
- SEC-002: ativação de convite agora compensa usuário Auth e convite quando a
  conta ou a auditoria falham; suspensão/reactivação verifica escrita e
  auditoria e restaura a conta em falha de auditoria.
- SEC-003: ESLint passou a ignorar `.worktrees/**`, isolando o checkout auditado.
- Foi adicionado teste de contrato em
  `src/services/__tests__/portalSecurityRemediation.test.ts`.

## Validação

| Check | Resultado |
|---|---|
| Teste focado de remediação | Passou — 2/2 |
| `npm run docs:check` | Passou |
| `npm run typecheck` | Passou |
| `npm run lint` | Passou |
| `npm run build` | Passou |
| `npm audit` | Passou — 0 vulnerabilidades |
| `npm test` | 2.108 passaram; 7 falharam em alterações pré-existentes e não relacionadas |

As sete falhas preexistentes estão em `codAdjustmentsMigration.test.ts`,
`codRepricingMigration.test.ts` e `transshipments.test.ts`, correspondendo a
mudanças já presentes no worktree antes desta remediação. Não foram alteradas.

## Status

SEC-001, SEC-002 e SEC-003: **corrigidos e validados localmente**. A auditoria
completa permanece sem validação de runtime remoto, replay de migrations ou
teste contra staging/produção.
