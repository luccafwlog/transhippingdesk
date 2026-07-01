# BL — Redesenho das 5 abas do detalhe

**Data:** 2026-06-19
**Status:** Design (aguardando review do spec)
**Tela:** `src/pages/BlDetalhe.tsx` + `src/components/bl/*` (detalhe de B/L, 5 abas)

## Contexto

O detalhe do B/L tem 5 abas: Operacional, Carga, Cobranças, Financeiro,
Histórico. A edição manual é auditada via RPC `save_bl_review`
(`compute_bl_review_pendencies` recalcula `review_status` no servidor). Os dados
chegam por `useBlDetail` (`select *`, todas as colunas disponíveis).

Mapa atual:

| Aba | Responsabilidade | Persistência |
|-----|------------------|--------------|
| Operacional | Form de edição manual (rota, partes, carga, comercial) | `save_bl_review` + justificativa + auditoria por campo |
| Carga | Containers (devolução + demurrage inline) e veículos; ou resumo BB + tabela de partes + itens legados | `updateContainerReturnDate` |
| Cobranças | Taxas locais: calcular, other charges, marcar revisado, pronto p/ faturar (emite fatura) | hooks `useLocalCharges` + `markBlReadyAndCreateInvoice` |
| Financeiro | Cliente (vincular/criar/conciliação), info financeira, overrides de demurrage P1/P2 | `save_bl_review` (cliente) + `supabase.update` direto (demurrage) |
| Histórico | Lista de auditoria | leitura |

### Problemas estruturais

1. **Duplicação.** Shipper/Consignee/Notify aparecem em Operacional (editável) e
   na tabela BB de Carga (leitura). Trecho POL→POD, CE Mercante e quantidade de
   carga aparecem em Operacional, Carga e Financeiro.
2. **Cobranças vs Financeiro confuso.** Nomes não revelam função: "Cobranças" =
   taxas locais + emitir fatura; "Financeiro" = cliente + demurrage.
3. **Demurrage espalhado por 3 abas.** `free_time_override` (Operacional), taxas
   P1/P2 (Financeiro), cálculo/datas de devolução (Carga).
4. **Auditoria inconsistente.** Operacional e vínculo de cliente passam por
   `save_bl_review`; overrides de demurrage usam `supabase.update` direto — sem
   auditoria.

## Objetivos (confirmados)

- Eliminar duplicação (um único dono por dado).
- Clarear a estrutura de abas (resolver Cobranças vs Financeiro).
- Consolidar demurrage num único lugar.
- Sequência: **um único redesenho** unificado (o rework da Operacional faz parte).

## Arquitetura de informação alvo (3 abas)

As 5 abas atuais colapsam em 3: **Detalhes do B/L** (Operacional + Carga),
**Faturamento** (Comercial + Cobranças + Demurrage) e **Histórico**.

### Aba 1 — "Detalhes do B/L" (Operacional + Carga)

**Bloco de edição** (formulário único auditado via `save_bl_review`, seções
nomeadas separando somente-leitura de editável):
1. **Rota & Viagem** — Armador/Navio/Viagem *(RO)*, POL, POD, CE Mercante
2. **Partes** — Shipper, Consignatário, Notify Party
3. **Carga** — NCM *(chips RO)*, Descrição da carga; *(container)* Peso/CBM;
   *(BB)* Máquinas/Packages/Packages Total/Weight/CBM
4. **Comercial** — Pagamento (PREPAID/COLLECT)
5. **Revisão & Auditoria** — Status de revisão *(RO)*, Notas, Justificativa
   *(obrigatória)*, botão Salvar

**Bloco de composição física** (somente leitura, abaixo do formulário):
- *(container)* tabela de containers (nº, seal, tipo, peso, CBM, OOG, IMO,
  descarga) + tabela de veículos (busca por chassi)
- *(BB)* resumo numérico + itens legados

- ❌ Removidos da UI: **Place of Delivery**, **Incoterm** (colunas mantidas, sem
  migração); a **tabela de partes** do BB (duplica o bloco Partes acima);
  `free_time_override` e as colunas de devolução/demurrage migram para a aba
  Faturamento.

### Aba 2 — "Faturamento" (Comercial + Cobranças + Demurrage)

- **Cliente**: vinculado (nome/CNPJ/saldo), Dados do manifesto + "Cadastrar e
  vincular", Conciliação, Vincular/Desvincular (busca). ❌ Sem o card
  "Informações financeiras" (duplicação de modo/CE/trecho/qtd).
- **Taxas locais & fatura**: motor de cálculo, other charges manuais, marcar
  revisado, pronto p/ faturar; link da "Fatura ativa" + `financial_status`
  (movidos do cabeçalho da Operacional).
- **Demurrage (consolidado)**: config do B/L (`free_time_override`, taxas P1/P2)
  **acima** da tabela por container (descarga, data de devolução editável,
  cálculo). Toda escrita passa a usar `save_bl_review` (corrige a auditoria).

### Aba 3 — "Histórico" (linha do tempo completa do B/L)

Decidido em sessão grill-me-with-docs (ver Componente G):
- **Escopo**: linha do tempo completa do B/L — não só a auditoria de campos.
  Inclui edições de campo (`bl`), mudanças em container (`bl_container`), taxas
  (`charge_calculation`/`charge_status`), faturas (`invoice`) e os
  `system_event` que carregam `bl_id` (ex.: `bl_review_concurrent_conflict`).
  Ficam de fora os `system_event` globais (`entity_id='billing'`).
- **Terminologia**: "Histórico" é o guarda-chuva; "Auditoria" é o subconjunto com
  justificativa (ver `docs/GLOSSARIO.md`). O cabeçalho "Auditoria" da aba é
  renomeado para "Histórico".
- **Montagem**: RPC server-side `bl_timeline(bl_id)` (Componente G), não os dois
  `eq()` de hoje.
- **Apresentação**: eventos humanizados por família, com badge (Edição ·
  Container · Taxas · Fatura · Sistema) e frase legível; paginação por
  "carregar mais" (em vez do range fixo 0–199).

### Mapa de eliminação de duplicação

| Dado | Hoje (vários lugares) | Dono único alvo |
|------|----------------------|-----------------|
| Shipper/Consignee/Notify | Operacional (edit) + Carga BB (RO) | Detalhes do B/L (form) |
| Trecho POL→POD | Operacional + Carga + Financeiro | Detalhes do B/L (form) |
| CE Mercante | Operacional + Carga + Financeiro | Detalhes do B/L (form) |
| Qtd. de carga | Carga + Financeiro | Detalhes do B/L (composição) |
| Fatura ativa / status financeiro | Cabeçalho Operacional | Faturamento |
| Free time / P1 / P2 / devolução | Operacional + Financeiro + Carga | Faturamento → Demurrage |

## Componente A — Remoções (Place of Delivery, Incoterm)

- `BlOperacionalTab.tsx`: remover os dois `<Field>`.
- `useBlEditForm.ts`: remover `place_of_delivery` e `incoterm` de `editableFields`
  (union + array) e de `makeForm`.
- Sem migração; colunas e auditoria preservadas.

## Componente B — Campo NCM (derivado, somente leitura)

- Fonte = `cargo_description` (informado no manifesto).
- Extrair lista **deduplicada** de NCMs reaproveitando a regex hoje privada em
  `breakbulkImport.ts` (`extractNcmCodes`), promovida a helper compartilhado
  `src/lib/ncm.ts` (evita divergência entre importador e tela).
  - **Excluir** ocorrências precedidas por `UN ` (ex.: `UN NCM.:3556` é número UN
    de carga perigosa, não NCM). Alinhar com `extractUnNumber`.
  - Preservar o código como escrito/normalizado (`8703.80.00`, `2923`).
- UI: chips somente-leitura na seção Carga da Operacional. Vazio: "Nenhum NCM
  identificado na descrição.".
- Sem nova coluna, sem migração.

## Componente C — Notify Party (parser de manifesto container, forward only)

Objetivo: popular `bls.notify_party` na importação de manifestos container.

Formato analisado a partir de duas amostras reais (coluna G = bloco de partes;
cabeçalho declara `SHIPPER/CONSIGNEE` + `NOTIFY PARTY/NOTIFY PARTY2`):
- **Modelo 1 (Vitória):** marcadores explícitos (`COMPANY:`, `ADDRESS:`, `CNPJ:`,
  `NAME:`, `E-MAIL:`); notify é a linha final literal `SAME AS CONSIGNEE`.
- **Modelo 2 (Salvador):** sem marcadores — blocos empilhados: shipper, consignee
  (primeiro CNPJ), depois NOTIFY PARTY e às vezes NOTIFY PARTY2.

Implementação:
1. Adicionar `notify_party` a `ParsedBL` (`manifestParser.ts`) e ao `blPayload`
   de `manifestImport.ts` (hoje carrega `consignee`, não `notify_party`).
2. `parseManifestParty` passa a retornar `notify_party`:
   - literal `SAME AS CONSIGNEE` → guardar o texto literal;
   - caso contrário, após o bloco do consignee (CNPJ + contatos), tomar o
     **primeiro** bloco de parte seguinte (nome + detalhes até o próximo CNPJ).
   - guardar **apenas a primeira** notify party (ignorar NOTIFY PARTY2).
3. Alias `notify_party: ['notify', 'notify party']` no `headerMap`
   (`parseHeaderMappedManifest`).
4. **Forward only**: sem backfill; campo permanece editável manualmente.

**Risco aceito:** Modelo 2 (sem marcadores) é o mais difícil; heurística pode
errar a fronteira consignee/notify. Mitigação: campo editável + forward only +
testes com as duas amostras.

## Componente D — Carga: remover duplicação

- Remover a **tabela de partes** (Shipper/Consignee/Notify/POL/POD) do modo BB —
  esses dados são editados em Operacional.
- Mover as colunas/lógica de **devolução + demurrage** da tabela de containers
  para a aba Faturamento (Componente F). A tabela de Carga mantém só composição
  física (nº, seal, tipo, peso, CBM, OOG, IMO, descarga).

## Componente E — Cliente: extrair card para a aba Faturamento

- **Seção Cliente** dentro da aba Faturamento (não é aba nova), a partir do card
  "Cliente" do `BlFinanceiroTab` (cliente vinculado, dados do manifesto +
  cadastrar/vincular, conciliação, busca de vínculo). Lógica de
  `handleLinkCustomer` / `handleCreateManifestCustomer` preservada.
- **Remover** o card "Informações financeiras" (duplicação pura).

## Componente F — Faturamento: renomear + consolidar demurrage

- Renomear aba "Cobranças" → **Faturamento** (chave `tab`, label, rotas internas).
- Mover para o topo desta aba o link da **Fatura ativa** + `financial_status`
  (hoje no cabeçalho da Operacional).
- **Seção Demurrage** (consolida 3 lugares):
  - Config do B/L: `free_time_override`, `demurrage_rate_override_p1_usd`,
    `demurrage_rate_override_p2_usd`.
  - Tabela por container: descarga, data de devolução (editável), cálculo
    (`calculateDemurrage`), reaproveitando `updateContainerReturnDate`.
  - **Auditoria**: substituir o `supabase.update` direto dos overrides por
    `save_bl_review` (mesmo caminho auditado do resto do B/L). Além disso,
    `updateContainerReturnDate` (hoje sem auditoria) passa a gravar um evento em
    `audit_logs` (`entity_type='bl_container'`, `entity_id`=container) para que a
    mudança de data de devolução apareça na linha do tempo (Componente G).

## Componente G — RPC `bl_timeline` + apresentação do Histórico

Objetivo: montar a linha do tempo completa do B/L (Aba 3) consolidando famílias
de evento que hoje vivem em `audit_logs` sob chaves heterogêneas.

1. **RPC `bl_timeline(p_bl_id)`** (`security definer`, respeitando o papel/RLS de
   leitura de `audit_logs` da migração `014_lock_down_financial_reads_and_audit_writes`).
   UNION resolvido ao `bl_id`, ordenado por `changed_at desc`, com paginação
   (`p_limit`/`p_offset` ou cursor):
   - `entity_type='bl'` → `entity_id = bl_id` (direto)
   - `entity_type='bl_container'` → join `bl_containers.bl_id`
   - `entity_type IN ('charge_calculation','charge_status')` → join
     `charge_calculations.bl_id`
   - `entity_type='invoice'` → join `invoice_bls.bl_id`
   - `entity_type='system_event'` **apenas** quando `entity_id = bl_id`
     (inclui `bl_review_concurrent_conflict`); exclui os globais (`'billing'`).
2. **Hook** `useBlTimeline(blId)` (React Query) substitui `useAuditLogs('bl', …)`
   na Aba 3, com "carregar mais".
3. **Apresentação humanizada por família**: mapa `(entity_type, field_name)` →
   rótulo + badge (Edição · Container · Taxas · Fatura · Sistema) + frase legível
   (ex.: "Fatura INV-2026-0103 emitida", "Other charge THC adicionado (R$ 500)").
   Entradas com `justification` são marcadas como auditoria.

## Fora de escopo / riscos

- **Migração necessária**: criar o RPC `bl_timeline` (Componente G). Os demais
  componentes não alteram esquema; `save_bl_review` mantém o contrato.
- Riscos comportamentais: (a) parser de Notify Party (layout do manifesto);
  (b) overrides de demurrage passam a exigir `expected_updated_at` ao migrar para
  `save_bl_review` — validar conflito concorrente como nas demais escritas;
  (c) `bl_timeline` precisa respeitar a RLS de `audit_logs` (não vazar eventos
  financeiros a papéis sem permissão).
- `npm run docs:check` após mudanças de markdown/ADR; edições de componente
  passam pelo hook de lint de TypeScript.

## Testes

- Unit `src/lib/ncm.ts`: NCM real vs UN, múltiplos NCMs, dedupe, vazio.
- Unit `manifestParser`: notify Modelo 1 (`SAME AS CONSIGNEE`), Modelo 2 (1ª de
  duas), ausência de notify; persistência via `manifestImport` carrega `notify_party`.
- RPC `bl_timeline`: une as 4 famílias resolvidas ao `bl_id`, inclui
  `system_event` com `bl_id` e exclui os globais, ordena por `changed_at desc`,
  pagina; respeita RLS por papel.
- Render por aba: Detalhes do B/L sem Place of Delivery/Incoterm e com chips de
  NCM, sem tabela de partes do BB; Faturamento com Cliente, Fatura ativa, seção
  Demurrage e auditoria do override; Histórico humanizado por família com
  "carregar mais".
