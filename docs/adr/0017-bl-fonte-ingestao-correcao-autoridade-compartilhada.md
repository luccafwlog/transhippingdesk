# 0017 — B/L como fonte de ingestão e correção; autoridade compartilhada com o manifesto

Status: aceito — 2026-07-01

## Contexto

O manifesto do armador não carrega o **valor do frete** nem as **despesas**
(THD, BAF, …), obrigatórios para manifestar a carga no Mercante. Esses valores
só existem no **B/L**. A decisão de habilitar o upload do B/L abriu uma questão
que ultrapassa "ler o frete": o `CONTEXT.md` definia o manifesto como *"a
autoridade para dados comerciais e financeiros da carga"*, e o pipeline de
importação ([ADR 0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md))
trata o manifesto como fonte comercial única, com o Baplie apenas como staging
físico.

Ao permitir que o B/L **crie** um B/L inexistente e **corrija** um já emitido
(um B/L é, na prática, corrigido após emissão), o manifesto deixa de ser a
autoridade absoluta. Ao mesmo tempo, campos do B/L (peso, containers) podem
alimentar o cálculo de Taxas Locais (`applicationBasis` `weight_ton` /
`container_distinct_voyage` / `teu` em `src/services/charges/chargeTableService.ts`),
então correções não podem colidir com faturamento já emitido
([ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md)).

O formato de frete do C5 foi validado byte a byte contra um EDI Mercante real e
aceito (ver `docs/superpowers/specs/2026-07-01-bl-freight-import-design.md`):
frete marítimo em campo próprio (offset 1739), despesas no bloco 3796 com código
+ tipo prepaid/collect, valor literal sem conversão de moeda.

## Decisão

1. **O B/L é uma fonte de ingestão e correção**, ao lado do manifesto. Pode
   criar um B/L completo (partes, rota, datas, containers/veículos, frete) e
   corrigir dados comerciais de um B/L existente.

2. **Autoridade compartilhada, com o manifesto como autoridade inicial.** Na
   ingestão o manifesto prevalece; um B/L emitido/corrigido pode sobrescrever
   dados comerciais depois. Toda sobrescrita é **precedida de preview do diff
   (de→para) e confirmada pelo operador**, gravando auditoria com justificativa
   automática. Nada é sobrescrito em silêncio (contraste deliberado com a
   conciliação campo-a-campo do Baplie, que aqui seria cerimônia excessiva).

3. **Proteção de faturamento por campo.** Campos comerciais são sempre
   corrigíveis. **Peso** e **conjunto de containers** só são corrigíveis via
   B/L enquanto o B/L não tiver cálculo de taxa nem invoice; havendo cobrança, a
   correção desses dois campos é bloqueada e sinalizada ao operador. Nenhuma
   correção via B/L recalcula, cancela ou altera cobranças.

4. **Frete & Despesas do BL não integram Taxas Locais.** São dado declarado ao
   Mercante (campo de frete do C5 + bloco de despesas), com moeda original
   preservada apenas para exibição/auditoria e valor gravado literal.

## Consequências

- `CONTEXT.md` redefine **Manifesto** como autoridade *inicial* e **B/L** como
  fonte de ingestão/correção; adiciona **Frete & Despesas do BL**.
- O gerador de EDI passa a preencher o frete marítimo (offset 1739) e o bloco de
  despesas (3796), encerrando a "lacuna de frete" de `docs/modules/manifesto-edi.md`.
- Importar um B/L com peso/containers divergentes de um B/L já faturado é uma
  operação **bloqueada por design**, não um erro — exige tratamento manual.
- Estende, sem revogar, a 0005 (novo caminho de ingestão) e a 0006 (o gate
  financeiro ganha uma barreira adicional na correção via B/L).

## Alternativas consideradas

- **Divergência vira revisão (estilo Baplie).** Resolver campo a campo em uma
  tela de conciliação. Rejeitada: mais passos e código do que o fluxo de
  correção justifica.
- **B/L só completa vazios, nunca sobrescreve.** Não atende ao requisito de
  "B/L corrigido atualiza o sistema".
- **Recalcular taxas quando o B/L muda peso/containers e ainda não faturado.**
  Rejeitada nesta decisão: acopla o import do B/L ao motor de cálculo; a
  proteção escolhida apenas bloqueia quando já faturado e mantém o import
  desacoplado de faturamento.
