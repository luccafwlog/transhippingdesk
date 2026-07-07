# Plan 006: Consertar os links quebrados que fazem `docs:check` falhar na main

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **EXECUTE ESTE PLANO ANTES DE TODOS OS OUTROS**: enquanto `docs:check`
> falha, o gate de CI de qualquer PR fica vermelho e as verificações dos
> planos 001–005 (que exigem `npm run docs:check` → exit 0) não fecham.
>
> **Drift check (rode primeiro)**: `npm run docs:check` — se já sair com 0,
> este plano foi resolvido por outra via; marque REJECTED no índice e pare.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW (só caminhos relativos em Markdown de arquivo histórico)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

O commit `86cb5ac` ("docs: move 3 executed plans to archive") moveu planos de
`docs/plans/` para `docs/archive/plans/` sem reescrever os links relativos
dentro e para esses arquivos. Resultado: `npm run docs:check` sai com exit 1
na main — e esse comando é o primeiro passo do job de CI, então TODO PR novo
falha por uma causa pré-existente. Cinco links em quatro arquivos.

## Estado atual

Saída atual de `npm run docs:check` (exit 1):

```text
- docs/archive/plans/2026-07-06-code-quality-audit-remediation.md: broken relative link: ../archive/code-quality-audit-2026-07-06.md
- docs/archive/plans/2026-07-06-design-audit-remediation.md: broken relative link: ../design-audit/2026-07-06-auditoria.md
- docs/archive/plans/2026-07-06-design-audit-remediation.md: broken relative link: ../design-audit/2026-07-06-auditoria.md
- docs/design-audit/2026-07-06-auditoria.md: broken relative link: ../plans/2026-07-06-design-audit-remediation.md
- docs/design-audit/README.md: broken relative link: ../plans/2026-07-06-design-audit-remediation.md
```

Os alvos existem; apenas os caminhos ficaram errados após a movimentação:

- `docs/archive/code-quality-audit-2026-07-06.md` — existe.
- `docs/design-audit/2026-07-06-auditoria.md` — existe.
- `docs/archive/plans/2026-07-06-design-audit-remediation.md` — existe.

Convenção do repo: documentos históricos são preservados (não reescrever
conteúdo), mas links vivos devem funcionar — corrigir o caminho preserva o
registro histórico.

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Gate | `npm run docs:check` | exit 0, sem "broken relative link" |

## Escopo

**Em escopo** (únicos arquivos a modificar):
- `docs/archive/plans/2026-07-06-code-quality-audit-remediation.md`
- `docs/archive/plans/2026-07-06-design-audit-remediation.md`
- `docs/design-audit/2026-07-06-auditoria.md`
- `docs/design-audit/README.md`
- `plans/README.md` (status)

**Fora de escopo** (NÃO tocar):
- Qualquer outro conteúdo desses arquivos além dos caminhos dos 5 links.
- `scripts/check-docs.mjs`.

## Git workflow

- Branch designada pelo operador; commit ex.:
  `docs: corrige links relativos quebrados pela movimentação para archive`.
- Não faça push nem abra PR a menos que o operador instrua.

## Passos

### Passo 1: Corrigir os 5 caminhos (substituições exatas)

1. Em `docs/archive/plans/2026-07-06-code-quality-audit-remediation.md`
   (linhas ~5 e ~26): `../archive/code-quality-audit-2026-07-06.md` →
   `../code-quality-audit-2026-07-06.md` (2 ocorrências).
2. Em `docs/archive/plans/2026-07-06-design-audit-remediation.md`
   (linhas ~5 e ~35): `../design-audit/2026-07-06-auditoria.md` →
   `../../design-audit/2026-07-06-auditoria.md` (2 ocorrências).
3. Em `docs/design-audit/2026-07-06-auditoria.md` (linha ~23) e
   `docs/design-audit/README.md` (linha ~129):
   `../plans/2026-07-06-design-audit-remediation.md` →
   `../archive/plans/2026-07-06-design-audit-remediation.md`
   (1 ocorrência em cada).

**Verify**: `npm run docs:check` → exit 0, nenhuma linha
"broken relative link".

> **Nota de execução (2026-07-07)**: o verificador reporta em camadas — após
> corrigir os 5 links acima, apareceram mais 3 do mesmo commit `86cb5ac`,
> também corrigidos: `docs/archive/code-quality-audit-2026-07-06.md`
> (`../plans/…` → `plans/…`) e
> `docs/archive/plans/2026-07-01-bl-import-workflow-adjustments.md`
> (`../adr/0017…`/`../adr/0018…` → `../../adr/…`). Total: 8 links em 6
> arquivos.
>
> **Nota de execução 2 (2026-07-07, mais tarde)**: a main quebrou o gate de
> novo (`fdb0f2a` moveu `docs/design-audit/` para o archive apagando ~30
> screenshots — 35 links quebrados). Com aprovação do mantenedor, a correção
> passou a ser sistêmica: `docs/archive/` agora é isento no
> `scripts/check-docs.mjs` (snapshots históricos não são verdade atual,
> CLAUDE.md) e os 3 cross-links restantes foram re-apontados. Arquivamentos
> futuros não quebram mais o gate.

## Plano de testes

Sem testes de código; o gate é `docs:check` e o CI do PR.

## Critérios de conclusão

- [ ] `npm run docs:check` sai com 0
- [ ] `git diff --stat` mostra somente os 4 arquivos de docs (+ índice de
  planos) com mudanças de poucas linhas
- [ ] Linha do plano 006 atualizada em `plans/README.md`

## Condições de STOP

- `docs:check` acusar OUTROS links quebrados além dos 5 listados — o repo
  divergiu; reporte a lista nova antes de expandir o escopo.
- Algum arquivo-alvo não existir mais no caminho indicado em "Estado atual".

## Notas de manutenção

- Movimentações futuras de docs devem rodar `npm run docs:check` antes do
  commit (o hook/CI pega, mas só depois do push).
