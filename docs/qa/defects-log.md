# Registro de defeitos

| Defect ID | Feature ID | Severidade | Status | Resumo |
|---|---|---|---|---|
| DEF-001 | F-031 | High | Corrigido (2026-06-25) | Demurrage P2 conta dias dentro do free time override (sobrecobrança) |
| HARD-001 | F-031 | Medium | Mitigado (2026-06-25) | Cálculo de desconto USD duplicado em 2 caminhos; consolidado em fonte única |
| DEF-002 | F-010/F-011 | Low | Corrigido (2026-06-25) | Ordenação do Line-Up vaza NaN quando duas ETAs são nulas, pulando os desempates |
| DEF-003 | F-036 | Medium | Corrigido (2026-06-25) | Criar tarifa de demurrage sem "Válido de" envia valid_from=null e falha (23502) com toast genérico |
| A11Y-001 | transversal | Low (P3) | Corrigido (2026-06-26) | Contraste AA dos badges verde/âmbar; escopado às classes `.app-badge--green/--yellow` (4,85:1 e 4,78:1), sem mexer no token global |
| A11Y-002 | transversal | Low (P3) | Corrigido (2026-06-26) | document.title descritivo por rota (`routeTitle` + `DocumentTitle` em App), WCAG 2.4.2 |

## DEF-001 — Demurrage P2 sobrecobra dias dentro do free time override

- **Feature:** F-031 (Demurrage — containers e invoices)
- **Severidade:** High (integridade de dados / financeiro — afeta valor de
  invoice de demurrage emitida ao cliente)
- **Arquivo:** `src/services/demurrage/demurrageRates.ts` (`calculateDemurrage`)

### Passos de reprodução

1. B/L com `free_time_override` maior que o fim da faixa P1 do grupo do
   container (ex.: container `20GP`, cujo P1 do grupo vai até o dia 30, com
   `free_time_override = 33`).
2. Container com 40 dias entre descarga e devolução.
3. Calcular demurrage (caminho usado por `demurrageInvoices.ts` ao gerar os
   itens da invoice).

### Resultado esperado

Cobrança começa no dia 34 (`override+1`), direto em P2. Dias 31–33 continuam
livres pelo override. P2 = 7 dias (34..40). Total = 7 × tarifa P2.

### Resultado observado (antes do fix)

P2 = 10 dias (31..40), incluindo os dias 31–33 ainda livres pelo override.
Sobrecobrança de 3 dias na faixa P2.

### Hipótese de causa raiz (confirmada)

`diasP2 = max(0, dc - rate.p2.range[0] + 1)` usava o início fixo da faixa P2 do
grupo, sem considerar que o `free_time_override` empurra o início da cobrança
para `freeUntil+1`. Os testes existentes só cobriam `override = 30` (exatamente
o fim de P1), caso em que `freeUntil+1 == p2_day_from` e a sobreposição é zero,
mascarando o defeito.

### Correção

Início de P2 passou a ser `max(rate.p2.range[0], rate.freeUntil + 1)`. O caso
normal (override ≤ fim de P1) permanece idêntico (sem regressão). Coberto por
teste novo em `src/services/demurrage/__tests__/calculateDemurrage.test.ts`
("override de free time além do fim de P1 não cobra dias livres como P2").

A derivação de `demurrage_days` do Portal em
`123_portal_ce_mercante_gate.sql` usa `GREATEST(usage_days - free_time_days, 0)`
e não faz o split P1/P2, portanto não compartilha o defeito; a função SQL
`132_create_demurrage_invoice_atomic.sql` apenas persiste os valores calculados
no cliente. A correção no cliente é, assim, a correção completa.

## HARD-001 — Cálculo de desconto USD duplicado (mitigado)

- **Feature:** F-031 (Demurrage)
- **Severidade:** Medium (risco de integridade — divergência futura de valor)
- **Arquivo:** `src/services/demurrage/demurrageInvoices.ts`

`markInvoicePaid` (congelamento no pagamento) e `recomputeDiscountedBrl`
(recálculo após mudança de desconto) tinham cópias idênticas da aritmética de
desconto em USD. Manter duas cópias em sincronia é frágil: uma mudança de regra
em um caminho e não no outro produziria valores de fatura divergentes para o
mesmo desconto.

**Mitigação:** extraída a função pura exportada `applyDemurrageUsdDiscount`
(percentual limitado a 0–100; valor fixo com piso em zero; ignora descontos não
positivos), reutilizada nos dois caminhos. Comportamento idêntico ao anterior;
coberta por `applyDemurrageUsdDiscount.test.ts`.

## DEF-002 — Ordenação do Line-Up vaza NaN com ETAs nulas

- **Feature:** F-010/F-011 (Line-Up TV / Painel)
- **Severidade:** Low (UX / consistência — ordem de exibição das linhas do Line-Up
  com ETA ausente fica dependente da engine, não do desempate documentado)
- **Arquivo:** `src/services/lineup.ts` (`compareDateValues`)

### Resultado esperado

Quando duas linhas têm `eta` nula, o comparador de ETA deve retornar 0 para que
os critérios seguintes (ETB, nome do navio, número da viagem, POD) decidam a
ordem.

### Resultado observado (antes do fix)

`toSortableDateValue(null)` retorna `Number.POSITIVE_INFINITY`. O comparador
fazia `Infinity - Infinity = NaN`; como `NaN !== 0` é verdadeiro, a função
retornava `NaN` e os desempates eram silenciosamente ignorados (ordem
dependente da engine; com TimSort, ordem de inserção).

### Hipótese de causa raiz (confirmada)

Subtração de valores ordenáveis sem tratar o caso de igualdade de infinitos.

### Correção

`compareDateValues` passou a comparar por igualdade (`if (l === r) return 0; l <
r ? -1 : 1`), eliminando o NaN e mantendo nulos no fim. O comparador foi
exportado e coberto por `src/services/__tests__/lineupSort.test.ts`.

## DEF-003 — Criar tarifa de demurrage sem "Válido de" falha com erro genérico

- **Feature:** F-036 (Tarifas de demurrage — /demurrage/taxas)
- **Severidade:** Medium (validação / integridade / mensagem de erro — bloqueia
  ação legítima de admin com toast genérico)
- **Arquivo:** `src/pages/DemurrageRates.tsx` (`upsertDemurrageRate`)

### Passos de reprodução

1. `/demurrage/taxas` → "Nova Tarifa".
2. Preencher tipo de container e valores, **deixar "Válido de" em branco**.
3. Salvar.

### Resultado esperado

Tarifa criada; `valid_from` assume o default do banco (data de hoje), como
acontece ao inserir omitindo a coluna.

### Resultado observado (antes do fix)

`EMPTY_FORM.valid_from = null` e o `onChange` mantém `null` quando o campo fica
vazio. O `upsert` enviava `valid_from: null` explícito; a coluna é NOT NULL com
default, então o `null` explícito viola a constraint:
`23502 null value in column "valid_from" ... violates not-null constraint`.
A UI exibia apenas "Falha ao salvar tarifa." (toast genérico), sem indicar a
causa. Confirmado em runtime de browser (iteração 6) e via chamada direta.

### Causa raiz (confirmada)

Enviar `null` explícito sobrescreve o default do banco. O formulário de taxas
locais (`validateTableInput`) trata `valid_from` como obrigatório e não tem o
problema — o defeito é isolado ao formulário de demurrage.

### Correção

`buildDemurrageRateUpsertPayload` (`src/pages/demurrageRatesHelpers.ts`) omite a
chave `valid_from` quando nula, deixando o default vigente aplicar. Coberto por
`src/pages/__tests__/demurrageRatesHelpers.test.ts` e revalidado em runtime
(tarifa QA3 criada sem "Válido de", `valid_from` = data de hoje).
