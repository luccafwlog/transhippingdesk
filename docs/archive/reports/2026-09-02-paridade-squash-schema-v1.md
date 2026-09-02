# Paridade do squash v1.0 — replay comparado em PostgreSQL 16

Data: 2026-09-02 · Contexto: revisão das PRs 650 e 651 (ADR 0062)

Registro histórico. Descreve a verificação executada nesta data; não é
documentação viva.

## Por que este relatório existe

A PR 651 afirmava paridade "bit a bit, 100%" entre as 383 migrações históricas
e o schema consolidado, sem deixar a evidência no repositório. A afirmação é
forte demais para o método usado, e o recorte comparado (schema `public`) deixa
de fora justamente as classes de objeto que o squash havia perdido. Este
relatório substitui a afirmação por medição reproduzível.

## Método

Dois bancos descartáveis no mesmo PostgreSQL 16, ambos sobre o shim de
`scripts/setup-local-pg.sh` (papéis `anon`/`authenticated`/`service_role`,
schema `auth`, stub de `cron`):

- **A** — replay sequencial das 383 migrações de `supabase/migrations_archive/`.
- **B** — `001_initial_schema.sql` + `002_business_logic_and_security.sql` +
  `003_pos_squash_objetos_fora_do_dump.sql`.

Comparação por consulta ao catálogo, não por diff de dump: assinaturas de
função, corpos (`pg_get_functiondef`), colunas, policies, triggers, índices e
ACL efetiva (`has_function_privilege`).

## Resultado

| Dimensão | A (arquivo morto) | B (consolidado) | Diferença |
|---|---|---|---|
| Tabelas em `public` | 106 | 106 | 0 |
| Colunas | 1.121 | 1.121 | 0 |
| Funções do projeto (excluídas as de extensão) | 397 | 397 | 0 |
| Corpos de função (`pg_get_functiondef`) | — | — | 0 linhas |
| Policies RLS | 273 | 273 | 0 |
| Triggers | 144 | 144 | 0 |
| Índices | 307 | 307 | 0 |
| Tabelas sem RLS | 0 | 0 | 0 |

A estrutura e a lógica conferem. As diferenças estão todas na camada de
privilégios, e todas na direção de **B ser mais fechado que A**: 10 funções de
trigger e `upsert_portal_invoice_exception(bigint,text)` mantêm em A o EXECUTE
implícito de `PUBLIC` e ficam fechadas em B. Isso é o comportamento correto — é
o que a migration 297 faz em produção e o que a varredura da 003 reproduz. A
brecha em A é artefato do Postgres puro, explicado abaixo.

## O que o replay em Postgres puro não consegue provar

`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` é
inócuo num banco onde nunca houve um default configurado: medido nesta data,
`pg_default_acl` fica vazio e `proacl` da função nova continua `NULL`, ou seja,
`PUBLIC` mantém o EXECUTE embutido. No Supabase existe um default explícito da
plataforma, e ali o mesmo comando faz efeito — foi assim que a 297 fechou o
achado A-06 em produção.

Consequência prática: em Postgres puro quem fecha as 397 funções é a **varredura
de resíduo** da 003, não o `ALTER DEFAULT PRIVILEGES` da 001. As duas peças são
necessárias e nenhuma torna a outra redundante.

## Achado colateral: RPC sem grant chamada pelo navegador

`public.delete_baplie_manifest_for_voyage(bigint)` é chamada do navegador em
`src/services/vaziosImportacaoImport.ts` como `authenticated`, e sua ACL é
`{postgres=X/postgres}` — **nos dois bancos**. A migration arquivada 097 aplicou
o `REVOKE ... FROM PUBLIC, anon` e nunca concedeu o EXECUTE de volta.

Não é regressão do squash: A e B concordam, e o dump de produção também não traz
grant nenhum para ela. É um defeito pré-existente que o squash torna permanente
e reproduzível. Fica registrado aqui para tratamento em mudança própria.

As outras oito RPCs sem grant explícito (`_portal_log_event`,
`portal_login_*`, `portal_recovery_*`, `link_invoice_to_ledger`,
`portal_resolve_login`) são chamadas por Edge Functions sob `service_role` — que
a 297 deliberadamente não revoga — ou são código morto declarado na própria 297.
