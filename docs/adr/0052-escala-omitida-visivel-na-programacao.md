# 0052 — Escala omitida é visível na programação, marcada como `OMIT`

Status: aceito — 2026-08-19

Supersede parcialmente a [ADR 0022](./0022-omissao-escala-transbordo-cod-registro-operacional.md),
no fragmento que exclui PODs omitidos da RPC `portal_ship_schedule`.

## Contexto

A ADR 0022 decidiu excluir PODs omitidos de três lugares: `getProximaEscala`, a
conclusão automática da viagem e a RPC `portal_ship_schedule`. Os dois primeiros
são derivações internas — uma escala que não vai acontecer não pode ser a
próxima nem segurar a conclusão da viagem. O terceiro é projeção de tela, e é aí
que a regra produz o efeito errado.

Hoje a linha do porto omitido simplesmente não volta da RPC, e as duas telas que
a consomem caem no mesmo fallback `?? 'X'`: **Chegadas e Saídas**
(`src/pages/ChegadasSaidas.tsx`, interno) e o **widget de programação do Portal**
(`src/components/portal/ShipScheduleWidget.tsx`, do cliente). O resultado é que
uma escala cancelada fica idêntica a uma escala cuja data ninguém informou
ainda. Quem lê a tabela não tem como distinguir "não sabemos quando" de "não vai
acontecer" — e a segunda é a informação que muda a decisão de quem espera a
carga.

Esconder também não protege nada: a omissão **já é comunicada** ao cliente
afetado por `portal_notifications.type='transshipment'`, decidido na própria
ADR 0022. A escala omitida é fato do itinerário do navio, não informação
interna.

## Decisão

**1. `portal_ship_schedule` passa a devolver o POD omitido**, marcado como
omitido em vez de suprimido. As duas telas exibem **`OMIT`** na coluna daquele
porto — terceiro estado da célula, distinto de `X` (data não informada) e de uma
data.

**2. A marca é a mesma para o operador e para o cliente.** Não há versão
reduzida: a escala não vai acontecer, e isso é igualmente verdadeiro nas duas
telas. Manter dois comportamentos criaria a chance de o cliente ver `X` enquanto
o operador vê `OMIT`, e de ninguém saber qual tela está certa.

**3. O motivo interno da omissão continua fora do Portal.** O que passa a ser
visível é **o fato** (esta escala foi omitida), não a **justificativa** (por
quê). A distinção é a mesma que a Task 11 do plano de correção aplica ao card de
transbordo, que remove `reason` da projeção do Portal.

**4. As outras duas exclusões da ADR 0022 permanecem.** `getProximaEscala` e a
conclusão automática da viagem continuam ignorando PODs omitidos: ali a exclusão
é derivação correta, não ocultação de tela.

## Consequências

- A migration que reescrever `portal_ship_schedule` deve devolver a linha
  omitida com marcação explícita, sem depender de o cliente inferir omissão pela
  ausência de data — `X` e `OMIT` precisam continuar distinguíveis no payload.
- `portalShipScheduleOmitted.test.ts` era a trava da regra anterior e passa a
  fixar a nova: a linha volta, marcada.
- O widget do Portal é visível a todo cliente autenticado, não só ao afetado.
  Portanto a omissão de uma escala passa a ser observável por clientes que não
  tinham carga nela. Isso é aceito: o itinerário do navio não é informação
  reservada, e o Line-Up já o exibe.
- `ChegadasSaidas.tsx` e `ShipScheduleWidget.tsx` mantêm células separadas com a
  mesma semântica; se divergirem, é defeito.
