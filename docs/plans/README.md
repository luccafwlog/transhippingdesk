# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

| Plano | Tema | Status |
|---|---|---|
| [`2026-08-13-correcao-regressao-inicializacao-login-navegacao.md`](./2026-08-13-correcao-regressao-inicializacao-login-navegacao.md) | Harness, cache do shell e checkpoints para diagnosticar a lentidão no acesso frio, login e primeira navegação | IN PROGRESS |
| [`2026-08-14-rate-limit-portal-normalizador-compartilhado.md`](./2026-08-14-rate-limit-portal-normalizador-compartilhado.md) | Rate limit do Portal volta ao `normalize_cnpj` compartilhado (hoje apaga as letras do CNPJ alfanumérico), passa a cobrir a verificação de senha da troca de Email de Recuperação, e a confirmação deixa de consumir o convite antes de saber se há troca pendente | TODO |

Valores de status: TODO · IN PROGRESS · DONE · BLOCKED (com motivo em uma linha).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
