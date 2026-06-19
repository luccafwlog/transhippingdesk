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

### Aba 3 — "Histórico"

- Mantida como aba dedicada (decisão do usuário). Conteúdo atual = lista de
  `audit_logs` (`campo: antigo → novo`, data, justificativa); agora cobre também
  os overrides de demurrage, que passam a ser auditados.
- **Conteúdo a revisar antes de fechar o spec** (ver sessão grill-me-with-docs).

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

## Componente E — Comercial: extrair card de cliente

- Nova aba **Comercial** a partir do card "Cliente" do `BlFinanceiroTab`
  (cliente vinculado, dados do manifesto + cadastrar/vincular, conciliação,
  busca de vínculo). Lógica de `handleLinkCustomer` / `handleCreateManifestCustomer`
  preservada.
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
    `save_bl_review` (mesmo caminho auditado do resto do B/L).

## Fora de escopo / riscos

- Sem migração de banco. Sem mudança no contrato de `save_bl_review` nem no
  esquema de auditoria.
- Riscos comportamentais: (a) parser de Notify Party (layout do manifesto);
  (b) overrides de demurrage passam a exigir `expected_updated_at` ao migrar para
  `save_bl_review` — validar conflito concorrente como nas demais escritas.
- `npm run docs:check` após mudanças de markdown/ADR; edições de componente
  passam pelo hook de lint de TypeScript.

## Testes

- Unit `src/lib/ncm.ts`: NCM real vs UN, múltiplos NCMs, dedupe, vazio.
- Unit `manifestParser`: notify Modelo 1 (`SAME AS CONSIGNEE`), Modelo 2 (1ª de
  duas), ausência de notify; persistência via `manifestImport` carrega `notify_party`.
- Render por aba: Operacional sem Place of Delivery/Incoterm e com chips de NCM;
  Carga sem tabela de partes; Comercial sem card de info financeira; Faturamento
  com Fatura ativa e seção Demurrage; auditoria registra override de demurrage.
