# BL — Rework da aba Operacional

**Data:** 2026-06-19
**Status:** Design aprovado (aguardando review do spec)
**Tela:** `src/components/bl/BlOperacionalTab.tsx` (aba Operacional do detalhe de B/L)

## Contexto

A aba Operacional exibe um formulário de edição manual com auditoria campo a
campo. O estado vive em `useBlEditForm` (`BlForm` / `editableFields` /
`makeForm`); os dados chegam por `useBlDetail` (`select *`, então todas as
colunas já estão disponíveis). A submissão usa o RPC `save_bl_review`, que
recalcula `review_status` no servidor e grava a auditoria por campo.

Quatro mudanças foram solicitadas, mais uma reorganização visual de média
intensidade. Duas das mudanças (Notify Party e NCM) não são ajustes de UI —
exigem trabalho na camada de dados / parser.

## Decisões (confirmadas com o usuário)

1. **Place of Delivery** e **Incoterm**: remover apenas da UI/formulário. Colunas
   do banco permanecem (sem migração).
2. **NCM**: derivar da `cargo_description` (fonte da verdade é o manifesto).
   Exibição **somente leitura** em chips. Excluir números UN.
3. **Notify Party**: extrair no parser de manifesto **container** (`manifestParser.ts`),
   apenas **forward** (sem backfill de B/Ls existentes). Campo permanece
   editável manualmente.
   - Quando houver duas partes (NOTIFY PARTY / NOTIFY PARTY2): armazenar **apenas
     a primeira**.
   - Quando for "SAME AS CONSIGNEE": armazenar o **texto literal**.
4. **Reorganização**: média — agrupar campos em seções nomeadas, separando
   somente-leitura de editável. Sem alterar o fluxo `save_bl_review` nem a
   auditoria.

## Formato dos manifestos (analisado a partir de 2 amostras)

Parser relevante: `parseCarrierManifest` → `parseManifestParty` (coluna G contém
o bloco de partes; coluna D a descrição da carga).

O cabeçalho da coluna G declara até quatro partes em ordem:
`SHIPPER / CONSIGNEE` + `NOTIFY PARTY / NOTIFY PARTY2`.

- **Modelo 1 (Vitória):** bloco com marcadores explícitos (`COMPANY:`,
  `ADDRESS:`, `CNPJ:`, `NAME:`, `E-MAIL:`) e a notify party é a linha final
  literal **`SAME AS CONSIGNEE`**. Descrição traz `NCM : 8703.80.00` **e** um
  enganoso `UN NCM.:3556` (número UN de carga perigosa — deve ser ignorado).
- **Modelo 2 (Salvador):** bloco **sem marcadores** — blocos de parte empilhados:
  shipper, consignee (primeiro CNPJ), depois **NOTIFY PARTY** e por vezes
  **NOTIFY PARTY2**. Descrição traz `NCM NUMBER:2923` (4 dígitos).

## Componente A — Remoções (Place of Delivery, Incoterm)

- `BlOperacionalTab.tsx`: remover os dois `<Field>`.
- `useBlEditForm.ts`: remover `place_of_delivery` e `incoterm` de
  `editableFields` (union de tipo + array) e de `makeForm`.
- Sem migração. Colunas preservadas; auditoria e demais consumidores intactos.

## Componente B — Campo NCM (derivado, somente leitura)

- Extrair lista **deduplicada** de NCMs de `cargo_description`.
- Reaproveitar a regex hoje privada em `breakbulkImport.ts` (`extractNcmCodes`),
  promovendo-a a um helper compartilhado `src/lib/ncm.ts` para evitar
  divergência de implementação entre importador e tela.
  - O helper deve **excluir** ocorrências precedidas por `UN ` (ex.: `UN NCM.:3556`),
    distinguindo NCM real de número UN. Reaproveitar/alinhar com a lógica de
    `extractUnNumber`.
  - Preservar o código como escrito/normalizado (ex.: `8703.80.00`, `2923`).
- UI: exibir na seção **Carga** como chips somente leitura. Estado vazio:
  "Nenhum NCM identificado na descrição.".
- Sem nova coluna, sem migração. A edição acontece editando a descrição.

## Componente C — Notify Party (parser, forward only)

Objetivo: popular `bls.notify_party` na importação de manifestos container.

1. **Tipo + persistência:** adicionar `notify_party` a `ParsedBL`
   (`manifestParser.ts`) e ao `blPayload` de `manifestImport.ts` (hoje carrega
   `consignee` mas não `notify_party`).
2. **Extração** (`parseManifestParty`, retornar também `notify_party`):
   - Se o bloco contém o literal `SAME AS CONSIGNEE` → `notify_party = "SAME AS CONSIGNEE"`.
   - Caso contrário, localizar o fim do bloco do consignatário (após o CNPJ do
     consignee e seus contatos) e tomar o **primeiro** bloco de parte seguinte
     (nome da empresa + detalhes até o próximo CNPJ) como notify party.
   - Armazenar **apenas a primeira** notify party (ignorar NOTIFY PARTY2).
3. **Defensivo:** adicionar alias `notify_party` ao `headerMap`
   (`['notify', 'notify party']`) para manifestos mapeados por cabeçalho
   (`parseHeaderMappedManifest`).
4. **Forward only:** sem backfill. B/Ls já importados permanecem em branco até
   reimportação; o campo continua editável manualmente.

**Risco aceito:** o Modelo 2 (sem marcadores) é a parte mais difícil; a heurística
pode errar a fronteira consignee/notify. Mitigação: campo editável + forward only
(operador corrige). Testes cobrindo ambos os modelos com as duas amostras reais.

## Componente D — Reorganização da tela (média)

Substituir o grid plano por seções nomeadas, separando somente-leitura de
editável. Formulário único de edição-com-auditoria e fluxo `save_bl_review`
inalterados — mudança puramente de apresentação + add/remove de campos.

1. **Rota & Viagem** — Armador/Navio/Viagem *(somente leitura)*, POL, POD, CE Mercante
2. **Partes** — Shipper, Consignatário, Notify Party
3. **Carga** — Peso total / CBM *(container)* ou Máquinas / Packages / Packages Total /
   Weight / CBM *(breakbulk)*; **NCM** *(chips, somente leitura)*; Descrição da carga
4. **Comercial & Financeiro** — Pagamento, Free time override
5. **Revisão & Auditoria** — Status de revisão *(somente leitura)*, Notas,
   Justificativa *(obrigatória)*, botão Salvar

## Fora de escopo / riscos

- Sem migração de banco. Sem mudança em `save_bl_review` nem na auditoria.
- Único risco comportamental: parser de Notify Party (depende do layout do manifesto).
- `npm run docs:check` se houver mudança em markdown/ADR; edições de componente
  passam pelo hook de lint de TypeScript.

## Testes

- Unit do helper `src/lib/ncm.ts`: NCM real vs UN, múltiplos NCMs, dedupe, vazio.
- Unit do parser de notify (`manifestParser`): Modelo 1 (`SAME AS CONSIGNEE`),
  Modelo 2 (primeira de duas notify parties), ausência de notify.
- Render da aba: seções presentes, Place of Delivery/Incoterm ausentes, chips de NCM.
