# ADR 0054 — Portal ativo e acesso do cliente como gate de faturamento

Status: aceito — 2026-08-17

## Contexto

Uma fatura só pode ser considerada faturada quando o cliente consegue recebê-la
e visualizá-la. A migration `188_review_gate_remove_portal.sql` retirou a
prontidão do Portal do gate, mas isso contradiz o controle financeiro exigido:
sem Conta de Portal ativa e acesso utilizável, a fatura fica indisponível para
quem deve pagá-la.

## Decisão

- A prontidão do Portal é condição obrigatória do gate de revisão/faturamento.
- Para o cliente ser considerado pronto, a Conta de Portal precisa estar ativa,
  vinculada ao usuário de autenticação e com Email de Recuperação válido e não
  suprimido, conforme o contrato de Clientes/Portal.
- A decisão final deve ser aplicada server-side na fronteira que permite
  `ready_for_billing`/emissão; a UI não pode declarar o processo faturado antes
  dessa guarda.
- A ausência do Portal é motivo canônico do alerta único do B/L quando o B/L
  estiver na fila de revisão. Ela não cria um segundo alerta para a mesma
  entidade.
- A ativação ou correção da Conta de Portal deve disparar a recomputação dos
  B/Ls afetados. O histórico já faturado não é reaberto automaticamente.
- A migration `188` permanece imutável. A restauração do gate deve ocorrer em
  migration nova, sequencial e com testes da fronteira server-side.

## Nota editorial — 2026-08-31

O gate decidido aqui seguia aceito e **não implementado**: nenhuma migration
posterior à `188` restaurou a guarda, e por isso a UI e o `CONTEXT.md` ainda
descreviam a categoria de bloqueio como fechada em três motivos. A implementação
foi retomada nesta data, com dois pontos fixados que esta ADR não detalhava:

- **Critério de prontidão** — vale o texto da decisão: conta ativa, vinculada ao
  usuário de autenticação, com e-mail de recuperação válido e não suprimido.
  `convite_pendente` não passa: o cliente ainda não acessou.
- **Precedência na fila** — quando há mais de um bloqueio aberto, o portal é o
  último exibido (cliente, cálculo, CE Mercante, portal), por ser o único que se
  resolve no cadastro do cliente e não no B/L.

O gate atinge a **emissão**, individual e consolidada, nunca o cálculo: as taxas
seguem sendo calculadas para conferência com o bloqueio aberto.

## Relação com decisões anteriores

Esta ADR supersede a nota editorial de 2026-08-16 da ADR 0006 e a parte da
`188_review_gate_remove_portal.sql` que retirou o Portal do gate. As demais
regras da ADR 0006, inclusive a ausência de backfill top-level, permanecem
vigentes.
