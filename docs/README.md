# Documentação do Transhipping Desk

Verificado contra o repositório em 2026-06-18.

## Qual documento consultar

| Pergunta | Fonte canônica |
|---|---|
| O que o produto faz e como começar? | [`README.md`](../README.md) |
| O que um termo de negócio significa? | [`CONTEXT.md`](../CONTEXT.md) |
| Como o sistema está estruturado? | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Como desenvolver, testar e publicar? | [`WORKFLOW.md`](../WORKFLOW.md) |
| O que existe, evolui e está no backlog? | [`ROADMAP.md`](./ROADMAP.md) |
| Como validar um fluxo? | [`VALIDACAO.md`](./VALIDACAO.md) |
| Quais decisões arquiteturais estão vigentes? | [`adr/README.md`](./adr/README.md) |
| O reset de testes pode ser executado? | [`RESET_AMBIENTE.md`](./RESET_AMBIENTE.md) |

## Hierarquia de autoridade

1. Código, migrations e configuração executável descrevem o comportamento atual.
2. Os documentos vivos acima explicam esse comportamento.
3. ADRs explicam decisões e sua evolução.
4. Auditorias, specs e planos datados são snapshots históricos.

Quando houver divergência, confirme o estado executável e corrija o documento
vivo. Não reescreva silenciosamente um snapshot histórico.

## Registros históricos

- `TECHNICAL-AUDIT-*.md` e `QA-AUDIT-*.md`: achados na data indicada.
- `design-audit/`: auditoria visual e evidências.
- `superpowers/specs/` e `superpowers/plans/`: desenhos e planos de mudanças.
- `plans/` e `docs/plans/`: planos de implementação e acompanhamento.

## Manutenção

Mudanças em rotas, contratos de autenticação, migrations, comandos, deploy,
procedimentos operacionais ou decisões arquiteturais devem atualizar a fonte
viva correspondente. Execute `npm run docs:check` antes de abrir um PR.
