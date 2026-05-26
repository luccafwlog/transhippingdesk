# Design: Módulo Financeiro — Aba Validação

**Data:** 2026-05-26
**Escopo:** Taxas Locais + Faturamento
**Problema:** O fluxo operacional de calcular → revisar → faturar está na aba "Operação" de Taxas Locais, uma página de configuração. Isso força o operador a navegar entre duas telas sem contexto compartilhado, e o pipeline de status é mais complexo do que a operação real exige.

---

## Decisões

### 1. Mover o pipeline operacional para Faturamento

A aba "Operação" de Taxas Locais é removida. Seu conteúdo migra para uma nova aba **Validação** dentro de Faturamento.

**Taxas Locais** fica com apenas duas abas: `Tabelas` e `Overrides` — exclusivamente configuração de tarifas.

**Faturamento** passa a ter três abas, nesta ordem: `Validação` | `Faturas` | `Demurrage`.

A aba Validação é a entrada padrão do operador no dia a dia.

### 2. Cálculo automático ao importar manifesto

Ao subir um manifesto, o sistema dispara o cálculo de taxas locais automaticamente para cada B/L importado. O operador não precisa acionar "Calcular" manualmente — o B/L já chega calculado.

Se o cálculo detectar uma inconsistência, o B/L é sinalizado com `review_required`. Caso contrário, vai direto para `ready_for_billing`.

### 3. Modelo de status simplificado

De 6 status para 3:

| Status | Significado |
|---|---|
| `ready_for_billing` | Calculado sem inconsistências (automático) ou revisado e aprovado pelo operador. Pronto para emitir fatura. |
| `review_required` | Cálculo detectou inconsistência. Operador precisa revisar antes de liberar. |
| `exempt` | Isento de taxas locais. Aplicado manualmente pelo operador após o cálculo, antes da emissão. Usado principalmente para B/Ls de veículos. |

**Status eliminados da UX:**
- `not_calculated` — nunca visível (cálculo é imediato na importação)
- `calculated` — transitório interno, fundido com `ready_for_billing`
- `reviewed` — eliminado; revisar já equivale a marcar como pronto

Os valores no banco podem ser mantidos para compatibilidade com dados históricos, mas não são expostos na interface.

---

## Fluxos

### Caminho padrão (maioria dos B/Ls)

```
Manifesto importado → cálculo automático → ready_for_billing → operador emite fatura
```

### Caminho de exceção (inconsistência detectada)

```
Manifesto importado → cálculo automático → review_required → operador revisa → ready_for_billing → emite fatura
```

### Isenção (veículos)

```
ready_for_billing → operador aplica isenção → exempt (sai do pipeline)
```

A isenção pode ser aplicada a partir de qualquer estado após o cálculo e antes da emissão da fatura.

---

## Layout da aba Validação

A aba Validação contém:

1. **Stepper de contadores** no topo: `review_required` | `ready_for_billing` | `exempt`. Clicável — filtra a tabela pelo status correspondente.

2. **Filtros** de busca livre (B/L ou cliente), modo de carga, viagem e status.

3. **Ações em lote** contextuais:
   - Para B/Ls em `review_required`: "Aprovar revisão" → move para `ready_for_billing`
   - Para B/Ls em `ready_for_billing`: "Emitir faturas"
   - Para qualquer B/L calculado: "Marcar isento"

4. **Tabela de B/Ls** com colunas: seleção, B/L, cliente, modo, total BRL, status (badge colorido).

---

## Onde o cálculo automático é acionado

O trigger de cálculo é inserido no serviço de importação de manifesto, após a persistência dos B/Ls no banco. O mesmo motor de cálculo já existente (`batchCalculateLocalCharges`) é reutilizado — apenas o ponto de chamada muda de manual (ação do operador) para automático (pós-import).

B/Ls que já existiam antes desta mudança e estão em `not_calculated` devem ser processados por uma rotina de migração única.

---

## O que não muda

- Motor de cálculo de taxas locais (sem alteração de lógica)
- Tabelas e overrides de tarifas (sem alteração)
- Fluxo de emissão de faturas em Faturamento (sem alteração)
- Dados históricos no banco (status antigos preservados)
- Portal do cliente (sem impacto)
- Demurrage e Conciliação PIX (sem impacto)

---

## Critério de sucesso

- Operador abre Faturamento → aba Validação e vê todos os B/Ls pendentes sem navegar para outra tela
- B/Ls chegam calculados automaticamente após importação de manifesto
- B/Ls sem inconsistência já estão em `ready_for_billing` — operador só precisa emitir a fatura
- B/Ls com inconsistência aparecem destacados em `review_required` com motivo visível
- Taxas Locais exibe apenas Tabelas e Overrides
