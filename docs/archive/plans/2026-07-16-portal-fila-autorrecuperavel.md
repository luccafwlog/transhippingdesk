# Portal Fila Autorrecuperável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reparar automaticamente registros ausentes de `customer_portal_accounts`, restaurar a fila atual e impedir que uma lacuna volte a aparecer como fila vazia.

**Architecture:** Uma migration 198 cria uma função interna e idempotente de reparo, chamada pela RPC protegida do console antes da consulta. O trigger da migration 193 continua cobrindo novos Clientes; o read model passa a reparar lacunas posteriores e registrar auditoria de sistema.

**Tech Stack:** PostgreSQL/Supabase migrations, RPC `SECURITY DEFINER`, Vitest, React/Supabase runtime.

## Global Constraints

- Não criar identidade Auth, convite, Email de Recuperação ou email transacional durante o reparo.
- Não alterar Contas de Portal existentes.
- Preservar a projeção por perfil e as correções das migrations 196 e 197.
- Aplicar migrations numeradas com `supabase db push`; não usar `apply_migration`.
- Não registrar CNPJ, email ou outro dado pessoal nas evidências públicas.

---

### Task 1: Contrato de autorrecuperação da fila

**Files:**
- Create: `supabase/migrations/198_portal_provisioning_queue_self_heal.sql`
- Modify: `src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts`

**Interfaces:**
- Consumes: `public.customer_portal_accounts`, `public.customers`, `public.portal_provisioning_events`, `public._portal_actor_role()`.
- Produces: `public.portal_repair_missing_accounts() RETURNS BIGINT` e nova versão de `public.portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL) RETURNS SETOF JSONB`.

- [ ] **Step 1: Escrever o teste de contrato SQL que falha**

Adicionar leitura de `supabase/migrations/198_portal_provisioning_queue_self_heal.sql` e asserts para:

```ts
expect(sql198).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_repair_missing_accounts\(\)/i)
expect(sql198).toMatch(/ON CONFLICT \(customer_id\) DO NOTHING/i)
expect(sql198).toContain("false, 'aguardando_analise', 'sem_conta'")
expect(sql198).toContain('Reparo automático da fila do Portal durante a leitura.')
expect(sql198).toMatch(/PERFORM public\.portal_repair_missing_accounts\(\);[\s\S]*RETURN QUERY/i)
expect(sql198).not.toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER/i)
expect(sql198).toMatch(/REVOKE ALL ON FUNCTION public\.portal_repair_missing_accounts\(\) FROM PUBLIC, anon, authenticated/i)
```

- [ ] **Step 2: Executar o teste e confirmar RED**

Run: `npx vitest run src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts`

Expected: FAIL porque a migration 198 ainda não existe ou não contém o contrato.

- [ ] **Step 3: Implementar a migration mínima**

Criar uma função `SECURITY DEFINER` com `search_path` fixo que insere somente Clientes ausentes, captura as linhas em uma CTE `inserted`, registra um evento append-only por linha e retorna a contagem. Revogar execução direta de todos os papéis públicos.

Redefinir `portal_list_provisioning_console` a partir da versão da migration 197, removendo `STABLE` e executando:

```sql
PERFORM public.portal_repair_missing_accounts();
```

antes do `RETURN QUERY`. Preservar integralmente as guardas, projeções, tratamento seguro de `alerts.entity_id`, `financial_status IS DISTINCT FROM 'cancelled'`, grants e revokes.

- [ ] **Step 4: Executar o teste e confirmar GREEN**

Run: `npx vitest run src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts`

Expected: PASS.

- [ ] **Step 5: Validar sintaxe e diff**

Run: `git diff --check`

Expected: exit 0.

### Task 2: Documentação viva e procedimento operacional

**Files:**
- Modify: `docs/modules/portal-cliente.md`
- Modify: `docs/operations/validacao.md`
- Modify: `docs/operations/seguranca.md`
- Modify: `docs/RASTREABILIDADE.md`

**Interfaces:**
- Consumes: migration 198 e resultado do pré-voo/backfill.
- Produces: contrato operacional e evidências rastreáveis da autorrecuperação.

- [ ] **Step 1: Atualizar o contrato documental**

Registrar que a migration 198 preserva o trigger da 193 e adiciona reparo idempotente antes da leitura da fila. Explicitar que o reparo cria apenas a linha inicial e o evento de sistema, sem Auth, convite ou email.

- [ ] **Step 2: Atualizar validação e segurança**

Adicionar o procedimento: pré-voo, `supabase db push`, pré-voo novamente, backfill se ainda houver lacunas e confirmação final de zero ausentes. Registrar `portal_repair_missing_accounts()` como função interna sem grants públicos.

- [ ] **Step 3: Atualizar rastreabilidade**

Associar a fila às migrations 196–198 e ao teste de contrato SQL.

- [ ] **Step 4: Validar documentação**

Run: `npm run docs:check`

Expected: PASS.

### Task 3: Verificação local completa

**Files:**
- Verify only.

**Interfaces:**
- Consumes: código, migration, testes e docs das Tasks 1–2.
- Produces: evidência local antes de qualquer escrita remota.

- [ ] **Step 1: Executar testes focados**

Run: `npx vitest run src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts src/services/__tests__/portalProvisioningConsoleReadModelMigration.test.ts src/services/__tests__/portalProvisioning.test.ts`

Expected: PASS.

- [ ] **Step 2: Executar verificações obrigatórias**

Run, separadamente:

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check
```

Expected: todos com exit 0.

- [ ] **Step 3: Revisar o escopo do diff**

Run: `git status --short` e `git diff --stat`

Expected: apenas migration 198, teste de contrato e documentação relacionada.

### Task 4: Publicação, migration e recuperação de produção

**Files:**
- Remote operations only.

**Interfaces:**
- Consumes: migration 198 validada e fluxo existente `portal_provisioning_preflight` / `portal_provisioning_backfill`.
- Produces: produção com 310 registros, zero lacunas e fila populada.

- [ ] **Step 1: Commitar e publicar a implementação**

```powershell
git add supabase/migrations/198_portal_provisioning_queue_self_heal.sql src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts docs/modules/portal-cliente.md docs/operations/validacao.md docs/operations/seguranca.md docs/RASTREABILIDADE.md docs/superpowers/plans/2026-07-16-portal-fila-autorrecuperavel.md
git commit -m "fix(portal): autorrecupera registros ausentes da fila"
git push origin main
```

Expected: `origin/main` aponta para o commit publicado.

- [ ] **Step 2: Aplicar a migration pelo fluxo do projeto**

Run: `supabase link --project-ref fgmkhbzhaeebrsizwccx` e `supabase db push`.

Expected: migration `198_portal_provisioning_queue_self_heal.sql` aplicada sem erro.

- [ ] **Step 3: Executar diagnóstico e recuperação autorizada**

Na rota `/admin/portal-backfill`, executar o pré-voo. Se `customers_missing_record` for maior que zero, executar o backfill idempotente confirmado pelo usuário. Repetir o pré-voo.

Expected final:

```json
{
  "total_customers": 310,
  "existing_portal_records": 310,
  "existing_auth_links": 0,
  "existing_recovery_emails": 0,
  "customers_missing_record": 0
}
```

- [ ] **Step 4: Validar a fila em produção**

Abrir `/clientes/portal?filtro=todos` com sessão Administrativo.

Expected: Total 310, Aguardando análise 310 e linhas visíveis. Confirmar também que `/clientes` exibe badge 310.

- [ ] **Step 5: Registrar evidência sem PII**

Atualizar a Issue 370 com migration aplicada, totais agregados do pré-voo, backfill/reparo executado e validação da fila. Não incluir nomes, CNPJs ou emails.
