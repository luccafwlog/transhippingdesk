# 0015 — Demurrage: conciliação por janela de duas PTAX ancorada na data do pagamento

Status: aceito — 2026-06-24

## Contexto

Sob recálculo diário (ver 0014), o QR Code PIX é um BR Code **estático** com o
valor embutido (campo TLV `54`). Regenerar o QR a cada recálculo gera um código
novo, mas **não invalida** os códigos antigos — o PIX estático não expira no
banco. Logo, o cliente pode pagar com um "copia e cola" de um dia anterior, e o
valor recebido no extrato pode não ser o `current_total_brl` do dia.

Foram consideradas três estratégias de match na conciliação:

1. **Valor único na data do pagamento** — rígido demais: gera falso negativo
   quando o cliente paga de manhã com o QR do dia anterior e o recálculo do dia
   já rodou à tarde (granularidade de data não distingue intra-dia).
2. **Qualquer valor histórico da invoice** — permissivo demais: aceitaria um
   pagamento com valor de PTAX muito antigo como correto.
3. **Janela das duas PTAX mais recentes** — equilíbrio escolhido.

## Decisão

Um pagamento de Demurrage é considerado correto se o valor do extrato casar
(tolerância R$ 0,01) com **um dos dois valores de recálculo mais recentes**
registrados em `demurrage_invoice_history` com `event_date <= data_do_pagamento`.

- A janela é **ancorada na data do pagamento que consta no extrato**, nunca na
  data em que o time financeiro executa a conciliação (que pode atrasar por
  motivos internos).
- "Imediatamente anterior" significa a entrada de recálculo anterior por
  divulgação — pegar as duas entradas mais recentes `<= data_do_pagamento`
  pula naturalmente fins de semana e feriados (PTAX não é divulgada).
- Um valor correspondente a uma PTAX mais antiga que essas duas é tratado como
  **pagamento incorreto** (não concilia automaticamente; vai para tratamento
  manual).
- O valor casado é congelado no histórico com `source='payment'` e encerra o
  recálculo daquela invoice.

## Consequências

- **Positivas**: tolera o atraso da conciliação e o pagamento legítimo com QR de
  até uma PTAX anterior, sem aceitar valores defasados; não exige QR dinâmico.
- **Negativas / custos**: substitui a ideia de `get_demurrage_value_on_date`
  (um valor) por uma função que devolve as duas entradas mais recentes
  `<= data_do_pagamento`; a invoice precisa ter entrada de histórico desde a
  emissão para que pagamentos no mesmo dia tenham contra o que casar.
- **Relação**: depende de 0014 (histórico imutável e recálculo diário).
