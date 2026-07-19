# Plano 6 — Desacoplamento financeiro e alertas do Portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirar a prontidão do Portal do gate bloqueante de revisão/faturamento e implementar o modelo de pendências: alerta preventivo persistente, exceção crítica vinculada à fatura (com email único e deduplicado) e pendência geral do Cliente.

**Architecture:** Migration altera a função canônica do gate (introduzida em `128_review_gate_canonical_pendencies.sql` / endurecida em 129) removendo a condição de Portal ativo. Um trigger em `invoices` abre a exceção crítica na transição para Emitida (dedup por fatura+evento) e outro a encerra quando a fatura deixa de estar aberta. A pendência geral vive como alerta `portal_pendencia_geral` criado quando o Cliente entra em processo ativo sem Portal/email e encerrado apenas por ativação da conta ou exceção formal. Email crítico via módulo do plano 4.

**Tech Stack:** PostgreSQL (triggers + funções), Edge Function `notify-invoice-issued` (estender), tabela `alerts` existente.

**Leitura obrigatória:** issue #370 seção "Revisão, faturamento e alertas"; `CONTEXT.md` ("Desacoplamento financeiro do Portal", "Exceção crítica da fatura", "Pendência geral de prontidão do Portal"); `supabase/migrations/128_review_gate_canonical_pendencies.sql` e `129_review_gate_hardening.sql` (ler INTEIRAS antes de alterar — a função do gate tem outras condições que DEVEM permanecer).

**Regras que este plano implementa (não desviar):**
- Falta de Portal/email NÃO bloqueia revisão nem faturamento; o gate financeiro avalia apenas condições próprias de negócio.
- Fatura emitida sem Email de Recuperação ou Portal ativo → exceção crítica vinculada à fatura: alerta in-app imediato + email crítico para Documentação e Administrativo, disparado UMA vez na transição para Emitida, dedup por fatura e evento.
- A exceção da fatura encerra quando a fatura deixa de estar aberta (paga, cancelada, substituída, obsoleta) — sem encerrar a pendência geral e sem email unitário de resolução (entra no resumo diário).
- Pendência geral persiste até Conta ativa ou exceção formal com justificativa.
- Financeiro visualiza; Operações não recebe pendências do Portal.

---

### Task 1: Remover o Portal do gate de revisão/faturamento

**Files:**
- Create: `supabase/migrations/185_review_gate_remove_portal.sql`

- [x] **Step 1: Ler `128` e `129` e reescrever a função do gate SEM a condição de Portal**

A migration recria a função canônica do gate (mesmo nome/assinatura de 129)
copiando TODAS as condições atuais EXCETO o bloco que consulta
`customer_portal_accounts.active` (em 128, o bloco em torno das linhas 37–64:
`v_portal_active` e a razão `'Acesso ao portal nao provisionado'`). Documente
no cabeçalho:

```sql
-- 185: Desacoplamento financeiro do Portal (issue #370).
-- A prontidão do Portal deixa de ser condição do gate de revisão/faturamento.
-- A visibilidade passa a ser dada por alertas preventivos e exceções críticas
-- (mesma migration, abaixo). Nenhuma outra condição do gate foi alterada.
```

- [x] **Step 2: Verificação de regressão do gate**

No banco local: um B/L com cliente vinculado e sem Conta de Portal deve passar
a ser elegível (antes: bloqueado com "Acesso ao portal nao provisionado");
um B/L sem cliente vinculado deve continuar bloqueado. Se existir teste de
contrato do gate no repo (grep `review_gate` em `src/services/__tests__/`),
atualize o caso correspondente — a mudança é decisão do issue #370.

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/185_review_gate_remove_portal.sql
git commit -m "feat(gate): portal deixa de bloquear revisão e faturamento"
```

---

### Task 2: Exceção crítica vinculada à fatura

**Files:**
- Create: `supabase/migrations/186_portal_invoice_critical_exception.sql`
- Modify: `supabase/functions/notify-invoice-issued/index.ts`

- [x] **Step 1: Trigger de abertura e encerramento**

```sql
-- 186: Exceção crítica da fatura (issue #370).
-- Abre na transição para 'issued' quando o Cliente não tem Email de
-- Recuperação ou Conta de Portal ativa. Dedup por fatura+evento.
-- Encerra quando a fatura deixa de estar aberta.

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_issue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_missing BOOLEAN;
BEGIN
  -- Somente a transição para Emitida (não repete em updates posteriores).
  IF NEW.status <> 'issued' OR OLD.status = 'issued' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (a.recovery_email IS NULL OR a.account_situation <> 'ativo')
  INTO v_missing
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = NEW.customer_id;
  -- Sem registro de portal = também está faltando prontidão.
  v_missing := COALESCE(v_missing, true);
  IF NOT v_missing THEN RETURN NEW; END IF;

  -- Dedup por fatura e evento: uma exceção aberta por fatura.
  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  SELECT 'portal_excecao_critica_fatura', 'invoice', NEW.id::text,
         'Fatura emitida sem Email de Recuperação ou Portal ativo. Provisionar acesso do Cliente.',
         'open'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alerts al
    WHERE al.type = 'portal_excecao_critica_fatura'
      AND al.entity_type = 'invoice'
      AND al.entity_id = NEW.id::text
      AND al.status <> 'closed');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_open ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_open
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_issue();

-- Encerramento automático quando a fatura deixa de estar aberta.
-- Verifique em src/pages/faturamentoInvoiceStatus.ts / types quais status
-- significam "não aberta" (paga, cancelada, substituída, obsoleta) e ajuste a lista.
CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status IN ('paid', 'cancelled', 'replaced', 'obsolete')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'portal_excecao_critica_fatura'
      AND entity_type = 'invoice'
      AND entity_id = NEW.id::text
      AND status <> 'closed';
    -- Sem email unitário de resolução: o encerramento entra no resumo diário
    -- (plano 4) como atividade. A pendência geral do Cliente NÃO é tocada aqui.
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_close ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_close
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_close();
```

- [x] **Step 2: Email crítico imediato (estender `notify-invoice-issued`)**

A function já é disparada na transição para `issued`. Adicionar: se o Cliente
não tem `recovery_email` ou conta `ativo`, enviar email crítico interno via
`sendPortalEmail` com `kind: 'alerta_critico'` e
`idempotencyKey: 'critico:fatura:' + invoiceId` (garante disparo único por
fatura/evento) para os usuários internos ativos de Documentação e
Administrativo. Conteúdo: empresa, CNPJ mascarado (`maskCnpj`), tipo da
pendência, referência da fatura, próxima ação e link para o Console
(`/clientes/portal?cliente=<id>`); sem senha, token ou email completo.

- [ ] **Step 3: Validar no banco local**

1. Fatura → `issued` de cliente sem portal: 1 alerta aberto; repetir update → sem duplicata.
2. Fatura → `paid`: alerta fechado; alerta `portal_pendencia_geral` (Task 3) permanece.
3. Fatura de cliente com conta `ativo` e recovery_email: nenhum alerta.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/186_portal_invoice_critical_exception.sql supabase/functions/notify-invoice-issued/
git commit -m "feat(portal): exceção crítica de fatura sem portal com dedup"
```

---

### Task 3: Pendência geral e alerta preventivo

**Files:**
- Create: `supabase/migrations/187_portal_general_pendency.sql`

- [x] **Step 1: Implementar**

```sql
-- 187: Pendência geral de prontidão do Portal (issue #370).
-- Processo ativo (B/L em aberto) sem Email de Recuperação ou sem Portal ativo
-- gera alerta preventivo persistente para Documentação. Encerra somente com
-- Conta ativa ou exceção formal justificada.

-- Função idempotente chamada pelo mesmo job periódico da expiração (plano 1)
-- ou por trigger de criação de B/L — escolha na execução o ponto de menor
-- acoplamento observando como alertas semelhantes são criados hoje
-- (grep 'INSERT INTO public.alerts' em supabase/migrations/).
CREATE OR REPLACE FUNCTION public.portal_refresh_general_pendencies()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- Abre pendência para clientes com processo ativo e sem prontidão.
  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  SELECT DISTINCT 'portal_pendencia_geral', 'customer', c.id::text,
         'Cliente com processo ativo sem Portal ativo ou sem Email de Recuperação.',
         'open'
  FROM public.customers c
  JOIN public.bls b ON b.customer_id = c.id          -- confirme a coluna real de vínculo B/L→cliente
  LEFT JOIN public.customer_portal_accounts a ON a.customer_id = c.id
  WHERE (a.id IS NULL OR a.recovery_email IS NULL OR a.account_situation <> 'ativo')
    AND COALESCE(a.provisioning_decision, 'aguardando_analise') <> 'provisionamento_nao_necessario'
    AND NOT EXISTS (
      SELECT 1 FROM public.alerts al
      WHERE al.type = 'portal_pendencia_geral'
        AND al.entity_type = 'customer'
        AND al.entity_id = c.id::text
        AND al.status <> 'closed');

  -- Encerra pendências resolvidas (conta ativa ou exceção formal).
  UPDATE public.alerts al
  SET status = 'closed', closed_at = now()
  WHERE al.type = 'portal_pendencia_geral'
    AND al.status <> 'closed'
    AND EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a
      WHERE a.customer_id = al.entity_id::bigint
        AND (a.account_situation = 'ativo'
             OR a.provisioning_decision = 'provisionamento_nao_necessario'));
END;
$$;

REVOKE ALL ON FUNCTION public.portal_refresh_general_pendencies() FROM PUBLIC, anon, authenticated;

-- Mesmo agendamento do job de expiração (a cada 15 min é suficiente).
SELECT cron.schedule(
  'portal-refresh-general-pendencies',
  '*/15 * * * *',
  $$SELECT public.portal_refresh_general_pendencies();$$
);

-- Novo processo/cobrança devolve cliente em exceção formal para análise
-- (decisão do mapa: sem disparo automático de convite). Trigger em bls:
CREATE OR REPLACE FUNCTION public.portal_reopen_on_new_process()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.customer_portal_accounts a
    SET provisioning_decision = 'aguardando_analise'
    WHERE a.customer_id = NEW.customer_id
      AND a.provisioning_decision = 'provisionamento_nao_necessario';
    IF FOUND THEN
      PERFORM public._portal_log_event(
        NEW.customer_id, (SELECT id FROM public.customer_portal_accounts WHERE customer_id = NEW.customer_id),
        NULL, 'provisionamento_nao_necessario', 'aguardando_analise',
        NULL, NULL, 'sistema', 'Novo processo/B/L vinculado ao Cliente', NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_reopen_on_new_process ON public.bls;
CREATE TRIGGER trg_portal_reopen_on_new_process
AFTER INSERT OR UPDATE OF customer_id ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.portal_reopen_on_new_process();
```

Confirme na execução a coluna real de vínculo B/L→Cliente (grep no schema;
pode ser via `customer_reconciliation` e não coluna direta) e o critério de
"processo ativo" usado pelo gate — reutilize a mesma semântica do gate (128).

- [ ] **Step 2: Validar no banco local**

1. Cliente com B/L e sem portal → job cria 1 pendência; rodar 2× não duplica.
2. Ativar conta (update manual) → job encerra a pendência.
3. Cliente em exceção formal + novo B/L → decisão volta a `aguardando_analise` sem convite.

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/187_portal_general_pendency.sql
git commit -m "feat(portal): pendência geral e reabertura por novo processo"
```

---

### Task 4: Visibilidade em `/alertas` e documentação

**Files:**
- Modify: `src/pages/Alertas.tsx` (rotular origem "Portal do Cliente" e linkar o Console)
- Modify: `docs/ARCHITECTURE.md`, `docs/modules/portal-cliente.md`, `docs/RASTREABILIDADE.md`

- [x] **Step 1: Mapear os tipos novos** (`portal_pendencia_geral`,
`portal_excecao_critica_fatura`, `portal_convite_expirado`,
`portal_falha_envio`, `portal_email_suprimido`, `portal_abuso_login`) no
render de `Alertas.tsx`: exibir origem "Portal do Cliente" e link
`/clientes/portal?cliente=<entity_id>` (rota do plano 7; até lá o link pode
apontar para a ficha). Financeiro vê; nenhum envio para Operações (alertas são
in-app; o email crítico já filtra papéis no plano 4/6).

- [x] **Step 2: Rodar suíte e docs**

Run: `npm test -- Alertas && npm run lint && npm run docs:check`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add src/pages/Alertas.tsx docs/
git commit -m "feat(portal): alertas do portal na central com origem e link"
```
