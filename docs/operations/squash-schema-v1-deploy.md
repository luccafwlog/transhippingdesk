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

1. Marcar as migrações obsoletas (`003` a `384`) como revertidas no histórico.
   Não copie o `...` literalmente — expanda a lista a partir do arquivo morto:
   ```bash
   # Gera a lista exata de versões obsoletas (exclui 283, que nunca existiu):
   OBSOLETAS=$(ls supabase/migrations_archive/*.sql | sed 's/.*\///;s/_.*//' | awk '$1 > "002"' | tr '\n' ' ')
   echo "$OBSOLETAS"
   supabase migration repair --linked --status reverted $OBSOLETAS
   ```
   *Alternativamente, via SQL administrativo autenticado como postgres:*
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
   WHERE version NOT IN ('001', '002', '003', '004');
   ```

2. Confirmar as versões consolidadas como aplicadas:
   ```bash
   supabase migration repair --linked --status applied 001 002 003 004
   ```

3. Verificar paridade e sincronismo:
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
