# 0006 — Revisão operacional e reconciliação de cliente como gate de faturamento

Status: aceito — 2026-06-09

## Contexto

Importações podem chegar com cliente ambíguo, CNPJ ausente, CE Mercante pendente, peso divergente, charge status bloqueante ou dados fiscais insuficientes. Emitir fatura automaticamente nesses casos transforma erro operacional em erro financeiro.

O projeto também precisa tratar `bls` e `granite_bls` no mesmo fluxo de cobrança, apesar de suas origens e tabelas serem diferentes.

## Decisão

Manter uma etapa explícita de revisão operacional e reconciliação de cliente antes de um B/L avançar para faturamento.

- `/revisao` combina pendências de `bls` e `granite_bls`, preservando origem e motivo da pendência.
- Correções de B/L usam RPCs como `save_bl_review` e guardas de concorrência para evitar sobrescrever edição mais recente.
- Reconciliação de cliente fica explícita em fila e só libera o fluxo quando há vínculo seguro com `customers`.
- Taxas locais e Granito convergem para estados operacionais como calculado, pendente de revisão, revisado, pronto para faturar e faturado.
- `/faturamento` mantém uma visão de validação/gargalos antes da emissão; `Pendências` é o subconjunto operacional que bloqueia cálculo ou revisão.

## Consequências

- **Positivas**: reduz emissão indevida; preserva decisão humana onde matching automático é ambíguo; dá aos operadores uma fila clara de trabalho antes do financeiro.
- **Negativas / custos**: o fluxo fica mais lento que uma importação totalmente automática; filtros e contagens precisam explicar por que um B/L ainda não está faturável.
- **Regra prática**: qualquer novo importador ou cálculo que gere incerteza deve alimentar revisão/reconciliação, não pular direto para invoice.
