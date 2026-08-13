# Baseline de performance em produção — camada de banco

> **Snapshot histórico:** este relatório descreve o projeto Supabase na data e
> horário indicados. Para o estado atual, consulte o próprio banco.

**Data:** 2026-08-13 · **Janela:** 17:07–17:19 UTC ·
**Ambiente:** projeto Supabase `fgmkhbzhaeebrsizwccx` (`sa-east-1`,
Postgres 17.6.1.104) · **Commit:** `7c53f69` ·
**Perfil usado nas medições:** usuário interno ativo com `role = 'admin'`
(identidade não registrada por política do plano) ·
**Origem:** Task 2 do plano
[`2026-08-13-correcao-regressao-inicializacao-login-navegacao.md`](../../plans/2026-08-13-correcao-regressao-inicializacao-login-navegacao.md).

Rótulos de evidência conforme [`docs/CONVENCOES.md`](../../CONVENCOES.md).

**Método.** Todas as medições rodaram com `set local role authenticated` e
`request.jwt.claims` do perfil acima, para que as policies entrem no plano de
execução — medir como `postgres` daria um resultado falso, já que o superusuário
ignora RLS. Nenhum JWT, anon key, e-mail, UUID ou payload de cliente foi
registrado aqui.

## Conclusão

A camada de banco **não é gargalo**. A consulta mais cara do caminho crítico
custa 32 ms sobre 1.112 linhas; a hidratação do perfil, que bloqueia o
`ProtectedRoute`, custa 0,095 ms. A RLS não cobra por linha. O polling do WAL do
Realtime, apontado como achado dominante na auditoria de 2026-08-12, **parou
completamente**.

Se o acesso frio seguir lento, a causa está acima do banco — Hosting/TLS,
JavaScript, Auth ou waterfall de rota. As Tasks 3 e 4A do plano continuam
bloqueadas por falta de credencial interna de teste.

## Publication do Realtime

**Evidência: Runtime** (`pg_publication_tables`). A publication
`supabase_realtime` está **vazia** — não contém `vessel_schedules`, `alerts`
nem `demurrage_invoices`, que era o que a Task 2 mandava confirmar, e nenhuma
outra tabela. A única publication com tabelas é
`supabase_realtime_messages_publication`, restrita às partições internas
`messages_*` do próprio Realtime.

## Polling do WAL — três snapshots

**Evidência: Runtime** (`pg_stat_statements`, agregado das entradas
`realtime.apply_rls` / `wal->>`).

| Snapshot | Horário (UTC) | Chamadas | Tempo total |
|---|---|---|---|
| 1 | 17:07:53 | 755.470 | 3.594.702 ms |
| 2 | 17:15:53 | 755.470 | 3.594.702 ms |
| 3 | 17:19:28 | 755.470 | 3.594.702 ms |

**Crescimento zero em 11 minutos e 35 segundos** — os dois contadores são
idênticos nos três snapshots. O consumo não está apenas baixo: cessou.

Isso reinterpreta o Achado A da auditoria
[`2026-08-12-investigacao-lentidao-carregamento-paginas.md`](../audits/2026-08-12-investigacao-lentidao-carregamento-paginas.md),
que media 45,3% do tempo de execução do banco nessas entradas. O número está
correto, mas é **resíduo histórico**: `pg_stat_statements` não é resetado desde
2026-04-07 e acumulou o período anterior à migration
`289_drop_orphan_realtime_publication.sql` e à retirada dos canais no cliente.
Duas leituras adicionais dimensionam o resíduo: 3.594.702 ms são ~1 hora de CPU
em 128 dias de janela, e a soma de **todo** o tempo de execução do banco no
mesmo período é de ~2,2 horas. O banco está ocioso.

## Planos das consultas do caminho crítico

**Evidência: Runtime** (`EXPLAIN (ANALYZE, BUFFERS)`). Execução única por
consulta, cache quente; os valores são a ordem de grandeza, não mediana de N
rodadas — o banco está tão longe do limite que repetir não mudaria a conclusão.

| Consulta | Origem | Plano | Execução |
|---|---|---|---|
| `user_profiles` por `id` + `active` | `useAuth` (bloqueia `ProtectedRoute`) | Index Scan `user_profiles_pkey`, RLS em **InitPlan** | **0,095 ms** |
| `bls` `review_status = 'pending_review'` | `useOperationalCounts` | Index Only Scan `idx_bls_review_status` | 2,268 ms |
| `bls` `charge_status = 'review_required'` | `useOperationalCounts` | Index Only Scan `idx_bls_charge_status` | 0,183 ms |
| `bls` `charge_status = 'ready_for_billing'` | `useOperationalCounts` | Index Only Scan `idx_bls_charge_status` | 1,119 ms |
| `bls` `customer_id is null` | `useOperationalCounts` | Index Only Scan `idx_bls_customer_financial` | 1,135 ms |
| `alerts` `status <> 'closed'` | `useOperationalCounts` | Seq Scan (73 linhas) | 1,763 ms |
| `voyages` + `vessels` + `ports` | Line Up (`services/lineup.ts`) | Hash Left Join + Memoize | 1,815 ms |
| `bl_containers` (1.112 linhas) | Line Up (`services/lineup.ts`) | Seq Scan | **32,121 ms** |

### RLS não cobra por linha

As policies aparecem como `Filter: is_active_read_user()` com
`Rows Removed by Filter: 0`, e em `user_profiles` o planner promove a checagem a
`InitPlan 1` — avaliada **uma vez por query**, não por linha. Confirma com plano
de execução o que a auditoria anterior deduziu a partir da definição das funções
(`STABLE SECURITY DEFINER`).

O advisor de performance segue reportando `auth_rls_initplan` apenas em cinco
tabelas `portal_*`, fora do caminho do sistema interno, e 75 foreign keys sem
índice de cobertura em nível `INFO` — irrelevantes neste volume.

### O único plano que merece observação

`bl_containers` faz Seq Scan de 1.112 linhas em 32 ms para o Line Up. É o maior
número da tabela e ainda assim está uma ordem de grandeza abaixo da latência de
rede de qualquer request. **Não vale índice hoje** — a tabela cresce com o
volume operacional, então o ponto de reavaliação é quando o Line Up passar a
custar acima de ~200 ms, não agora.

## O que este relatório NÃO fecha

- **Task 1, último passo:** executar `npm run perf:authenticated-startup` e
  reproduzir o sintoma. Bloqueado por falta de credencial interna de teste.
- **Task 3 e Task 4A:** isolar a camada dominante e corrigir Auth/perfil.
  Dependem da mesma credencial. Nada foi alterado em `useAuth.tsx` ou
  `services/supabase.ts` sem essa medição — o plano proíbe escolher causa
  primária sem evidência, e a evidência de banco aqui coletada **descarta** o
  banco, mas não aponta o substituto.
