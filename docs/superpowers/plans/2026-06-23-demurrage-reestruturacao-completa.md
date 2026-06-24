# Plano de Reestruturação — Demurrage

**Data:** 23/06/2026 (revisado em 24/06/2026 após sessão de grilling)
**Status:** Proposto
**Rotas afetadas:** `/demurrage`, `/demurrage/taxas`, `/reconciliacao`, `/portal/billing`
**Serviços afetados:** `src/services/demurrage/`, `src/services/containerDatesImport.ts`, `src/services/reconciliacao.ts`
**Componentes afetados:** `src/pages/Demurrage.tsx`, `src/pages/DemurrageRates.tsx`, `src/components/demurrage/InvoiceDocument.tsx`, `src/components/bl/BlDemurrageSection.tsx`, `src/pages/PortalBilling.tsx`
**Banco:** Migrações novas + alteração de RPCs existentes
**Decisões de referência:** ADR 0014 (recálculo diário) e ADR 0015 (conciliação por txid + janela de PTAX)

---

## Checklist de execução

- [x] **Fase 1** — Recálculo diário + Histórico
  - [x] 1.1 Tabela `demurrage_invoice_history`
  - [x] 1.2 Renomear `frozen_* → current_*` (migração + types + consumidores)
  - [x] 1.3 RPC núcleo `recalculate_demurrage_invoices`
  - [x] 1.4 RPC wrapper manual `recalculate_demurrage_invoices_manual`
  - [x] 1.5 Edge Function agendada
  - [x] 1.6 Banner de staleness + botão manual em `/demurrage`
- [x] **Fase 2** — Simplificação do fluxo + emissão automática
  - [x] 2.1 `create_demurrage_invoice_with_items` nasce `issued` + foto inicial
  - [x] 2.2 Emissão automática na importação
  - [x] 2.3 Remover job `mark_overdue_invoices` (demurrage; taxas locais mantidas)
  - [x] 2.4 UI: remover rascunhos/vencimento/overdue; ação Cancelar
- [x] **Fase 3** — Descontos em USD
- [ ] **Fase 4** — Visão por consignatário
- [ ] **Fase 5** — Visão de containers (operacional)
- [ ] **Fase 6** — Data de referência no documento
- [ ] **Fase 7** — Conciliação PIX por txid + janela das duas PTAX
- [ ] **Fase 8** — Portal do Cliente (push/armazenado)

---

## Sumário

Substituição do modelo de ROE congelado-na-emissão pelo **recálculo diário** do valor em BRL
com a PTAX do BCB, **enquanto a fatura não estiver paga**. O valor em USD é travado na emissão;
apenas o câmbio flutua. O congelamento real ocorre **no pagamento**.

Diferença estrutural em relação ao sistema interno antigo (`demurrage-manager`): o Transhipping
Desk **tem portal do cliente**, onde o cliente sempre vê o valor atualizado. Por isso o valor pode
flutuar até o pagamento ("como se faturasse diariamente"), sem precisar congelar no envio — o
sistema antigo congela no envio justamente por **não** ter portal.

---

## Problemas identificados

| # | Problema | Origem | Decisão |
|---|----------|--------|---------|
| P1 | ROE congelado na emissão — sem recálculo diário | Código existente | Recálculo diário até o pagamento (ADR 0014) |
| P2 | Status `draft` redundante | Código existente | Nasce `issued` |
| P3 | Status `overdue`/vencimento sem sentido sob recálculo | Consequência de P1 | Remover `due_date`/`overdue` |
| P4 | Sem visão por consignatário | Falta funcionalidade | Fase 4 |
| P5 | Sem visão de containers devolvidos com demurrage | Falta funcionalidade | Fase 5 (operacional) |
| P6 | Desconto `fixed` em BRL, deveria ser USD | Código existente | Desconto sempre em USD |
| P7 | Sem auditoria diária de valores | Falta funcionalidade | `demurrage_invoice_history` |
| P8 | Conciliação PIX não considera valor na data do pagamento | Consequência de P1 | Conciliação por txid + janela duas PTAX (ADR 0015) |
| P9 | QR PIX não regenerado no recálculo | Consequência de P1 | Regenerado quando a PTAX muda |
| P10 | Documento sem data de referência da PTAX | Falta funcionalidade | Data/PTAX do último recálculo |

---

## Regras de negócio

### Recálculo diário
- Toda fatura **não paga** é recalculada a cada nova PTAX divulgada pelo BCB (dias úteis, ∼13h30).
- Cálculo: `total_brl = (total_usd − desconto_usd) × ptax × 1,065`.
- Markup 1,065 é **spread fixo do armador** (não proteção cambial). Fica fixo no código, mas
  **centralizado num único ponto canônico** (backend + frontend), não espalhado como literal.
- **O valor em USD é travado na emissão**; apenas o câmbio flutua. O recálculo nunca recomputa dias.

### Política de busca da PTAX (igual ao sistema antigo `demurrage-manager`)
- Endpoint `CotacaoDolarPeriodo` dos últimos ∼10 dias, `$top=1 & $orderby=dataHoraCotacao desc`,
  selecionando `cotacaoVenda` + `dataHoraCotacao`.
- **Nunca pede "a de hoje"** — pega a cotação mais recente disponível. Fim de semana, feriado e
  "ainda não divulgada" não causam falha (retornam a última cotação).
- "Indisponível" só em **erro HTTP/rede** (ou período vazio = API com problema) → caminho manual.
- A data registrada é a **data da cotação** (`dataHoraCotacao`), não a data do run.

### Emissão
- **Automática na importação** quando **todos os containers do B/L já voltaram** e há demurrage > 0
  (espelha o `checkAndMigrateBLs` do sistema antigo). Devolução **parcial não emite nada** até o
  último container retornar.
- Nasce `issued`. Não há `due_date` nem status `overdue`. Não há estágio "enviado" (o portal mostra
  o valor atualizado, então não existe documento estático "na mão do cliente").
- Grava a **foto inicial de histórico** na emissão (`source` = `bcb_live`/`manual` conforme a origem
  da PTAX no momento).

### Correção / cancelamento
- **Fatura emitida e não paga:** a reimportação **não sobrescreve** `total_usd`. Se o dado de origem
  muda, o sistema **sinaliza divergência**; a correção é **cancelar (`status='cancelled'`) + reemitir**
  (novo `doc_number`, novo `total_usd`, nova foto de histórico).
- **Fatura paga:** imutável; reimportação nunca toca. Correção vira estorno/ajuste manual.
- Cancelamento é sempre ação **explícita** e auditada do operador.

### Documento / Portal
- O portal exibe o **último recálculo armazenado** (push), não recalcula on-demand. Assim o valor
  exibido == valor embutido no QR == valor no histórico.
- Valor em USD: fixo (referência estável). Valor em BRL: dinâmico (último recálculo). Ambos com
  indicação clara de data e PTAX usadas.
- Se o cliente abrir antes do recálculo do dia (∼14h), vê o último recálculo vigente (o de ontem).

### Descontos
- Sempre expressos e aplicados em **USD**, antes da conversão para BRL.
- Percentual sobre o total USD; fixo subtraído do total USD.

### Disputas
- Ortogonais: disputa em aberto **nunca** bloqueia recálculo nem pagamento.
- Resolução com valor menor = **desconto em USD** (reusa `discount_type` `acordo`/`datas`).
- Pago antes de resolver, com acordo de valor menor = **estorno manual** (fora do fluxo automático).

### Pagamento e conciliação
- **Somente quitação integral** (sem pagamento parcial em demurrage).
- Identificação da fatura por **`txid = doc_number`** (caminho primário, inequívoco mesmo com valor
  flutuante, pois o `doc_number` não muda no recálculo).
- Validação do valor pago pela **janela das duas PTAX mais recentes** registradas em
  `demurrage_invoice_history` com `event_date <= data_do_pagamento` (a janela é ancorada na **data do
  pagamento do extrato**, nunca na data da conciliação).
- Fallback (txid ausente/ilegível): CNPJ + a mesma janela das duas PTAX.
- No pagamento o valor casado é **congelado** (`source='payment'`) e o recálculo é encerrado.

### QR Code PIX
- BR Code **estático** com valor embutido. Regenerado **apenas quando a PTAX muda** (não diariamente
  à toa). Códigos antigos continuam pagáveis — daí a janela das duas PTAX na conciliação.

### Auditoria
- `demurrage_invoice_history` registra cada mudança de valor: `event_date` (= data da cotação),
  `ptax_used`, `roe_used`, `total_usd`, `total_brl`, `discount_usd`, `source`
  (`bcb_live`/`cached`/`manual`/`payment`).
- **Só insere nova linha quando a PTAX muda** (fim de semana/feriado não geram linha).

---

## Fases de Implementação

### FASE 1 — Recálculo diário + Histórico

**Dependências:** Nenhuma · **Esforço:** Alta

**1.1 Tabela `demurrage_invoice_history`**

```sql
CREATE TABLE public.demurrage_invoice_history (
  id            bigserial PRIMARY KEY,
  invoice_id    bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE,
  event_date    date NOT NULL,                 -- data da COTAÇÃO (dataHoraCotacao), não o run
  ptax_used     numeric(10,4) NOT NULL,
  roe_used      numeric(10,4) NOT NULL,         -- ptax × 1,065
  total_usd     numeric(12,2) NOT NULL,
  total_brl     numeric(14,2) NOT NULL,
  discount_usd  numeric(12,2) NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'bcb_live'
                CHECK (source IN ('bcb_live', 'cached', 'manual', 'payment')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_demurrage_inv_hist_invoice ON demurrage_invoice_history(invoice_id);
CREATE INDEX idx_demurrage_inv_hist_date    ON demurrage_invoice_history(invoice_id, event_date DESC, id DESC);
```

**1.2 Renomear colunas `frozen_* → current_*`**

Migração nova com `ALTER TABLE ... RENAME COLUMN frozen_roe TO current_roe` e
`frozen_total_brl TO current_total_brl`, recriando (`CREATE OR REPLACE`) as RPCs/views que
referenciam essas colunas. **Não** editar migrações antigas. Regenerar `src/types/database.ts`
(autorizado para esta tarefa) e atualizar os ∼27 arquivos consumidores.

**1.3 RPC núcleo `recalculate_demurrage_invoices`** (`service_role`, sem `auth.uid()`)

```sql
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax        NUMERIC,
  p_quote_date  DATE,
  p_source      TEXT DEFAULT 'bcb_live'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roe NUMERIC; v_updated INT := 0; v_inv RECORD;
  v_total_brl NUMERIC(14,2); v_pix_payload TEXT; v_discount_usd NUMERIC(12,2);
BEGIN
  v_roe := ROUND(p_ptax * 1.065, 4);   -- 1.065 = constante canônica de markup

  FOR v_inv IN
    SELECT id, total_usd, COALESCE(discount_value,0) AS discount_value,
           discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices
    WHERE status = 'issued' AND paid_at IS NULL    -- 'cancelled'/'paid' já excluídos
    FOR UPDATE
  LOOP
    -- Só recalcula quando a PTAX (roe) realmente mudou
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;

    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      IF v_inv.discount_mode = 'percent'
        THEN v_discount_usd := v_inv.total_usd * (v_inv.discount_value / 100);
        ELSE v_discount_usd := v_inv.discount_value;   -- fixo em USD
      END IF;
    END IF;

    v_total_brl   := ROUND((v_inv.total_usd - v_discount_usd) * v_roe, 2);
    v_pix_payload := public.<build_pix_payload>(v_total_brl, v_inv.doc_number);  -- confirmar assinatura real

    UPDATE public.demurrage_invoices
    SET current_roe = v_roe, current_total_brl = v_total_brl,
        roe_source = p_source, pix_payload = v_pix_payload, updated_at = now()
    WHERE id = v_inv.id;

    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date);
END;
$$;
REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) TO service_role;
```

> Nota: `build_pix_payload(total_brl, doc_number)` é ilustrativo — confirmar o nome/assinatura
> reais do builder PIX existente (`pix_tlv`/`pix_crc16_ccitt`, baseado em `p_txid`) antes de escrever.

**1.4 RPC wrapper manual `recalculate_demurrage_invoices_manual`** (autenticada)

```sql
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(p_ptax, CURRENT_DATE, 'manual');
END; $$;
```

**1.5 Edge Function agendada** (dias úteis, após ∼14h)
- Busca a PTAX com a **política do sistema antigo**: `CotacaoDolarPeriodo`, ∼10 dias, `top 1` desc;
  extrai `cotacaoVenda` e `dataHoraCotacao`.
- Em sucesso, chama `recalculate_demurrage_invoices(ptax, dataHoraCotacao, 'bcb_live')` via
  `service_role`.
- Em erro HTTP/rede (API fora): aborta e loga (não recalcula). O caminho manual cobre esse caso raro.
- pg_cron puro não serve (precisa de HTTP externo).

**1.6 Banner de staleness + botão manual** (`/demurrage`)
- Ao carregar a página, checar se há recálculo do dia (entrada recente em `demurrage_invoice_history`).
- Se faltar (API fora / job falhou), exibir banner: "PTAX de hoje não obtida do BCB. Informar
  manualmente." com botão "Informar PTAX".
- Botão "Informar PTAX" sempre disponível no header → modal → `recalculate_demurrage_invoices_manual`.
- **Não** existe "modal automático" (não há canal server→browser).

**Arquivos:** migrations novas (history, rename, RPC núcleo, wrapper manual); Edge Function nova;
`src/services/demurrage/demurrageKpis.ts` (exportar `recalculateInvoicesManual(ptax)`);
`src/pages/Demurrage.tsx` (banner + modal PTAX).

---

### FASE 2 — Simplificação do fluxo de criação + emissão automática

**Dependências:** Fase 1 · **Esforço:** Média

**2.1 `create_demurrage_invoice_with_items`**
- Status padrão `issued`; `due_date` removido (nulo); `billed_at`/`first_billed_at` = `CURRENT_DATE`.
- Grava a **foto inicial** em `demurrage_invoice_history` (`source` conforme origem da PTAX).

**2.2 Emissão automática na importação**
- `containerDatesImport.ts`: quando a importação registra que **todos** os containers de um B/L
  voltaram e há demurrage > 0, **cria a invoice `issued` automaticamente** com `total_usd` travado
  (espelha `checkAndMigrateBLs`). Devolução parcial não cria nada.
- Reimportação para um B/L **já com fatura emitida e não paga**: **não sobrescreve** — sinaliza
  divergência ao operador. Fatura paga: intocável.
- `createInvoiceForBL()` / `createInvoiceForReturnedBL()`: após criar, buscar ROE e gravar a foto
  inicial; sem ida ao `draft`.

**2.3 Remover job `mark_overdue_invoices`** — migração dropando job + função (Demurrage; avaliar
impacto em taxas locais separadamente).

**2.4 UI** — remover aba "Rascunhos"; "Emitidas" vira "Faturas"; remover coluna "Vencimento", badge/
filtros `overdue`, botões "Emitir"/"Desemitir". Adicionar ação **"Cancelar"** (explícita, auditada).

**Arquivos:** migration alterando `create_demurrage_invoice_atomic`; migration dropando
`031_overdue_enforcement` (parte demurrage); `demurrageInvoices.ts`; `containerDatesImport.ts`;
`Demurrage.tsx`; `PortalBilling.tsx`.

---

### FASE 3 — Descontos em USD

**Dependências:** Nenhuma · **Esforço:** Baixa

- Modal: label `fixed` = "Valor fixo (USD)"; helper "Valor em dólares".
- Cálculo (sempre USD antes da conversão):
  `discounted_usd = total_usd − fixo` ou `total_usd × (1 − %/100)`; `total_brl = discounted_usd × roe`.
- `discount_usd` registrado no histórico pela RPC de recálculo (Fase 1).

**Arquivos:** `demurrageInvoices.ts`; `InvoiceDocument.tsx`; `Demurrage.tsx`.

---

### FASE 4 — Visão por consignatário

**Dependências:** Nenhuma · **Esforço:** Média · **Risco:** Baixo (relatório/agregação)

- `fetchCustomerDemurrageSummary()` e `fetchCustomerDemurrageDetail(customerId)` agregando
  faturas `status='issued' AND paid_at IS NULL` por cliente; total USD estável + total BRL
  (snapshot do último recálculo).
- Nova aba "Por Cliente" (accordion) + relatório PDF (`window.print()`).

**Arquivos:** `demurrageKpis.ts`; `Demurrage.tsx`; `CustomerSummaryReport.tsx` (**novo**).

---

### FASE 5 — Visão de containers (monitoramento operacional)

**Dependências:** Nenhuma · **Esforço:** Média

- **Operacional, não faturamento.** Mostra containers ainda fora (`overdue`, demurrage correndo até
  hoje) **e** devolvidos com demurrage > 0. Não gera fatura (a emissão só ocorre quando todos voltam).
- `listDemurrageContainers()`: incluir `returned`; `.in('demurrage_status', ['overdue','returned'])`;
  excluir no frontend os `returned` dentro do free time. Cálculo via `calculateDemurrage()`.
- Colunas: free time, dias em excesso, dias P1/P2, total USD. Agrupamento por B/L.

**Arquivos:** `demurrageContainers.ts`; `Demurrage.tsx`.

---

### FASE 6 — Data de referência no documento

**Dependências:** Fase 1 · **Esforço:** Baixa

- Abaixo do título: "Valores calculados em DD/MM/AAAA com PTAX de R$ x,xxxx (fonte: …)", a partir do
  **último recálculo armazenado** (push). `roe_source`: `bcb_live`→"BCB", `cached`→"BCB (cache)",
  `manual`→"Informada manualmente".
- Mesmo texto no documento do portal.

**Arquivos:** `InvoiceDocument.tsx`; `InvoiceDocumentKit.tsx` (se necessário).

---

### FASE 7 — Conciliação PIX por txid + janela das duas PTAX

**Dependências:** Fase 1 · **Esforço:** Alta · **Reescrita** (substitui o `get_demurrage_value_on_date`)

**7.1 RPC `get_demurrage_recent_values(invoice_id, payment_date)`**

Retorna as **duas entradas de recálculo mais recentes** em `demurrage_invoice_history` com
`event_date <= payment_date` (ordenado `event_date DESC, id DESC`). Pular fins de semana é natural
(não há linhas sem mudança de PTAX). Fallback: se não houver histórico, usa `current_total_brl`.

```sql
CREATE OR REPLACE FUNCTION public.get_demurrage_recent_values(p_invoice_id BIGINT, p_date DATE)
RETURNS TABLE(total_brl NUMERIC, event_date DATE, ptax_used NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT total_brl, event_date, ptax_used
  FROM public.demurrage_invoice_history
  WHERE invoice_id = p_invoice_id AND event_date <= p_date
  ORDER BY event_date DESC, id DESC
  LIMIT 2;
$$;
```

**7.2 Conciliação** (substitui a lógica antiga)
- **Identificar a fatura por `txid = doc_number`** (normalizado) — caminho primário.
- **Validar o valor pago** contra os valores de `get_demurrage_recent_values(invoice_id, p_paid_at)`
  (tolerância R$ 0,01). Casa com qualquer um dos dois → pagamento válido.
- Fallback (txid ausente/ilegível): CNPJ + a mesma janela das duas PTAX.
- Sem match em nenhum dos dois valores → **divergência** (tratamento manual). Sem pagamento parcial.

**7.3 Registrar pagamento no histórico** — inserir linha `source='payment'` com o valor casado;
setar `paid_at = p_paid_at`; encerrar o recálculo daquela invoice.

**7.4 `reconciliacao.ts`** — `matchUnifiedPixTransactions()` passa a casar por txid e validar pela
janela; `reverseDemurragePayment()` mantido.

**Arquivos:** migration nova (`get_demurrage_recent_values`); alterar
`confirm_demurrage_pix_matches_batch.sql`; `reconciliacao.ts`; `Reconciliacao.tsx` (se necessário).

---

### FASE 8 — Portal do Cliente (push/armazenado)

**Dependências:** Fase 1, Fase 6 · **Esforço:** Média

- Lista (`portal_list_demurrage_invoices`): Nº Doc, BL, **USD (fixo = `total_usd`)**, **BRL
  (dinâmico = `current_total_brl`)**, data de referência (último recálculo), status.
- Detalhe (`portal_get_demurrage_invoice_detail`): PTAX e data de referência; itens com subtotais
  USD; badge "Valores atualizados em DD/MM/AAAA".
- **Sem recálculo on-demand** — exibe sempre o último recálculo armazenado; valor exibido == valor do
  QR == histórico.
- Dashboard do portal: usar `current_total_brl`.
- Sem notificação a cada recálculo.

**Arquivos:** `portal_ce_mercante_gate.sql` (RPCs); `PortalBilling.tsx`; `PortalDashboard.tsx`;
`portalBilling.ts` (se necessário).

---

## Mapa de dependências

```
Fase 1 (Recálculo + Histórico + rename + Edge Function)
  ├──→ Fase 2 (Simplificação + emissão automática)
  ├──→ Fase 6 (Data referência)
  ├──→ Fase 7 (Conciliação por txid + janela duas PTAX)
  └──→ Fase 8 (Portal push)
Fase 3 (Descontos USD) — independente
Fase 4 (Visão cliente)  — independente
Fase 5 (Visão containers, operacional) — independente
```

## Ordem sugerida

```
Fase 1 → Fase 2 → (Fase 3 + Fase 4 + Fase 5 em paralelo) → Fase 6 → Fase 7 → Fase 8
```
