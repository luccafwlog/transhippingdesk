# Procedimento Operacional: Deploy do Squash Schema v1.0 e Reparo de Migrações

Data: 2026-09-02 · Contexto: PR 651 / ADR 0062

Este documento estabelece o procedimento operacional para o deploy e reconciliação
do **Schema Inicial v1.0** em ambientes Supabase existentes e novos.

---

## 1. O Desafio Operacional

A consolidação substitui a cadeia histórica de 383 migrações (`001_schema.sql` a
`384_comunicados_automacao_falhas.sql`) por quatro arquivos atômicos:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_business_logic_and_security.sql`
3. `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql`
4. `supabase/migrations/004_vazios_delete_baplie_grant.sql`

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
     `001`, `002`, `003` e `004` rodam na sequência correta. O CI executa com 100%
     de sucesso.

---

### Cenário B — Ambiente Já Provisionado / Staging com Dados (Reparo In-Place)

Para alinhar a tabela `supabase_migrations.schema_migrations` sem destruir dados:

#### Passo 1: Backup Preventivo
Gere um dump completo antes de qualquer alteração de catálogo (sempre contra
o projeto alvo linkado — sem `--linked` o CLI opera no banco local):
```bash
supabase db dump --linked --data-only -f backup_pre_squash_data.sql
```

#### Passo 2: Executar Reparo no Histórico de Migrações
Conectado ao projeto alvo via Supabase CLI (`supabase link --project-ref <REF>`).
Todos os comandos abaixo levam `--linked` pelo mesmo motivo: sem ele, o reparo
atinge o banco local, não o staging/produção.

> **Pré-condição:** o alvo precisa estar com a cadeia legada integralmente
> aplicada (até `384`, sem pendências) — confira com
> `supabase migration list --linked` antes de continuar. Reescrever o histórico
> sobre um banco atrasado marcaria como aplicados efeitos que nunca rodaram
> (ex.: o runner de comunicados da `381`, os cortes de Storage da `375`).

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
   *Alternativamente, via SQL administrativo autenticado como postgres
   (confira antes as colunas reais com
   `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'` — o caminho via CLI é o
   preferencial justamente por abstrair esse formato):*
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

2. Confirmar as 4 versões consolidadas como aplicadas (associando aos nomes locais atuais):
   ```bash
   supabase migration repair --linked --status applied 001 002 003 004
   ```

3. Aplicar o efeito líquido novo da `004` no alvo. O reparo acima só reescreve
   histórico — não executa SQL. `001`–`003` são equivalentes ao que um banco em
   `384` já tem (varredura da 297, cron, Storage), mas o `GRANT` da `004` é
   inédito em produção (ver relatório de paridade): sem este passo, o checklist
   de privilégios da RPC BAPLIE falha:
   ```sql
   GRANT EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(bigint)
     TO authenticated, service_role;
   ```

4. Verificar paridade e sincronismo:
   ```bash
   supabase migration list --linked
   ```
   A saída deve indicar `001`, `002`, `003` e `004` com status `Applied` tanto
   local quanto remotamente, sem nenhuma versão pendente ou órfã.

---

## 3. Checklist de Verificação Pós-Deploy

Após o deploy ou reparo, execute as seguintes validações:

- [ ] **Auditoria de Guardas:** `python3 scripts/security/verificar_guardas.py --ci`
- [ ] **Jobs pg_cron Ativos:**
  ```sql
  SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
  ```
  Devem constar os 8 jobs ativos: `alerts-foundation-detectors`, `cleanup-portal-sessions`,
  `cleanup-provision-rate-limit`, `customer-communication-auto-runner`,
  `demurrage-dunning`, `portal-daily-digest`, `portal-mark-expired-invites`,
  `portal-refresh-general-pendencies`.
- [ ] **Buckets de Storage:**
  ```sql
  SELECT id, public, file_size_limit FROM storage.buckets WHERE id IN ('demurrage-disputes', 'customer-communications');
  ```
- [ ] **Privilégios da RPC BAPLIE:**
  ```sql
  SELECT has_function_privilege('authenticated', 'public.delete_baplie_manifest_for_voyage(bigint)', 'EXECUTE');
  ```
  Deve retornar `true`.
- [ ] **Testes de Invariantes:**
  ```bash
  npx vitest run src/services/__tests__/consolidatedSchemaInvariants.test.ts
  ```
