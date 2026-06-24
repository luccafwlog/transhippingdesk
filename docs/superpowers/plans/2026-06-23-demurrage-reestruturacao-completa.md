# Plano de Reestruturação — Demurrage

**Data:** 23/06/2026  
**Status:** Proposto  
**Rotas afetadas:** `/demurrage`, `/demurrage/taxas`, `/reconciliacao`, `/portal/billing`  
**Serviços afetados:** `src/services/demurrage/`, `src/services/containerDatesImport.ts`, `src/services/reconciliacao.ts`  
**Componentes afetados:** `src/pages/Demurrage.tsx`, `src/pages/DemurrageRates.tsx`, `src/components/demurrage/InvoiceDocument.tsx`, `src/components/bl/BlDemurrageSection.tsx`, `src/pages/PortalBilling.tsx`  
**Banco:** Migrações novas + alteração de RPCs existentes

---

## Sumário

Este plano endereça 8 fases de implementação para corrigir divergências entre o sistema atual de demurrage e o processo de negócio real. O principal driver é a substituição do modelo de ROE congelado na emissão pelo recálculo diário automático com a PTAX do Banco Central.

---

## Problemas identificados

| # | Problema | Origem |
|---|---|---|
| P1 | ROE congelado na emissão — não há recálculo diário com PTAX | Código existente |
| P2 | Status `draft` redundante — fatura pode nascer `issued` | Código existente |
| P3 | Status `overdue` e vencimento fixo sem sentido com recálculo diário | Consequência de P1 |
| P4 | Sem visão por consignatário (cliente) — KPIs e relatórios | Falta funcionalidade |
| P5 | Sem visão de containers devolvidos com demurrage após free time | Falta funcionalidade |
| P6 | Desconto `fixed` aplicado em BRL, mas deveria ser em USD | Código existente |
| P7 | Sem auditoria diária de valores — impossível rastrear histórico | Falta funcionalidade |
| P8 | Conciliação PIX não considera valor na data do pagamento | Consequência de P1 |
| P9 | QR Code PIX não regenerado com recálculo | Consequência de P1 |
| P10 | Documento/fatura sem data de referência da PTAX usada | Falta funcionalidade |

---

## Regras de negócio

### Recálculo diário
- Toda fatura de demurrage **não paga** deve ser recalculada a cada nova PTAX divulgada pelo BCB (∼13h30, dias úteis)
- Cálculo: `total_brl = (total_usd − desconto_usd) × ptax × markup(1,065)`
- Markup de 1,065 é spread fixo do armador, não margem de proteção cambial
- Se BCB offline, sistema solicita PTAX manual ao operador

### Documento
- Data do documento reflete o **dia em que o cliente abrir/visualizar**, não a data de emissão
- A PTAX exibida é a última divulgada até aquele momento
- Se cliente abrir antes da divulgação do dia (∼13h30), vale a PTAX anterior

### Descontos
- Descontos são sempre expressos em **dólares (USD)**
- Desconto percentual (%) é aplicado sobre o total USD
- Desconto fixo é aplicado em USD, antes da conversão para BRL

### Disputas
- Disputa em aberto **não bloqueia** pagamento nem recálculo
- Disputar e pagar são independentes

### Pagamento
- No momento do pagamento, o valor é congelado (fotografia daquele instante)
- Conciliação PIX usa o valor **na data do pagamento**, não o valor corrente
- Sistema precisa detectar discrepância entre PTAX do pagamento e da reconciliação

### QR Code PIX
- Regenerado automaticamente a cada recálculo (valor BRL muda → QR muda)

### Auditoria
- Toda alteração de valor é registrada em `demurrage_invoice_history`
- Inclui: data, PTAX, USD, BRL, fonte (bcb_live/cached/manual)
- Auditoria ocorre até o momento do pagamento

### Portal do Cliente
- Valor em USD: fixo (referência estável para o cliente)
- Valor em BRL: dinâmico (atualizado com a PTAX)
- Ambos exibidos com indicação clara

---

## Fases de Implementação

---

### FASE 1 — Recálculo diário + Histórico

**Dependências:** Nenhuma  
**Esforço estimado:** Alta (base do novo modelo)

#### Requisitos

**1.1 Tabela `demurrage_invoice_history`**

```sql
CREATE TABLE public.demurrage_invoice_history (
  id            bigserial PRIMARY KEY,
  invoice_id    bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE,
  event_date    date NOT NULL DEFAULT CURRENT_DATE,
  ptax_used     numeric(10,4) NOT NULL,
  roe_used      numeric(10,4) NOT NULL,       -- ptax × markup
  total_usd     numeric(12,2) NOT NULL,
  total_brl     numeric(14,2) NOT NULL,
  discount_usd  numeric(12,2) NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'bcb_live'
                CHECK (source IN ('bcb_live', 'cached', 'manual', 'payment')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_demurrage_inv_hist_invoice ON demurrage_invoice_history(invoice_id);
CREATE INDEX idx_demurrage_inv_hist_date ON demurrage_invoice_history(event_date);
```

**1.2 RPC `recalculate_demurrage_invoices`**

Função que recalcula todas as faturas não pagas com uma PTAX fornecida:

```sql
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax    NUMERIC,
  p_source  TEXT DEFAULT 'bcb_live'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roe NUMERIC;
  v_updated INT := 0;
  v_inv RECORD;
  v_total_brl NUMERIC(14,2);
  v_pix_payload TEXT;
  v_discount_usd NUMERIC(12,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  v_roe := ROUND(p_ptax * 1.065, 4);

  FOR v_inv IN
    SELECT id, total_usd,
           COALESCE(discount_value, 0) AS discount_value,
           discount_mode, doc_number
    FROM public.demurrage_invoices
    WHERE status IN ('issued')
      AND paid_at IS NULL
      AND cancelled_at IS NULL
    FOR UPDATE
  LOOP
    -- Aplica desconto em USD
    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      IF v_inv.discount_mode = 'percent' THEN
        v_discount_usd := v_inv.total_usd * (v_inv.discount_value / 100);
      ELSE
        v_discount_usd := v_inv.discount_value;  -- fixed em USD
      END IF;
    END IF;

    v_total_brl := ROUND((v_inv.total_usd - v_discount_usd) * v_roe, 2);

    -- Gera novo PIX payload
    v_pix_payload := public.build_pix_payload(v_total_brl, v_inv.doc_number);

    -- Atualiza invoice
    UPDATE public.demurrage_invoices
    SET frozen_roe = v_roe,
        frozen_total_brl = v_total_brl,
        roe_source = p_source,
        pix_payload = v_pix_payload,
        updated_at = now()
    WHERE id = v_inv.id;

    -- Registra auditoria
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used,
       total_usd, total_brl, discount_usd, source)
    VALUES
      (v_inv.id, CURRENT_DATE, p_ptax, v_roe,
       v_inv.total_usd, v_total_brl, v_discount_usd, p_source);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe);
END;
$$;
```

**1.3 Job agendado** (pg_cron ou Edge Function)

- Executa dias úteis (seg-sex) após ∼14h (margem após divulgação BCB ∼13h30)
- Busca PTAX no endpoint do BCB (`CotacaoDolarPeriodo`, última cotação)
- Se BCB offline: aborta com log (não recalcula)
- Chama `recalculate_demurrage_invoices(p_ptax, 'bcb_live')`
- Registra resultado em log de auditoria do job

**1.4 Modal "Informar PTAX manual"**

- Novo modal na tela `/demurrage`
- Input: `ptax` (numeric, 4 casas decimais)
- Validação: > 0
- Ação: chama `recalculate_demurrage_invoices(ptax, 'manual')`
- Exibido automaticamente quando job falha por BCB offline
- Botão "Informar PTAX" no header da página

**Arquivos alterados:**
- Migration nova: `20260623XXXXXX_demurrage_invoice_history.sql`
- Migration nova: `20260623XXXXXX_recalculate_demurrage_invoices.sql`
- `src/services/demurrage/demurrageKpis.ts` — exportar `recalculateInvoices(ptax, source)`
- `src/pages/Demurrage.tsx` — adicionar modal PTAX manual

---

### FASE 2 — Simplificação do fluxo de criação

**Dependências:** Fase 1 (recálculo precisa existir)  
**Esforço estimado:** Média

#### Requisitos

**2.1 Alterar RPC `create_demurrage_invoice_with_items`**

- Status padrão passa de `draft` para `issued`
- Campo `due_date` removido do INSERT (mantido como nulo)
- `billed_at` e `first_billed_at` setados com `CURRENT_DATE`

```sql
INSERT INTO public.demurrage_invoices (
  doc_number, bl_id, customer_id, total_usd,
  due_date, ready_at, roe_manual, roe,
  status, billed_at, first_billed_at
)
VALUES (
  TRIM(p_doc_number), p_bl_id, p_customer_id, p_total_usd,
  NULL, p_ready_at, COALESCE(p_roe_manual, false), p_roe,
  'issued', CURRENT_DATE, CURRENT_DATE
)
RETURNING id INTO v_invoice_id;
```

**2.2 Alterar `createInvoiceForBL()` e `createInvoiceForReturnedBL()`**

- Após criar a invoice, chamar `fetchROE()` e recalcular imediatamente
- Opcional: chamar o job de recálculo para o registro recém-criado
- Remover a ida ao draft

**2.3 Remover job `mark_overdue_invoices()`**

- Migration para dropar o job e a função

**2.4 Ajustar UI**

- Remover aba "Rascunhos"
- Renomear "Emitidas" para "Faturas" (status `issued`)
- Remover coluna "Vencimento" das tabelas de invoice
- Remover badge e filtros de `overdue`
- Remover botão "Emitir" (agora é automático)
- Remover botão "Desemitir" (não faz mais sentido)

**2.5 Ajustar `containerDatesImport.ts`**

- Simplificar: criar já chama recálculo (não precisa do two-step)

**Arquivos alterados:**
- Migration: alterar `20260622132732_create_demurrage_invoice_atomic.sql` (função)
- Migration: dropar `031_overdue_enforcement.sql` (job)
- `src/services/demurrage/demurrageInvoices.ts`
- `src/services/containerDatesImport.ts`
- `src/pages/Demurrage.tsx` — remover abas/ações
- `src/pages/PortalBilling.tsx` — remover vencimento

---

### FASE 3 — Descontos em USD

**Dependências:** Nenhuma (pode rodar em paralelo com Fases 4 e 5)  
**Esforço estimado:** Baixa

#### Requisitos

**3.1 Ajustar modal de desconto**

- Label da opção `fixed`: "Valor fixo (USD)" (hoje "Valor fixo (BRL)")
- Placeholder/helper text: "Valor em dólares"

**3.2 Alterar ordem do cálculo**

No serviço `demurrageInvoices.ts` e no componente `InvoiceDocument.tsx`:

```
// Novo fluxo (sempre em USD):
discounted_usd = total_usd
if (discount_mode === 'fixed')
  discounted_usd = total_usd - discount_value
else if (discount_mode === 'percent')
  discounted_usd = total_usd * (1 - discount_value / 100)

total_brl = discounted_usd * roe
```

**3.3 Registrar `discount_usd` no histórico**

- Ao recalcular, o job da Fase 1 já aplica desconto em USD e registra `discount_usd` na tabela de histórico

**Arquivos alterados:**
- `src/services/demurrage/demurrageInvoices.ts` — `issueInvoice`, `markInvoicePaid`
- `src/components/demurrage/InvoiceDocument.tsx` — `discountAmt`
- `src/pages/Demurrage.tsx` — label do modal

---

### FASE 4 — Visão por consignatário

**Dependências:** Nenhuma (pode rodar em paralelo)  
**Esforço estimado:** Média

#### Requisitos

**4.1 Query `fetchCustomerDemurrageSummary()`**

```sql
SELECT
  c.id, c.name, c.cnpj_cpf,
  COUNT(DISTINCT di.bl_id) AS bl_count,
  COUNT(di.id) AS invoice_count,
  SUM(di.total_usd) AS total_usd,
  SUM(di.frozen_total_brl) AS total_brl
FROM demurrage_invoices di
JOIN customers c ON c.id = di.customer_id
WHERE di.status = 'issued'
  AND di.paid_at IS NULL
GROUP BY c.id, c.name, c.cnpj_cpf
ORDER BY total_brl DESC
```

**4.2 Query `fetchCustomerDemurrageDetail(customerId)`**

```sql
SELECT di.id, di.doc_number, di.bl_id, di.total_usd,
       di.frozen_total_brl, di.status
FROM demurrage_invoices di
WHERE di.customer_id = p_customer_id
  AND di.status = 'issued'
  AND di.paid_at IS NULL
```

**4.3 Nova aba "Por Cliente" em `/demurrage`**

- Tabela com colunas: Cliente (nome/CNPJ) | BLs | Faturas | Total USD | Total BRL
- Cada linha expansível (accordion): lista BLs com nº documento e valores
- Botão "Relatório" → gera PDF do consignatário

**4.4 Relatório PDF por consignatário**

- Cabeçalho: Transhipping, data, "Relatório de Demurrage", nome do cliente
- Tabela: Doc | BL | USD | BRL
- Total geral
- Impressão via `window.print()` (mesmo padrão do sistema)

**Arquivos novos/alterados:**
- `src/services/demurrage/demurrageKpis.ts` — novas queries
- `src/pages/Demurrage.tsx` — nova aba
- `src/components/demurrage/CustomerSummaryReport.tsx` — novo componente de relatório

---

### FASE 5 — Visão de containers (incluindo devolvidos)

**Dependências:** Nenhuma (pode rodar em paralelo)  
**Esforço estimado:** Média

#### Requisitos

**5.1 Alterar `listDemurrageContainers()`**

- Remover filtro `.neq('demurrage_status', 'returned')`
- Adicionar lógica: mostrar containers se `demurrage_status = 'overdue'` OU (`returned` com demurrage > 0)
- A demurrage é calculada via `calculateDemurrage()` no frontend (já existe)

**5.2 Query ajustada**

```typescript
let query = supabase
  .from('bl_containers')
  .select(`...`)
  .not('discharge_date', 'is', null)
  .in('demurrage_status', ['overdue', 'returned'])  // ← incluí returned
  .order('discharge_date', { ascending: false })
```

Filtro adicional no frontend: containers `returned` que estão dentro do free time são excluídos (não geraram demurrage).

**5.3 Colunas adicionadas na tabela**

- Free time (dias)
- Dias em excesso
- Dias P1 / Dias P2 (tooltip ou colunas)
- Total USD (já existe)

**5.4 Agrupamento**

- Mesmo agrupamento por B/L (já existe), mas grupos incluem containers `returned`

**Arquivos alterados:**
- `src/services/demurrage/demurrageContainers.ts` — query
- `src/pages/Demurrage.tsx` — colunas, agrupamento

---

### FASE 6 — Data de referência no documento

**Dependências:** Fase 1 (recálculo), Fase 2 (simplificação)  
**Esforço estimado:** Baixa

#### Requisitos

**6.1 Alterar `InvoiceDocument.tsx`**

- Abaixo do título, adicionar:
  ```
  Valores calculados em 23/06/2026 às 14:32
  com PTAX de R$ 5,1234 (fonte: BCB)
  ```
- `roe_source` mapeia para:
  - `bcb_live` → "BCB"
  - `cached` → "BCB (cache)"
  - `manual` → "Informada manualmente"

**6.2 Data no portal**

- O mesmo texto aparece no documento gerado pelo portal

**Arquivos alterados:**
- `src/components/demurrage/InvoiceDocument.tsx`
- `src/components/shared/InvoiceDocumentKit.tsx` (se necessário)

---

### FASE 7 — Conciliação PIX com histórico

**Dependências:** Fase 1 (histórico), Fase 6 (data referência)  
**Esforço estimado:** Alta

#### Requisitos

**7.1 RPC `get_demurrage_value_on_date`**

```sql
CREATE OR REPLACE FUNCTION public.get_demurrage_value_on_date(
  p_invoice_id BIGINT,
  p_date DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_brl NUMERIC(14,2);
BEGIN
  -- Retorna o valor em BRL vigente na data especificada
  SELECT dih.total_brl INTO v_total_brl
  FROM public.demurrage_invoice_history dih
  WHERE dih.invoice_id = p_invoice_id
    AND dih.event_date <= p_date
  ORDER BY dih.event_date DESC, dih.id DESC
  LIMIT 1;

  -- Se não achou no histórico, usa o valor congelado (legado)
  IF v_total_brl IS NULL THEN
    SELECT frozen_total_brl INTO v_total_brl
    FROM public.demurrage_invoices
    WHERE id = p_invoice_id;
  END IF;

  RETURN v_total_brl;
END;
$$;
```

**7.2 Alterar `confirm_demurrage_pix_matches`**

- Receber parâmetro `p_paid_at` (data do pagamento, vinda do extrato PIX)
- Chamar `get_demurrage_value_on_date(p_invoice_id, p_paid_at)`
- Comparar `p_amount_paid` com o valor histórico (tolerância R$ 0,01)
- Se bater: confirmar
- Se não: retornar erro claro informando o valor esperado naquela data

**7.3 Registrar pagamento no histórico**

- Ao confirmar pagamento, inserir registro em `demurrage_invoice_history`:
  ```sql
  INSERT INTO demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used,
     total_usd, total_brl, discount_usd, source)
  VALUES
    (p_invoice_id, p_paid_at, p_ptax, p_roe,
     p_total_usd, p_amount_paid, p_discount, 'payment');
  ```

**7.4 Ajustar `reconciliacao.ts`**

- `matchUnifiedPixTransactions()`: ao encontrar match com invoice de demurrage, passar a data do pagamento
- `reverseDemurragePayment()`: manter (já existe e funciona)

**Arquivos alterados:**
- Migration nova: RPC `get_demurrage_value_on_date`
- `src/services/reconciliacao.ts` — conciliação com data
- `src/pages/Reconciliacao.tsx` — se necessário
- `supabase/migrations/20260610094207_confirm_demurrage_pix_matches_batch.sql` — alterar RPC

---

### FASE 8 — Portal do Cliente

**Dependências:** Fase 1 (recálculo), Fase 6 (data referência)  
**Esforço estimado:** Média

#### Requisitos

**8.1 Lista de faturas (`portal_list_demurrage_invoices`)**

- Colunas: Nº Doc, BL, **USD (fixo)**, **BRL (dinâmico)**, Data referência, Status
- USD = `total_usd` (nunca muda, independente de PTAX)
- BRL = `frozen_total_brl` (sempre atualizado pelo recálculo)
- Data referência = última data de recálculo (do histórico ou `updated_at` da invoice)

**8.2 Detalhe da fatura (`portal_get_demurrage_invoice_detail`)**

- Exibir PTAX usada e data de referência
- Tabela de itens (já existe) com subtotais em USD
- Badge "Valores atualizados em DD/MM/AAAA"

**8.3 Dashboard do Portal**

- Substituir `frozen_total_brl` pelo valor atualizado (vem do histórico ou campo na invoice)

**8.4 Notificações**

- Não há necessidade de notificação a cada recálculo (seria excessivo)
- Notificação apenas em caso de mudança significativa (opcional, discutível)

**Arquivos alterados:**
- `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql` — ajustar RPCs
- `src/pages/PortalBilling.tsx` — ajustar colunas
- `src/pages/PortalDashboard.tsx` — valor dinâmico
- `src/services/portalBilling.ts` — se necessário

---

## Mapa de dependências

```
Fase 1 (Recálculo + Histórico)
  │
  ├──→ Fase 2 (Simplificação) — depende do recálculo existir
  ├──→ Fase 6 (Data referência) — depende do recálculo
  ├──→ Fase 7 (PIX c/ histórico) — depende do histórico
  └──→ Fase 8 (Portal) — depende do recálculo + data ref

Fase 3 (Descontos USD) — independente
Fase 4 (Visão cliente) — independente
Fase 5 (Visão containers) — independente
```

## Ordem de execução sugerida

```
Fase 1 → Fase 2 → Fase 3 + Fase 4 + Fase 5 (paralelo)
                → Fase 6 → Fase 7 → Fase 8
```

## Arquivos alterados (completo)

| Arquivo | Fase | Mudança |
|---|---|---|
| Migration: `demurrage_invoice_history` | 1 | Nova tabela |
| Migration: `recalculate_demurrage_invoices` | 1 | Nova RPC |
| Migration: alterar `create_demurrage_invoice_with_items` | 2 | Status `issued` default |
| Migration: dropar `mark_overdue_invoices` | 2 | Remover job |
| Migration: `get_demurrage_value_on_date` | 7 | Nova RPC |
| `src/services/demurrage/demurrageInvoices.ts` | 2, 3 | Simplificar criação, descontos USD |
| `src/services/demurrage/demurrageKpis.ts` | 1, 4 | Queries PTAX manual + cliente |
| `src/services/demurrage/demurrageContainers.ts` | 5 | Incluir returned na query |
| `src/services/demurrage/demurrageRates.ts` | — | Sem mudanças |
| `src/services/containerDatesImport.ts` | 2 | Simplificar |
| `src/services/reconciliacao.ts` | 7 | Conciliação com data |
| `src/pages/Demurrage.tsx` | 1, 2, 3, 4, 5 | Novas abas, modais, remoções |
| `src/pages/DemurrageRates.tsx` | — | Sem mudanças |
| `src/pages/PortalBilling.tsx` | 6, 8 | Colunas, data referência |
| `src/pages/PortalDashboard.tsx` | 8 | Valor dinâmico |
| `src/pages/Reconciliacao.tsx` | 7 | Se necessário |
| `src/components/demurrage/InvoiceDocument.tsx` | 3, 6 | Data ref + descontos USD |
| `src/components/demurrage/CustomerSummaryReport.tsx` | 4 | **Novo** componente |
| `src/components/bl/BlDemurrageSection.tsx` | — | Sem mudanças |
| `src/components/portal/DisputeModal.tsx` | — | Sem mudanças |
| `src/services/portalBilling.ts` | 8 | Ajustar queries |
