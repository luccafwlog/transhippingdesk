# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-15-implementacao-bloco-520-bl-revisao.md`](./2026-08-15-implementacao-bloco-520-bl-revisao.md) | Implementação de B/L, Revisão Manual, importações e projeções de pendências — Bloco #520 | TODO |
| [`2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md`](./2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md) | Implementação das pendências de clientes, Portal, faturamento dependente e Disputes de Demurrage | IN PROGRESS |
| [`2026-08-16-implementacao-bloco-522-financeiro-alertas.md`](./2026-08-16-implementacao-bloco-522-financeiro-alertas.md) | Implementação do contrato de alertas, notificações e reconciliação PIX do Bloco 3 — Financeiro (#522) | BLOCKED — implementação da fundação E3/E4 |
| [`2026-08-16-bloco-4-operacao-viagem-alertas.md`](./2026-08-16-bloco-4-operacao-viagem-alertas.md) | Implementação dos alertas BL, Baplie, CE e exportação do Bloco 4 | BLOCKED — schema da fundação (E3/E4) e detectores server-side pendentes |
| [`2026-08-17-implementacao-bloco-524-adr-alertas.md`](./2026-08-17-implementacao-bloco-524-adr-alertas.md) | Implementação dos Alertas e Notificações Internas do Relatório de Agência (ADR) | TODO |
| [`2026-08-20-implementacao-bloco-525-transversal-portal.md`](./2026-08-20-implementacao-bloco-525-transversal-portal.md) | Implementação das superfícies transversais: sino interno, fila `/alertas`, resumo do `/painel`, falha de roteamento e Eco de Tratamento — Bloco #525 | BLOCKED — depende da PR de integração dos Blocos 1–5 (#519, §2, passo 11) |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

O plano do Bloco #520 tem bloqueio parcial: a persistência da Notificação Interna
bloqueia as partes das Tasks 1, 3 e 7 que dependem do sino; as Tasks 2 e 6 podem
avançar independentemente.

### Sincronização de 2026-08-20

O plano de 2026-08-11 foi ressincronizado com as decisões posteriores a ele —
ADR 0053 (ciclo de vida e dispensa temporária), ADR 0054 (Portal como gate) e as
cinco specs de bloco. Passou a ter um item **E4 — dispensa temporária** no Bloco
0, o catálogo completo de gravidade por evento no E1 e o mapa entre as letras do
catálogo (A–D) e as issues #520–#525.

Enquanto o E1 e o E2 podem ser implementados de imediato, o E3 e o E4 dependem de
uma spec de schema que ainda não existe em `docs/spec/`: nenhum plano ou spec vivo
declara a tabela de Notificação Interna, a tabela de itens do agregado ou o
registro de dispensa.

> **Nota editorial de 2026-08-20 (pós-#568).** Os dois parágrafos acima são
> registro histórico e foram superados no mesmo dia. A fundação E1–E4 foi
> implementada e mergeada em `main` pela PR #568 (migrations `317`–`321`); seu
> plano e seu contrato de schema estão em
> [`../archive/plans/2026-08-11-alertas-e-notificacoes.md`](../archive/plans/2026-08-11-alertas-e-notificacoes.md)
> e [`../archive/specs/2026-08-20-alertas-fundacao-schema-design.md`](../archive/specs/2026-08-20-alertas-fundacao-schema-design.md).
> A persistência da Notificação Interna deixou de bloquear o plano do Bloco #520,
> e o bloqueio remanescente dos Blocos #522 e #523 é a migração dos próprios
> produtores, não o schema da fundação.

### Nota editorial sobre o registro de decisões de #519

A regra de encerramento de #519 nomeia
`docs/plans/2026-08-11-alertas-e-notificacoes.md` como destino das decisões.
Para o Bloco #521, esse registro foi formalizado como spec funcional em
[`../spec/2026-08-15-clientes-portal-alertas-design.md`](../spec/2026-08-15-clientes-portal-alertas-design.md), que é a fonte canônica ligada ao
plano acima. A substituição é intencional: a spec separa decisões funcionais
do plano de execução e deve ser consultada pelos blocos seguintes até que um
registro transversal seja consolidado.

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
