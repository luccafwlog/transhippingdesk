# Faturamento: consolidar as abas da tela financeira

> **Status:** proposta aguardando decisão · **Origem:** revisão do fluxo de
> Taxas Locais e Faturamento
> ([auditoria de 2026-08-05](../archive/audits/2026-08-05-revisao-fluxo-taxas-locais-fatura.md))
>
> As Etapas 1 e 2 são de baixo risco e não tocam regra de negócio. A Etapa 3
> depende de decisão do gestor e **não deve ser executada** sem ela.

**Objetivo:** eliminar a sobreposição entre as abas de `/faturamento`, para que
cada aba tenha um papel que as outras não têm.

---

## Diagnóstico

`/faturamento` tem hoje quatro abas: **Faturas**, **Validação**, **Pendências**
e **Demurrage**. Duas delas não se sustentam.

### Pendências é um subconjunto literal da Validação

Não é semelhança conceitual — é identidade técnica. As duas abas chamam a mesma
função (`useLocalChargeOperations`), com o mesmo limite (1200) e sobre a mesma
fonte (`listLocalChargeOperationalRows`). A única diferença é que
`PendenciasFaturamentoTab` fixa `chargeStatus = 'review_required'`.

Esse filtro já existe dentro da Validação de duas formas: o seletor "Status
taxas" → "Revisão", e o passo 2 do funil ("Em revisão"), que é clicável.

A aba separada entrega **menos** sobre as mesmas linhas:

| Recurso | Validação | Pendências |
|---|---|---|
| Seleção múltipla | sim | não |
| Lote: recalcular / revisar / marcar pronto | sim | só recalcular tudo |
| Emissão individual | sim | não |
| Aprovar conciliação de cliente | sim | não |
| Drill-in do B/L | sim | link "Ver B/L" |

O único recurso exclusivo da Pendências é o **recalcular em massa sem
selecionar**. Isso é um botão, não uma aba.

### Demurrage duplica um ambiente que já existe

A própria aba declara isso, em card fixo:

> *"Faturas de demurrage são geradas e gerenciadas em /demurrage. Esta visão
> agrega o acompanhamento financeiro unificado."*

`/demurrage` já tem as abas **Faturas / Pagas / Canceladas**, além de Containers
e Por Cliente, com detalhe e impressão — e lá também se **cria e gerencia**. A
aba em `/faturamento` é somente leitura e **não tem nenhum filtro** (a aba
Faturas tem barra de filtros completa).

**Ressalva:** há um recurso genuíno que só existe aqui. Como `/demurrage`
segrega por status em abas distintas, lá **não se enxerga o total de demurrage
em aberto**. As quatro métricas consolidadas (faturas, em aberto, saldo aberto
BRL, total USD) têm valor; a tabela repetida embaixo delas não.

### A tela promete um financeiro unificado que não entrega

Faturas locais e de demurrage vivem em tabelas separadas (`invoices` e
`demurrage_invoices`). A aba Faturas lê somente `invoices` — **nunca** mostra
demurrage, nem com o filtro de tipo em "Todos". O ledger de recebíveis também
não cobre demurrage.

O resultado é duas listas em duas abas, não uma foto financeira. Hoje o único
lugar que realmente consolida as duas origens é o **Saldo Pendente do Cliente**,
na Ficha do Cliente, que soma local + demurrage com decomposição.

### Validação: o papel mudou e o nome não acompanhou

Desde a [ADR 0020](../adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md), o
cadastro do CE Mercante dispara cálculo, emissão e publicação em cadeia
automática. No caminho normal **ninguém percorre a Validação** — o que sobra
nela é, por construção, o que falhou.

A própria aba já reconhece isso ao exibir
`Pronto faturar: X | Faturado automatico: Y | Diferenca: Z`. O nome "Validação"
promete uma conferência que a tela não faz.

---

## Proposta

Três abas com papéis que não se sobrepõem:

1. **Faturas** — tudo que já foi emitido.
2. **A faturar** — a fila de exceções (Validação + Pendências fundidas).
3. ~~Demurrage~~ — removida; métricas consolidadas migram para Faturas.

---

### Etapa 1 — Fundir Pendências na Validação

**Arquivos:** `src/pages/Faturamento.tsx`,
`src/components/billing/ValidacaoControls.tsx`,
`src/components/billing/PendenciasFaturamentoTab.tsx`,
`src/components/billing/PendenciasTable.tsx`, testes correspondentes.

- [ ] Adicionar ao passo 2 do funil ("Em revisão") a ação **"Recalcular todas em
      revisão"**, preservando o comportamento atual de lote parcial (continua
      após erro e reporta contagem + primeiro erro).
- [ ] Remover a aba `pendencias` de `Faturamento.tsx`, incluindo o ramo de
      `searchParams.get('tab')`.
- [ ] Redirecionar `?tab=pendencias` para `?tab=validacao` com o filtro
      `chargeStatus=review_required` aplicado, para não quebrar links salvos.
- [ ] Excluir `PendenciasFaturamentoTab.tsx`; avaliar se `PendenciasTable.tsx`
      ainda tem consumidor (a renderização incremental de 100 em 100 pode ser
      aproveitada na grade da Validação).
- [ ] Atualizar `src/components/billing/__tests__/PendenciasTable.test.tsx`
      conforme o destino do componente.

### Etapa 2 — Remover a aba Demurrage, preservando as métricas

**Arquivos:** `src/pages/Faturamento.tsx`,
`src/components/billing/DemurrageInvoicesSection.tsx`, testes.

- [ ] Mover as quatro métricas consolidadas (faturas, em aberto, saldo aberto
      BRL, total USD) para uma faixa na aba **Faturas**, identificada como
      Demurrage e com link para `/demurrage`.
- [ ] Remover a aba `demurrage` e o ramo correspondente de `searchParams`.
- [ ] Redirecionar `?tab=demurrage` para `/demurrage`.
- [ ] Remover a lista duplicada, o modal de detalhe e a impressão — os três já
      existem em `/demurrage`.
- [ ] Conferir se `listDemurrageInvoices()` sem filtro ainda é chamada em
      `/faturamento`; se só as métricas permanecerem, avaliar agregado mais
      barato do que trazer a lista inteira.

### Etapa 3 — (decisão pendente) Unificar demurrage na aba Faturas

**Não executar sem decisão explícita.** É a única etapa que muda o que a tela
significa.

- [ ] **Decidir:** a aba Faturas deve listar as duas origens (taxas locais e
      demurrage) com uma coluna "Origem", tornando `/faturamento` o financeiro
      de fato? Ou as duas origens permanecem separadas por desenho, e
      `/faturamento` é assumidamente a tela das taxas locais?
- [ ] Se unificar: definir o contrato de leitura conjunta sem fundir as tabelas
      (`invoices` e `demurrage_invoices` continuam separadas — ver
      [ADR 0008](../adr/0008-demurrage-integrado-sem-unificar-persistencia.md)),
      e como filtros, exportação e paginação se comportam sobre as duas fontes.
- [ ] Se não unificar: renomear a tela para refletir o escopo real e registrar a
      decisão em ADR.

### Etapa 4 — Nomenclatura

- [ ] **Decidir:** renomear "Validação" para algo que descreva o papel real
      ("A faturar", "Exceções de faturamento", "Pendências de faturamento").
- [ ] Propagar o nome escolhido para `docs/modules/faturamento.md`,
      `docs/modules/taxas-locais.md` e `docs/ARCHITECTURE.md`.

### Etapa 5 — Gates

- [ ] `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.
- [ ] Atualizar `docs/modules/faturamento.md` (anatomia das telas e catálogo de
      ações) e `docs/RASTREABILIDADE.md` no mesmo change.
- [ ] Remover a linha deste plano de `docs/plans/README.md` e mover o arquivo
      para `docs/archive/plans/` ao concluir.

---

## Riscos e limites

- Etapas 1 e 2 são de superfície: nenhuma RPC, migration ou regra de cálculo é
  tocada. O risco é de link salvo e de memória muscular do operador — coberto
  pelos redirecionamentos.
- A Etapa 2 remove uma superfície de impressão de fatura de demurrage. Confirmar
  com a operação que ninguém imprime demurrage a partir de `/faturamento` antes
  de remover, mesmo o caminho existindo em `/demurrage`.
- A Etapa 3 esbarra na ADR 0008 (demurrage integrado sem unificar persistência).
  Unificar a **exibição** não contraria a ADR; unificar a **persistência**
  contrariaria. A distinção precisa ficar explícita na decisão.
