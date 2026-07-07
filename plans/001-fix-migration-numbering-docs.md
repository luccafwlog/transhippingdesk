# Plan 001: Corrigir instrução stale de numeração de migrations nos docs vivos

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: `git diff --stat 86cb5ac..HEAD -- README.md WORKFLOW.md`
> Se algum arquivo em escopo mudou desde a escrita do plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; em caso de
> divergência, trate como condição de STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

`WORKFLOW.md` e `README.md` instruem, com números literais, que a última
migration é `159_` e a próxima é `160_`. A última migration real é
`168_overdue_invoice_alerts_ptbr_entity.sql` — `160_` a `168_` já existem e já
foram aplicadas. Um contribuidor (humano ou agente) que siga a instrução à
risca cria `160_...` colidindo com uma migration aplicada, quebrando o
invariante "ordem lexicográfica = ordem de aplicação" que esses mesmos
documentos existem para proteger (ADR 0016). A correção remove os literais e
ensina a derivar o número do repositório, para o documento nunca mais
envelhecer desta forma.

## Estado atual

Arquivos relevantes:

- `README.md` — visão geral do repo; cita o intervalo de migrations.
- `WORKFLOW.md` — guia de desenvolvimento; seção "Nome de arquivo novo" dita o
  próximo número.
- `docs/adr/0016-migrations-nomenclatura-numerada-sequencial.md` — a decisão
  que esses trechos refletem (não alterar).

Trecho de `README.md` (linha ~52):

```text
esquema de nome: numerado sequencial de três dígitos (`001_…` a `159_…`; ver
```

Trecho de `WORKFLOW.md` (linhas ~205–210):

```text
NNN_descricao_curta.sql
```

Use o próximo número sequencial disponível (o último é `159_`, então o próximo
é `160_`), com três dígitos e zero à esquerda. Em caso de branches paralelos,
reconcilie os números antes do merge para preservar a ordem lexicográfica = ordem
de aplicação.
```

Convenções do repo que se aplicam:

- Documentação segue `docs/CONVENCOES.md`; docs vivos são corrigidos no lugar,
  sem nota editorial para correção de fato stale (registro histórico fica no
  git).
- `npm run docs:check` (script `scripts/check-docs.mjs`) valida Markdown e deve
  passar após qualquer mudança em docs.
- Idioma dos docs: português.

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Checar docs | `npm run docs:check` | exit 0 |
| Última migration real | `ls supabase/migrations/ \| sort \| tail -1` | nome do arquivo de maior número |

## Escopo

**Em escopo** (únicos arquivos a modificar):
- `README.md`
- `WORKFLOW.md`

**Fora de escopo** (NÃO tocar, mesmo parecendo relacionado):
- `docs/adr/0016-migrations-nomenclatura-numerada-sequencial.md` — registro
  histórico da decisão; a decisão não muda.
- `supabase/migrations/**` — arquivos protegidos por hook; este plano não cria
  nem altera migrations.
- `scripts/check-docs.mjs` — não adicionar regra nova de verificação; a
  correção é remover os literais, não policiá-los.

## Git workflow

- Branch: siga a convenção observada `claude/<slug>` ou a branch designada
  pelo operador, se houver.
- Mensagem de commit no estilo do repo (exemplos do `git log`:
  `docs: move 3 executed plans to archive`): use prefixo `docs:`.
- Não faça push nem abra PR a menos que o operador instrua.

## Passos

### Passo 1: Remover o intervalo literal do README

Em `README.md`, localize a linha com `` (`001_…` a `159_…`; ver `` e
substitua o intervalo fechado por uma referência sem literal de fim, por
exemplo:

```text
esquema de nome: numerado sequencial de três dígitos (`001_…` em diante; ver
```

Mantenha o restante da frase e a referência existente intactos.

**Verify**: `grep -n "159_" README.md` → nenhuma ocorrência.

### Passo 2: Trocar o literal do WORKFLOW por instrução derivável

Em `WORKFLOW.md`, na seção "Nome de arquivo novo", substitua a frase
"(o último é `159_`, então o próximo é `160_`)" por uma instrução que derive o
número do repositório, preservando o restante do parágrafo. Forma alvo:

```text
Use o próximo número sequencial disponível — derive-o do repositório com
`ls supabase/migrations/ | sort | tail -1` e some 1 — com três dígitos e zero
à esquerda. Em caso de branches paralelos, reconcilie os números antes do
merge para preservar a ordem lexicográfica = ordem de aplicação.
```

**Verify**: `grep -n "o último é" WORKFLOW.md` → nenhuma ocorrência;
`grep -n "sort | tail -1" WORKFLOW.md` → 1+ ocorrência.

### Passo 3: Rodar o gate de documentação

**Verify**: `npm run docs:check` → exit 0.

## Plano de testes

Sem testes de código — mudança é somente Markdown. O gate é `docs:check`.

## Critérios de conclusão

- [ ] `grep -rn "159_" README.md WORKFLOW.md` retorna vazio
- [ ] `npm run docs:check` sai com 0
- [ ] `git status` mostra somente `README.md` e `WORKFLOW.md` modificados
  (além de `plans/README.md` na atualização de status)
- [ ] Linha do plano 001 atualizada em `plans/README.md`

## Condições de STOP

Pare e reporte (não improvise) se:

- Os trechos citados em "Estado atual" não existirem mais nesses arquivos
  (docs já corrigidos ou reescritos — o plano está obsoleto).
- `npm run docs:check` falhar por regra que exige o formato antigo (indicaria
  um verificador acoplado ao literal; reporte em vez de mudar o script).

## Notas de manutenção

- Qualquer plano futuro que crie migration nova deixa de depender destes docs
  estarem atualizados: o número passa a ser derivado do diretório.
- Revisor: confira que nenhuma outra menção numérica de migration foi
  introduzida no diff.
