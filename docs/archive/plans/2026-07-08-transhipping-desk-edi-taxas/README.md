# Implementation Plans — Fluxo Importar B/L → EDI Mercante + Taxas

Gerados pela skill `improve` (variante `plan`) em 2026-07-08, a partir da
sessão de design registrada em
`docs/adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md` e nas entradas
**B/L**, **Flags Operacionais**, **CE Mercante** e **Taxas Locais** do
`CONTEXT.md` (commit `b2461da`). Cada plano é autocontido: o executor não
precisa (nem deve assumir) contexto da sessão que os gerou.

Executor: leia o plano inteiro antes de começar, honre as STOP conditions e
atualize sua linha na tabela ao terminar.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](./001-bl-parser-campos-edi.md) | Parser de B/L captura descrição, volumes, telefone e DG (IMO) | P1 | M | — | DONE |
| [002](./002-ce-mercante-gatilho-taxas.md) | CE Mercante vira o gatilho único do cálculo/emissão de taxas (ADR 0020) | P1 | M | — | DONE |
| [003](./003-edi-i5-correcoes-mercante.md) | Corrigir I5 do EDI: IMO, NCM 8 dígitos, tipo 40FM | P1 | S | 001 (soft) | DONE |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (com motivo em uma linha) |
REJECTED (com justificativa em uma linha).

## Dependency notes

- **003 depende de 001 apenas funcionalmente** (sem o 001, nenhum B/L
  alimenta DG Class/ONU para o bloco IMO exercitar em produção); as correções
  de offset em si compilam e testam sozinhas. Pode ser executado antes do 001
  se conveniente.
- **002 é independente** de 001/003. Se 001 e 002 rodarem em sequência sobre a
  mesma branch, o segundo executor deve esperar drift em
  `src/services/blFreightImport.ts` — os pontos de mudança são identificados
  por símbolo (nome de função), não por número de linha.
- Ordem recomendada: 001 → 002 → 003 (um PR por plano, ou os três na branch
  de trabalho corrente se o operador preferir).

## Contexto compartilhado mínimo (para o revisor humano)

- Problema: viagem só-B/L gera EDI Mercante degradado e o cálculo de taxas no
  momento do import quebra a divisão `1/share_count` de container
  compartilhado quando os B/Ls chegam em uploads separados.
- Decisões: B/L é superconjunto do manifesto (tudo é parseável do B/L); DG
  declarado no B/L aplica a todos os seus containers e o Baplie refina; CE
  Mercante é o gatilho único de cálculo+emissão automática (ADR 0020,
  somente container).

## Arquivos de referência (NÃO commitados)

Os planos citam 3 arquivos Excel COSCO reais de B/L e 1 EDI Mercante real
aceito (`FWL_MERCANTE_560735.TXT`), usados para derivar posições de célula e
offsets. **Eles contêm dados reais de clientes e não foram adicionados ao
repositório**; todos os fatos necessários estão inlined nos planos. Se o
operador quiser testes contra arquivo real (padrão
`manifestFixtures.real.test.ts`), deve fornecê-los e colocá-los em
`src/services/__tests__/fixtures/`.

## Findings considered and rejected

- Sintetizar fixture xlsx binário nos planos: rejeitado — builders sintéticos
  nos testes (padrão já existente em `blParser.test.ts`) cobrem o necessário.
- Recalcular B/Ls irmãos no import (alternativa à mudança de gatilho):
  rejeitado no ADR 0020 — ver "Alternativas consideradas" lá.
- Estender o gatilho por CE à carga solta: rejeitado pelo operador (fronteira
  explícita, ADR 0020 Decisão 4).
- Backfill de `cargo_description` para B/Ls antigos: rejeitado — reimportar o
  arquivo do B/L é o backfill natural (forward-only, como `notify_party`).
