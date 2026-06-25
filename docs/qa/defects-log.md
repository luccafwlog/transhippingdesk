# Registro de defeitos

| Defect ID | Feature ID | Severidade | Status | Resumo |
|---|---|---|---|---|
| DEF-001 | F-031 | High | Corrigido (2026-06-25) | Demurrage P2 conta dias dentro do free time override (sobrecobrança) |

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
