# Architecture Decision Records

Verificado em 2026-06-18. Este índice informa quais decisões continuam
vigentes e onde uma decisão posterior alterou parte de uma ADR anterior.

| ADR | Decisão | Status | Relação atual |
|---|---|---|---|
| [0001](./0001-portal-login-supabase-auth.md) | Login do Portal via Supabase Auth | aceito | Supersedida parcialmente pela 0013 quanto ao identificador de login |
| [0002](./0002-portal-self-service-reconsolidation.md) | Reconsolidação self-service no Portal | aceito | Vigente |
| [0003](./0003-spa-react-rotas-lazy-camadas-page-hook-service.md) | SPA React, rotas lazy e separação de responsabilidades | aceito | Vigente |
| [0004](./0004-supabase-rls-rpc-fronteira-seguranca.md) | RLS e RPCs como fronteira de segurança | aceito | Vigente |
| [0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md) | Pipeline de importação, staging e reconciliação | aceito | Vigente |
| [0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md) | Revisão e reconciliação como gate financeiro | aceito | Vigente |
| [0007](./0007-ledger-local-ciclo-vida-invoices.md) | Ledger local e ciclo de vida de invoices | aceito | Vigente |
| [0008](./0008-demurrage-integrado-sem-unificar-persistencia.md) | Demurrage integrado sem unificar persistência | aceito | Vigente |
| [0009](./0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md) | Hard delete controlado | aceito | Vigente |
| [0010](./0010-validacao-testes-deploy-gates.md) | Validação, testes e gates de deploy | aceito | Vigente |
| [0011](./0011-revogacao-anon-security-definer-default-deny.md) | Default-deny de `anon` em funções privilegiadas | aceito | Supersedida parcialmente pela 0013 quanto à allowlist `anon` |
| [0012](./0012-viagens-master-detail-rota-dedicada.md) | Viagens em master-detail com rota dedicada | aceito | Implementada em 2026-06-16 |
| [0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md) | Portal com identificador resolvido e exceção limitada de `anon` | aceito | Decisão vigente para autenticação do Portal |
| [0014](./0014-demurrage-recalculo-diario-substitui-roe-congelado.md) | Demurrage: recálculo diário substitui ROE congelado na emissão | aceito | Estende a 0008; redefine ROE/Markup |
| [0015](./0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md) | Demurrage: conciliação por janela de duas PTAX na data do pagamento | aceito | Depende da 0014 |

## Convenção

- **aceito**: decisão vigente, ainda que parte dela tenha sido supersedida;
- **supersedida parcialmente**: uma ADR posterior altera somente o aspecto
  indicado, preservando o restante da decisão;
- novas mudanças arquiteturais devem criar uma ADR ou atualizar explicitamente
  a relação de supersessão neste índice.
