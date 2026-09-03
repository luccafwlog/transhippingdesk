# Procedimento Operacional: Deploy do Squash Schema v1.0 e Reparo de Migrações

Data: 2026-09-02 · Contexto: PR 651 / ADR 0062

Este documento estabelece o procedimento operacional para o deploy e reconciliação
do **Schema Inicial v1.0** em ambientes Supabase existentes e novos.

---

## 1. O Desafio Operacional

A consolidação substitui a cadeia histórica de 383 migrações (`001_schema.sql` a
`384_comunicados_automacao_falhas.sql`) por cinco arquivos atômicos:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_business_logic_and_security.sql`
3. `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql`
4. `supabase/migrations/004_vazios_delete_baplie_grant.sql`
5. `supabase/migrations/005_pg_net_jobs_rls_guard.sql` (reparo pós-squash em produção: pg_net, jobs HTTP e guarda RLS — versão nova, executa de verdade no push)

### Por que a ação padrão do Supabase não funciona em bancos existentes?
A tabela de governança interna do Supabase (`supabase_migrations.schema_migrations`)
registra as versões aplicadas (`001`, `002`, ..., `384`).
Em um banco que já executou o histórico anterior:
- As versões `001` e `002` são vistas como **já aplicadas** (reaproveitam prefixo).
- Os arquivos `005` a `384` não existem mais na pasta local, gerando divergência
  (*"Remote migration versions not found in local migrations directory"*).
- O comando `supabase db push` ou a automação de branching recusa o push ou não
  exercita o schema consolidado.

---

## 2. Cenários de Aplicação

### Cenário A — Ambientes Pré-Produção / Descartáveis (Recomendado)

Se o ambiente ainda não contém dados de produção irrecuperáveis (fase atual pré-go-live):

1. **Recriação Limpa:**
   - No ambiente local:
     ```bash
     supabase db reset
     ```
   - Em branches efêmeras de Preview (GitHub Actions / Supabase Branching):
     A branch é criada do zero a partir dos arquivos locais da PR. As migrations
     `001`–`005` rodam na sequência correta. O CI executa com 100%
     de sucesso.
> **Armadilha conhecida (A1/A2 da revisão final):** o branching só aplica
> arquivos NOVOS por versão. Se `001`/`002` mudarem após o primeiro push da
> PR, a branch segue híbrida (primeira geração de 001/002 + 003/004/005 novas)
> com check verde. Nesse caso, resetar antes do merge: deletar a branch no
> Dashboard do Supabase (Branches → … → Delete) + novo push (ou fechar/reabrir
> a PR para recriar do zero) e reconferir: catálogo 32/29, 2 baselines,
> 7 jobs (+ digest condicional), 2 buckets e `pg_default_acl` fechado para
> funções. A 003/005 só é validada de verdade em Supabase real — o replay
> local tem stub cron no-op e nenhum schema storage.

---

### Cenário B — Ambiente Já Provisionado / Staging com Dados (Reparo In-Place)

Para alinhar a tabela `supabase_migrations.schema_migrations` sem destruir dados:

#### Passo 0: Conectividade e pré-condição (antes de tocar em qualquer coisa)
```bash
supabase migration list --linked
```
Este comando valida de uma vez só o link (`--linked`), a versão do CLI (que
aceita a flag) e a pré-condição abaixo. Se ele falhar, pare aqui: o modo de
falha é barulhento, não destrutivo.

> **Pré-condição:** o alvo precisa estar com a cadeia legada integralmente
> aplicada (até `384`, sem pendências). Reescrever o histórico
> sobre um banco atrasado marcaria como aplicados efeitos que nunca rodaram
> (ex.: o runner de comunicados da `381`, os cortes de Storage da `375`).

#### Passo 1: Backup Preventivo
Gere um dump COMPLETO (schema + dados) antes de qualquer alteração de
catálogo — uma reversão do reparo precisa do conteúdo de
`supabase_migrations.schema_migrations`, que `--data-only` também carrega,
mas só o dump completo permite restaurar o banco de verdade. Sempre contra
o projeto alvo linkado — sem `--linked` o CLI opera no banco local:
```bash
supabase db dump --linked -f backup_pre_squash.sql
```

#### Passo 2: Executar Reparo no Histórico de Migrações
Conectado ao projeto alvo via Supabase CLI (`supabase link --project-ref <REF>`).
Todos os comandos abaixo levam `--linked` pelo mesmo motivo: sem ele, o reparo
atinge o banco local, não o staging/produção. Rode como o mesmo papel dono
dos objetos (postgres / SQL Editor do Dashboard): reparos e replays executados
por outro papel podem não enxergar os mesmos objetos e falhar barulhentamente.

1. Marcar todas as migrações legadas (`001` a `384`) como revertidas no histórico.
   É fundamental incluir `001` e `002` para que os nomes históricos (`schema` e
   `rls`) sejam substituídos pelos nomes consolidados (`initial_schema` e
   `business_logic_and_security`), evitando divergência em
   `supabase migration list`:
   ```bash
   # Gera a lista de todas as versões legadas (exclui 283, que nunca existiu):
   LEGADAS=$(ls supabase/migrations_archive/*.sql | sed 's/.*\///;s/_.*//' | tr '\n' ' ')
   echo "$LEGADAS"
   supabase migration repair --linked --status reverted $LEGADAS
   ```
    *Alternativa via SQL (só se o CLI não atender; o caminho via CLI é o
    preferencial justamente por abstrair o formato do catálogo):*
    1. Confira as colunas reais da tabela de governança — versões novas do CLI
       podem incluir colunas além de `(version, name)` (ex.: `statements`), e o
       INSERT abaixo falharia no meio da janela:
       ```sql
       SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'supabase_migrations'
           AND table_name = 'schema_migrations';
       ```
    2. Com o formato confirmado, reescreva o histórico autenticado como
       postgres (dono dos objetos):
    ```sql
    TRUNCATE supabase_migrations.schema_migrations;
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
     ('001', 'initial_schema'),
     ('002', 'business_logic_and_security'),
     ('003', 'pos_squash_objetos_fora_do_dump'),
     ('004', 'vazios_delete_baplie_grant');
   ```
   (Esta via SQL já equivale aos itens 1 e 2 juntos; quem a usar pula
   direto para o item 3.)

2. Confirmar as versões consolidadas como aplicadas (associando aos nomes locais atuais):
   ```bash
   supabase migration repair --linked --status applied 001 002 003 004
   ```
   Em seguida, aplicar a `005` de verdade (é versão nova, então o push a
   executa — ao contrário de 001–003):
   ```bash
   supabase db push --linked
   ```
   É ela que instala o `pg_net`, reagenda os 4 jobs HTTP
   (`portal-daily-digest` com GUCs, `alerts-foundation-detectors`,
   `demurrage-dunning`, `customer-communication-auto-runner`) e cria a
   guarda `rls_auto_enable()`/`ensure_rls` em produção (A4/M1 da revisão
   final: sem este passo, o digest segue falhando com
   `schema "net" does not exist` e os 3 runners seguem não agendados).
   *Alternativa manual (só se o push não atender):* rodar os blocos da 005 no
   SQL Editor como postgres — extensões, os 4 `cron.schedule` e a função +
   event trigger, na ordem do arquivo.
   ```bash
   supabase migration repair --linked --status applied 001 002 003 004
   ```

  3. Aplicar o efeito líquido novo da `004` no alvo. O reparo acima só reescreve
    histórico — não executa SQL. `001`–`003` são equivalentes ao que um banco em
    `384` já tem (varredura da 297, cron, Storage), mas o `GRANT` da `004` é
    inédito em produção (ver relatório de paridade): sem este passo, o checklist
    de privilégios da RPC BAPLIE falha. Rode autenticado como postgres (dono da
    função; ex.: SQL Editor do Dashboard):
    ```sql
    GRANT EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(bigint)
      TO authenticated, service_role;
    ```

  4. Verificar paridade e sincronismo:
    ```bash
    supabase migration list --linked
    ```
    A saída deve indicar `001`–`005` com status `Applied` tanto
    local quanto remotamente, sem nenhuma versão pendente ou órfã.

  #### Reversão (se o reparo precisar ser desfeito)
  O reparo só reescreve `supabase_migrations.schema_migrations` — nenhum dado
  de negócio é tocado, então a volta é a operação inversa, na ordem inversa.
  Pré-condição: o merge da PR 651 ter sido revertido no git. Após o
  revert, os 383 legados voltam para `supabase/migrations/` — o `list` abaixo
  lê esse diretório; confira com o Passo 0. O
  `supabase/migrations_archive/` continua existindo (foi criado na PR 650, já
  em `main`, e o CLI o ignora), e as `376`–`384` voltam intactas junto dos
  demais legados — nenhuma feature é arrastada pelo rollback, pois dunning,
  auto-runner, readiness e todo o resto já estavam em `main` antes do squash:
  ```bash
  LEGADAS=$(ls supabase/migrations/*.sql | sed 's/.*\///;s/_.*//' | tr '\n' ' ')
  supabase migration repair --linked --status applied $LEGADAS
  supabase migration repair --linked --status reverted 001 002 003 004
  supabase migration list --linked
  ```
  A saída deve voltar a mostrar a cadeia legada como `Applied` e nenhuma
  versão consolidada. Se qualquer dado tiver sido afetado no caminho (não é
  o caso quando só o histórico foi reescrito), restaure o
  `backup_pre_squash.sql` do Passo 1.

---

## 3. Checklist de Verificação Pós-Deploy

Após o deploy ou reparo, execute as seguintes validações:

- [ ] **Auditoria de Guardas:** `python3 scripts/security/verificar_guardas.py --ci`
- [ ] **pg_net instalado (A4):**
  ```sql
  SELECT extname, nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE extname = 'pg_net';
  ```
  Deve retornar 1 linha. Sem ela, todo job HTTP falha com `schema "net" does not exist` (foi o estado do `portal-daily-digest` em produção antes da 005).
- [ ] **Guarda RLS futura (M1):**
  ```sql
  SELECT pg_get_functiondef('public.rls_auto_enable()'::regprocedure);
  SELECT evtname FROM pg_event_trigger WHERE evtname = 'ensure_rls';
  ```
  A função deve existir com `SET search_path` e o trigger `ensure_rls` deve existir. Se a definição em produção divergir da 005, reconciliar antes de convergir.
- [ ] **Jobs pg_cron Ativos:**
  ```sql
  SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
  ```
  Em ambiente novo são **7 jobs garantidos**: `alerts-foundation-detectors`,
  `cleanup-portal-sessions`, `cleanup-provision-rate-limit`,
  `customer-communication-auto-runner`, `demurrage-dunning`,
  `portal-mark-expired-invites` e `portal-refresh-general-pendencies`.
  O oitavo, `portal-daily-digest`, só é agendado quando os GUCs
  `app.settings.supabase_url` e `app.settings.digest_secret` estão definidos
  no banco (nenhuma migration do repo os define — ver 003, bloco da 185);
  sem eles, a ausência do digest é o comportamento esperado, não falha.
- [ ] **Buckets de Storage:**
  ```sql
  SELECT id, public, file_size_limit FROM storage.buckets WHERE id IN ('demurrage-disputes', 'customer-communications');
  ```
- [ ] **Privilégios da RPC BAPLIE:**
  ```sql
  SELECT has_function_privilege('authenticated', 'public.delete_baplie_manifest_for_voyage(bigint)', 'EXECUTE');
  ```
  Deve retornar `true`.
- [ ] **Divergências conhecidas e esperadas (não abrir chamado):**
  - Tarifas zeradas pré-seed (B1): sem `seed.sql`, `charge_tables`/`charge_table_items`/`demurrage_rates` ficam 0/0/0; pós-seed convergem para 3/24/12 com asserções no próprio seed. Bootstrap exige migrations + seed.
  - Baselines 2 × produção 0 (B2): as migrations criam as 2 chaves de 251/271; produção legada tem 0. O gate exige as 2 (estado desejado).
  - anon sem SELECT no ambiente novo (B3): produção concede SELECT a anon em 87/106 tabelas (default de plataforma); o novo concede 0, com as mesmas 273 policies. As 4 tabelas com grant a `authenticated` sem contrapartida em produção não têm policy: RLS nega tudo.
- [ ] **Testes de Invariantes:**
  ```bash
  npx vitest run src/services/__tests__/consolidatedSchemaInvariants.test.ts
  ```
