# Demurrage

> **Status:** ativo · **Atualizado:** 2026-06-24 · **Rotas:** `/demurrage`, `/demurrage/taxas`

## Propósito e escopo

Demurrage acompanha descarga e devolução de containers, resolve free time e
tarifas P1/P2, calcula a sobreestadia em USD e mantém invoices próprias cujo
total BRL é **recalculado diariamente pela PTAX até o pagamento** (USD travado na
emissão; ROE/BRL congelam só no pagamento — ver
[ADR 0014](../adr/0014-demurrage-recalculo-diario-substitui-roe-congelado.md) e
[ADR 0015](../adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md)).
As rotas internas ficam sob
`ProtectedRoute` em [`src/App.tsx`](../../src/App.tsx); a interface de tarifas
expõe mutações apenas para admin, enquanto as policies e RPCs continuam sendo a
fronteira efetiva de autorização.

O domínio não pertence ao ledger de taxas locais. Datas vivem em
`bl_containers`; configuração por B/L, em `bls`; tarifas, em
`demurrage_rates`; documentos e itens, em `demurrage_invoices` e
`demurrage_invoice_items`. A experiência é agregada em `/faturamento`,
`/reconciliacao` e `/portal/billing`, mas a persistência continua separada,
conforme a [ADR 0008](../adr/0008-demurrage-integrado-sem-unificar-persistencia.md).

Fontes executáveis principais:

- [`src/pages/Demurrage.tsx`](../../src/pages/Demurrage.tsx) e
  [`src/pages/DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx);
- [`src/components/bl/BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx)
  na aba `faturamento` do B/L;
- serviços em [`src/services/demurrage/`](../../src/services/demurrage/);
- importação de datas em
  [`src/services/containerDatesImport.ts`](../../src/services/containerDatesImport.ts);
- documento imprimível em
  [`src/components/demurrage/InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx).

## Anatomia das telas

### `/demurrage`

[`src/pages/Demurrage.tsx`](../../src/pages/Demurrage.tsx) mantém quatro abas:
`Containers`, `Rascunhos`, `Emitidas` e `Pagas`.

- A aba `Containers` carrega containers com descarga e ainda não marcados como
  `returned`, aceita `?busca=`, filtra por container/B/L/cliente, agrupa por B/L
  e deriva total USD e status com `calculateDemurrage`.
- A barra de KPIs é sempre visível e combina contagem de containers em atraso,
  total USD da lista filtrada, rascunhos em USD e emitidas em BRL.
- `Importar Datas` abre
  [`src/components/shared/ContainerDatesImportModal.tsx`](../../src/components/shared/ContainerDatesImportModal.tsx):
  parseia planilha, mostra preview e erros, atualiza datas e pode criar/emitir
  invoice quando todos os containers do B/L foram devolvidos.
- O modal `Editar datas do container` altera descarga e devolução, validando
  formato e ordem antes da escrita.
- As abas de invoice consultam um status exato por vez (`draft`, `issued` ou
  `paid`). Cada linha abre breakdown, desconto e disputa; ações adicionais
  dependem do status.
- O visualizador de fatura/recibo usa
  [`src/components/demurrage/InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx)
  e o kit compartilhado
  [`src/components/shared/InvoiceDocumentKit.tsx`](../../src/components/shared/InvoiceDocumentKit.tsx);
  `Imprimir` chama `window.print()`.

### `/manifestos/:blId` → aba `faturamento`

[`src/components/bl/BlFaturamentoTab.tsx`](../../src/components/bl/BlFaturamentoTab.tsx)
inclui [`BlDemurrageSection`](../../src/components/bl/BlDemurrageSection.tsx)
como segunda entrada operacional. A seção permite:

- editar `free_time_override` e overrides P1/P2 do B/L;
- definir ou limpar `return_date` por container;
- visualizar descarga e cálculo derivado antes de salvar;
- voltar à tarifa padrão deixando os campos de override vazios.

### `/demurrage/taxas`

[`src/pages/DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) lista
`demurrage_rates` por tipo de equipamento, free days, faixas P1/P2, vigência e
estado ativo. Usuários ativos podem ler; a UI e a policy
`admin_gerencia_demurrage_rates` reservam criar, editar, ativar/desativar e
excluir para admin, conforme
[`supabase/migrations/048_demurrage_rates_table.sql`](../../supabase/migrations/048_demurrage_rates_table.sql).

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/demurrage` · carregar, filtrar e agrupar tracking | Sessão interna; aba `Containers` | `Demurrage`; `groupByBl`; filtro local | `listDemurrageContainers`; `ensureDemurrageRatesLoaded`; `calculateDemurrage` | SELECT em `bl_containers`, `bls`, `customers`, `voyages`, `vessels`; SELECT em `demurrage_rates` | Query `['demurrage-containers']`, `staleTime=60s`; agrupamento e total USD derivados no cliente | Erro de query mostra `InlineError`; falha de tarifas usa grupos estáticos | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts) |
| `/demurrage` · carregar KPIs | Sessão interna | Query montada pela página | `fetchDemurrageKPIs` executa três consultas paralelas | `bl_containers` e `demurrage_invoices` | Query `['demurrage-kpis']`, `staleTime=60s` | Qualquer consulta com erro rejeita o conjunto; a página mantém placeholders | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageKpis.ts`](../../src/services/demurrage/demurrageKpis.ts) |
| `/demurrage` · importar datas | Arquivo com B/L, container e descarga; devolução opcional | `ContainerDatesImportModal.handleFile/handleImport` | `parseContainerDatesFile` → `importContainerDates` → `resolveStatus`; quando todo o B/L retorna, `createInvoiceForReturnedBL` → `fetchROE` → `issueInvoice` | UPDATE em `bl_containers`; possível INSERT em `demurrage_invoices` e `demurrage_invoice_items` | Invalida `['demurrage-containers']`, `['demurrage-invoices']`, `['bl-detail']`; reporta atualizados, inalterados e ausentes | Colunas/datas inválidas ficam no preview; falha de qualquer escrita interrompe o import | **Código:** [`ContainerDatesImportModal.tsx`](../../src/components/shared/ContainerDatesImportModal.tsx), [`containerDatesImport.ts`](../../src/services/containerDatesImport.ts) |
| `/demurrage` · editar descarga e devolução | Descarga obrigatória; devolução vazia ou não anterior | `openEditContainer`; `containerDatesMutation` | `demurrageDatesSchema` → `updateContainerDates` → cálculo de status | UPDATE direto em `bl_containers` | Invalida `['demurrage-containers']`; fecha modal | Validação local bloqueia formato/ordem; constraint do banco rejeita ordem inválida | **Código/Teste:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts) |
| B/L · definir ou limpar devolução | Container do B/L; data opcional | `BlDemurrageSection.handleSaveReturnDate` | `updateContainerReturnDate` recalcula status e chama auditoria best-effort | UPDATE em `bl_containers`; INSERT best-effort em `audit_logs` com `new_value` data ou `null` | Invalida `bl-detail`, `bls` e `['demurrage-containers']` | Falha principal mostra toast; falha de auditoria vai para telemetria e não desfaz a data | **Código/Teste:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`updateContainerReturnDate.audit.test.ts`](../../src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts) |
| B/L · salvar free time | Usuário autenticado; B/L carregado com `updated_at` esperado | `BlDemurrageSection.handleSaveDemurrageConfig` | RPC auditada `save_bl_review` com payload e linha de auditoria | UPDATE de `bls.free_time_override` e INSERT de auditoria dentro da RPC | Invalida `queryKeys.bls.detail(bl.id)` | `PT409` ou `40001` recarrega detalhe e exige nova revisão; outros erros abortam antes dos overrides P1/P2 | **Código:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx), [`021_save_bl_review_stale_fast_fail.sql`](../../supabase/migrations/021_save_bl_review_stale_fast_fail.sql), [`022_save_bl_review_conflict_code_pt409.sql`](../../supabase/migrations/022_save_bl_review_conflict_code_pt409.sql) |
| B/L · salvar overrides P1/P2 | Free time salvo com sucesso; valores vazios ou numéricos | Mesmo handler, etapa posterior à RPC | UPDATE direto em `bls`; auditoria separada best-effort | `bls.demurrage_rate_override_p1_usd`, `bls.demurrage_rate_override_p2_usd`; `audit_logs` | Invalida detalhe do B/L ao concluir | Valor não numérico é bloqueado; falha do UPDATE aborta; falha da auditoria só gera telemetria | **Código:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx) |
| Derivar free time, P1/P2 e status | Tipo, descarga e devolução válidos; tarifas carregadas ou fallback | Tracking, aba do B/L, import e criação de invoice | `calculateDemurrage` resolve tarifa e calcula dias inclusivos de P1/P2 | Sem escrita; lê cache em memória de tarifas | Resultado `within_free_time` ou `overdue`; usado para UI e persistência subsequente | String vazia/data inválida ou devolução anterior lança erro | **Código/Teste:** [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts), [`calculateDemurrage.test.ts`](../../src/services/demurrage/__tests__/calculateDemurrage.test.ts) |
| `/demurrage` · criar invoice para B/L | Cliente vinculado; ao menos um container com `demurrage_status='overdue'` | Botão `Gerar Fatura`; `generateMutation` | `createInvoiceForBL` recalcula cada item, gera `doc_number`, vencimento e `ready_at` | INSERT direto em `demurrage_invoices`, depois INSERT em `demurrage_invoice_items` | Invalida containers, invoices e KPIs | Sem cliente/containers elegíveis lança erro; as duas inserções não formam uma RPC atômica | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · listar invoices | Aba `Rascunhos`, `Emitidas` ou `Pagas` | Query da página | `listDemurrageInvoices({status})` | SELECT em `demurrage_invoices`, `customers`, `bls`, `voyages`, `vessels` | Query `['demurrage-invoices', status]`, `staleTime=30s` | Erro mostra `InlineError` | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · abrir detalhe/breakdown | Invoice selecionada | Botão `Detalhes` ou visualizador | `getInvoiceDetail` carrega cabeçalho e itens em paralelo | SELECT em `demurrage_invoices` e `demurrage_invoice_items` | Query `['demurrage-invoice-detail', id]` | Erro da invoice ou dos itens rejeita a leitura | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · emitir e congelar ROE/BRL | Invoice `draft`; PTAX ao vivo ou cache disponível | `issueMutation` | `fetchROE` → `issueInvoice`; aplica desconto, gera payload PIX | UPDATE direto em `demurrage_invoices`: `status`, datas, `current_roe`, `current_total_brl`, `roe_source`, `pix_payload` | Invalida invoices e KPIs; avisa quando usa cache | BCB sem cache rejeita; erro de UPDATE mantém o rascunho | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageKpis.ts`](../../src/services/demurrage/demurrageKpis.ts), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts), [`049_demurrage_roe_source.sql`](../../supabase/migrations/049_demurrage_roe_source.sql) |
| `/demurrage` · desem emitir | UI oferece para `issued`; confirmação aceita | `handleUnissueInvoice`; `unissueMutation` | `unissueInvoice` | UPDATE direto: volta a `draft`, limpa congelados/payload e recalcula vencimento | Invalida invoices e KPIs | Erro mostra toast; o serviço não adiciona guarda de status própria | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · marcar pago manualmente | UI exibe a ação para invoice `issued`; o serviço também aceita `overdue`; data informada | Modal `Registrar Pagamento`; `payMutation` | Reusa ROE congelado ou busca ROE; `markInvoicePaid` valida status | UPDATE direto em `demurrage_invoices` | Invalida invoices e KPIs | Status incompatível ou ROE indisponível rejeita | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · desmarcar pagamento | UI oferece para `paid`; confirmação aceita | `handleUnmarkInvoicePaid`; `unpayMutation` | `unmarkInvoicePaid` | UPDATE direto para `issued`, `paid_at=null` | Invalida invoices e KPIs | Erro mostra toast; não exige justificativa nem chama o RPC de reversão | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · cancelar invoice | UI oferece no rascunho; confirmação aceita | `handleCancelInvoice`; `cancelMutation` | `cancelDemurrageInvoice` | UPDATE direto de `status='cancelled'` | Invalida invoices e KPIs | Erro mostra toast; o serviço não valida pagamentos/status | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · aplicar ou remover desconto | Invoice visível; percentual entre 0 e 100 ou valor fixo não negativo | Modal `Desconto`; `discountMutation` | `demurrageDiscountSchema` → `updateDemurrageInvoice` | UPDATE direto dos campos de desconto | Invalida invoices e KPIs | Validação rejeita modo/valor inválido; erro do banco mostra toast | **Código/Teste:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`financialValidation.ts`](../../src/services/financialValidation.ts), [`financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts) |
| `/demurrage` · abrir/atualizar disputa | Invoice visível | Modal `Disputa`; `disputeMutation` | `updateDemurrageInvoice` | UPDATE direto de `dispute_open`, assunto, motivo, status e notas | Invalida invoices e KPIs | Não há schema local específico; erro do banco mostra toast | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · imprimir fatura/recibo | Invoice detail carregado; `issued` ou `paid` na UI | Visualizador e botão `Imprimir` | Render React → `window.print()` | Sem escrita | Abre diálogo nativo; fatura usa QR PIX e recibo usa carimbo `PAGO` | Popup/print dependem do navegador; não há geração de PDF no servidor | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx), [`InvoiceDocumentKit.tsx`](../../src/components/shared/InvoiceDocumentKit.tsx) |
| `/reconciliacao` · confirmar PIX | Match por TXID sem ambiguidade; data válida; valor exato | `Reconciliacao.confirmMutation` | `confirmUnifiedPixReconciliation` → RPC `confirm_unified_pix_matches` → lote `confirm_demurrage_pix_matches` | UPDATE em lote de `demurrage_invoices` para `paid`, com `paid_at`, `pix_txid`, `conciliated_by_extract` | Invalida invoices locais/demurrage, KPIs, B/Ls, clientes e histórico | Wrapper rejeita data, origem, valor divergente e contagem parcial | **Código/Teste:** [`reconciliacao.ts`](../../src/services/reconciliacao.ts), [`20260612161000_confirm_unified_pix_matches.sql`](../../supabase/migrations/20260612161000_confirm_unified_pix_matches.sql), [`reconciliacao.test.ts`](../../src/services/__tests__/reconciliacao.test.ts) |
| `/reconciliacao` · reverter baixa | Admin ativo; invoice `paid`; justificativa não vazia | `demurrageReversalMutation` | `reverseDemurragePayment` → RPC `reverse_demurrage_payment` | UPDATE para `issued`, limpa `paid_at`/`pix_txid`; INSERT em `audit_logs` | Invalida invoices de demurrage e histórico | `42501`, invoice ausente, status diferente de `paid` ou justificativa vazia | **Código/Teste:** [`Reconciliacao.tsx`](../../src/pages/Reconciliacao.tsx), [`reconciliacao.ts`](../../src/services/reconciliacao.ts), [`20260614180000_require_justification_on_payment_reversal.sql`](../../supabase/migrations/20260614180000_require_justification_on_payment_reversal.sql), [`reversalJustificationMigration.test.ts`](../../src/services/__tests__/reversalJustificationMigration.test.ts) |
| `/demurrage/taxas` · listar | Usuário interno ativo | Query da página | `listDemurrageRates` | SELECT em `demurrage_rates` | Query `['demurrage-rates']` | Erro mostra `InlineError` | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |
| `/demurrage/taxas` · criar/editar | Admin; tipo de container preenchido | `handleSave` | `upsertDemurrageRate` | UPSERT em `demurrage_rates` | Limpa cache em memória e invalida `['demurrage-rates']` | Validação mínima na UI; policy bloqueia não-admin | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx), [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts) |
| `/demurrage/taxas` · ativar/desativar | Admin | `handleToggleActive` | `toggleDemurrageRateActive` | UPDATE de `active` | Limpa cache em memória e invalida `['demurrage-rates']` | Erro mostra toast | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |
| `/demurrage/taxas` · excluir | Admin | `handleDelete` | `deleteDemurrageRate` | DELETE em `demurrage_rates` | Limpa cache em memória e invalida `['demurrage-rates']` | Erro mostra toast; não há confirmação na página atual | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |

## Estado e dados

- **Queries principais:** `['demurrage-containers']`, `['demurrage-kpis']`,
  `['demurrage-invoices', status]`, `['demurrage-invoice-detail', id]` e
  `['demurrage-rates']`. A aba do B/L também invalida `['bl-detail', blId]` e
  `['bls']`.
- **Estado local da página:** aba, busca, B/L em geração, modais de data,
  detalhe, desconto, disputa, pagamento, documento e aviso de ROE offline.
- **Tarifa efetiva:** precedência
  `override do B/L > demurrage_rates vigente > STATIC_RATE_GROUPS`.
  `ensureDemurrageRatesLoaded` mantém cache em memória por cinco minutos; se a
  leitura falhar antes de existir cache dinâmico ou não houver linhas vigentes,
  usa os grupos estáticos.
- **Datas:** `bl_containers.discharge_date` e `return_date` são a fonte
  operacional. `demurrage_invoice_items` copia datas, dias, tarifas e subtotal
  no momento de criação da invoice.
- **ROE e recálculo diário:** `fetchROE` consulta a PTAX dos últimos dez dias,
  aplica o markup canônico `DEMURRAGE_ROE_MARKUP` (`1,065`, ADR 0014) e usa
  `localStorage['demurrage_roe_cache']` como fallback. Sob recálculo diário, o
  valor em BRL não é congelado na emissão: a RPC `recalculate_demurrage_invoices`
  (`service_role`) reprecifica toda fatura `issued` e não paga quando a PTAX muda,
  grava `current_roe`/`current_total_brl`/`roe_source`, regenera o `pix_payload` e
  insere a foto em `demurrage_invoice_history`. A Edge Function agendada
  [`recalc-demurrage-ptax`](../../supabase/functions/recalc-demurrage-ptax/index.ts)
  busca a PTAX (política do `demurrage-manager`: `CotacaoDolarPeriodo`, ~10 dias,
  `top 1` desc) e chama a RPC em dias úteis. Quando o BCB está fora, o operador usa
  o botão **Informar PTAX** em `/demurrage` →
  `recalculate_demurrage_invoices_manual` (autenticada). Um banner de staleness
  aparece quando há faturas aguardando pagamento e o último recálculo é anterior ao
  último dia útil.
- **Câmbio de display é outro contrato:** o header usa
  [`src/hooks/useExchangeRates.ts`](../../src/hooks/useExchangeRates.ts),
  cache `header_ptax_display`, PTAX sem markup e derivação CNY. Esse valor não é
  o ROE de emissão.
- **PIX:** o payload é montado por
  [`src/lib/pix.ts`](../../src/lib/pix.ts) com valor BRL e `doc_number` como
  TXID. A baixa de demurrage não cria `bl_receivables`,
  `invoice_receivable_links` nem `ledger_settlements`.
- **Portal:** [`src/services/portalBilling.ts`](../../src/services/portalBilling.ts)
  chama `portal_list_demurrage_invoices()` e
  `portal_get_demurrage_invoice_detail(bigint)`. A implementação atual em
  [`20260615220000_portal_ce_mercante_gate.sql`](../../supabase/migrations/20260615220000_portal_ce_mercante_gate.sql)
  resolve o cliente pela sessão, limita a invoices `issued|overdue|paid` e exige
  liberação do B/L para o Portal.

## Fluxos e invariantes

```mermaid
flowchart LR
    Dates["Datas do container<br/>descarga e devolução"] --> Calc["Cálculo<br/>free time + P1/P2"]
    Calc --> Draft["Invoice draft<br/>+ itens snapshot"]
    Draft --> Freeze["Emitir<br/>buscar ROE + congelar BRL/fonte"]
    Freeze --> Issued["issued"]
    Issued --> Manual["paid<br/>baixa manual"]
    Issued --> Pix["paid<br/>conciliação PIX"]
    Issued --> Cancelled["cancelled"]
    Draft --> Cancelled
    Manual --> Reverse["reverse_demurrage_payment<br/>admin + justificativa"]
    Pix --> Reverse
    Reverse --> Issued
```

- `calculateDemurrage` rejeita devolução anterior à descarga; o modal repete a
  validação e
  [`20260609132000_demurrage_date_order_constraints.sql`](../../supabase/migrations/20260609132000_demurrage_date_order_constraints.sql)
  aplica constraints `NOT VALID` a novas escritas/updates. `total_days` não pode
  ser negativo nos itens.
- O free time override desloca as faixas P1/P2 pelo delta; overrides P1/P2
  substituem apenas o valor diário.
- A criação da invoice recalcula e persiste um snapshot. Alterações posteriores
  de datas ou tarifas não reescrevem os itens existentes.
- Sob recálculo diário, a emissão **não** congela o ROE/BRL: ela trava o USD e
  fixa o `current_total_brl` do dia. O congelamento real ocorre no pagamento
  (`source='payment'` no histórico), quando o recálculo daquela fatura cessa. O
  câmbio do header é apenas informativo.
- `localStorage` permite continuidade quando o BCB está indisponível, mas não
  impõe expiração máxima ao cache de ROE. A UI avisa a data do cache quando o
  caminho explícito de emissão recebe `offline=true`.
- `mark_overdue_invoices()` em
  [`supabase/migrations/031_overdue_enforcement.sql`](../../supabase/migrations/031_overdue_enforcement.sql)
  move `issued` vencida para `overdue` diariamente.
- `set_container_discharge_date` em
  [`supabase/migrations/028_demurrage_module.sql`](../../supabase/migrations/028_demurrage_module.sql)
  é um trigger `BEFORE INSERT`: copia `voyages.ata` somente quando o container
  nasce sem descarga. Alterar a ATA depois não propaga a data.
- A maior parte do ciclo interno usa writes diretos em tabelas por
  [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).
  Conciliação e reversão são as fronteiras RPC: lote base
  `confirm_demurrage_pix_matches`, wrapper transacional
  `confirm_unified_pix_matches` e reversão auditada
  `reverse_demurrage_payment`.
- O wrapper unificado valida data, fonte, valor contra `current_total_brl` com
  tolerância de `0,01` e quantidade atualizada antes de chamar o lote base.

## Testes e validação

- [`src/services/demurrage/__tests__/calculateDemurrage.test.ts`](../../src/services/demurrage/__tests__/calculateDemurrage.test.ts)
  cobre free time, P1/P2, grupos estáticos, fallback de tipo, overrides e ordem
  de datas.
- [`src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts`](../../src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts)
  cobre auditoria ao definir e limpar a devolução.
- [`src/services/__tests__/financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts)
  cobre validação de desconto e ordem descarga/devolução.
- [`src/services/__tests__/reconciliacao.test.ts`](../../src/services/__tests__/reconciliacao.test.ts)
  cobre chamada única ao wrapper, data ausente, erro de valor e divergência de
  contagem; testes de migration cobrem a exigência de admin e justificativa na
  reversão.
- [`src/services/__tests__/demurrageKpis.test.ts`](../../src/services/__tests__/demurrageKpis.test.ts)
  testa parsing de datas do extrato PIX, não `fetchDemurrageKPIs`; portanto os
  KPIs permanecem evidência de **Código**, não de teste específico.
- Por instrução desta execução, nenhum Vitest nem cenário de navegador foi
  rodado. Não há selo **Runtime** nesta cartografia.

## Notas e divergências

- **Suspeita — RPC base de PIX:** a função
  `confirm_demurrage_pix_matches(jsonb)` em
  [`20260610094207_confirm_demurrage_pix_matches_batch.sql`](../../supabase/migrations/20260610094207_confirm_demurrage_pix_matches_batch.sql)
  atualiza IDs recebidos sem validar valor, status ou TXID. O caminho suportado
  da UI usa `confirm_unified_pix_matches`, que faz a validação. O risco de
  chamada direta permanece **Suspeita** até teste autorizado contra o banco ou
  endurecimento explícito do contrato base.
- **Código — duas reversões diferentes:** `Desmarcar` em `/demurrage` chama
  `unmarkInvoicePaid` por UPDATE direto, sem justificativa/admin; a reversão em
  `/reconciliacao` chama `reverse_demurrage_payment`, exige admin, justificativa
  e auditoria.
- **Código — auditoria desigual de datas:** a devolução editada pela aba do B/L
  grava `audit_logs` best-effort; o modal geral `updateContainerDates` não grava
  auditoria equivalente para descarga/devolução.
- **Código — criação não atômica:** `createInvoiceForBL` e
  `createInvoiceForReturnedBL` inserem cabeçalho e itens em chamadas separadas.
  Falha na segunda escrita pode deixar uma invoice sem itens.
- **Código — abas não mostram `overdue` nem `cancelled`:** a aba `Emitidas`
  consulta apenas `status='issued'`; invoices movidas para `overdue` pelo cron e
  canceladas não têm aba própria em `/demurrage`.
- **Código — fonte do ROE no import automático:** `containerDatesImport.ts`
  descarta `source` retornado por `fetchROE` e chama `issueInvoice(invoiceId,
  roe)`, cujo default é `bcb_live`. Se o valor veio do cache, `roe_source` pode
  não refletir a origem real.
- **Código — trigger de descarga limitado ao insert:** o trigger não reage a
  mudanças posteriores de `voyages.ata`; correções exigem import ou edição
  explícita das datas.
