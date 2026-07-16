# Architecture Decision Records

Verificado em 2026-06-18. Este índice informa quais decisões continuam
vigentes e onde uma decisão posterior alterou parte de uma ADR anterior.

| ADR | Decisão | Status | Relação atual |
|---|---|---|---|
| [0001](./0001-portal-login-supabase-auth.md) | Login do Portal via Supabase Auth | aceito | Supersedida parcialmente pela 0013 quanto ao identificador de login |
| [0002](./0002-portal-self-service-reconsolidation.md) | Reconsolidação self-service no Portal | aceito | Vigente |
| [0003](./0003-spa-react-rotas-lazy-camadas-page-hook-service.md) | SPA React, rotas lazy e separação de responsabilidades | aceito | Vigente |
| [0004](./0004-supabase-rls-rpc-fronteira-seguranca.md) | RLS e RPCs como fronteira de segurança | aceito | Vigente |
| [0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md) | Pipeline de importação, staging e reconciliação | aceito | Supersedida parcialmente pela 0020 quanto ao billing e pela 0025 quanto ao Manifesto CNTR |
| [0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md) | Revisão e reconciliação como gate financeiro | aceito | Supersedida parcialmente pela 0020 quanto ao momento do cálculo automático; gates permanecem |
| [0007](./0007-ledger-local-ciclo-vida-invoices.md) | Ledger local e ciclo de vida de invoices | aceito | Vigente |
| [0008](./0008-demurrage-integrado-sem-unificar-persistencia.md) | Demurrage integrado sem unificar persistência | aceito | Vigente |
| [0009](./0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md) | Hard delete controlado | aceito | Vigente |
| [0010](./0010-validacao-testes-deploy-gates.md) | Validação, testes e gates de deploy | aceito | Vigente |
| [0011](./0011-revogacao-anon-security-definer-default-deny.md) | Default-deny de `anon` em funções privilegiadas | aceito | Supersedida parcialmente pela 0013 quanto à allowlist `anon` |
| [0012](./0012-viagens-master-detail-rota-dedicada.md) | Viagens em master-detail com rota dedicada | aceito | Implementada em 2026-06-16 |
| [0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md) | Portal com identificador resolvido e exceção limitada de `anon` | aceito | Decisão vigente para autenticação do Portal |
| [0014](./0014-demurrage-recalculo-diario-substitui-roe-congelado.md) | Demurrage: recálculo diário substitui ROE congelado na emissão | aceito | Estende a 0008; redefine ROE/Markup |
| [0015](./0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md) | Demurrage: conciliação por txid + janela das duas PTAX na data do pagamento | aceito | Depende da 0014 |
| [0016](./0016-migrations-nomenclatura-numerada-sequencial.md) | Migrations: nomenclatura numerada sequencial única | aceito | Estende a 0010; atualiza WORKFLOW.md §5 |
| [0017](./0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md) | B/L como fonte de ingestão/correção; autoridade compartilhada com o manifesto | aceito | Supersedida pela 0025 quanto à autoridade compartilhada com Manifesto CNTR; demais gates permanecem |
| [0018](./0018-selecao-viagem-busca-preditiva-combobox.md) | Seleção de viagem padronizada em busca preditiva (Combobox) | aceito | Estende a 0003; suporta a 0017 |
| [0019](./0019-politica-de-senha-e-signup-fechado.md) | Politica de senha e signup fechado | aceito | Estende a 0004 e a 0013; exige provisionamento administrativo e piso de senha auditavel |
| [0020](./0020-ce-mercante-gatilho-calculo-taxas-locais.md) | CE Mercante como gatilho do cálculo automático de Taxas Locais | aceito | Supersede parcialmente a 0005/0006 (billing no import) e a 0017 (cálculo pós-commit do Importar B/L) |
| [0021](./0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md) | Cadastro único de navio/viagem: Programação de Navios projeta a Viagem | aceito | Estende a 0012 e a 0002; Chegadas e Saídas passa a criar a Viagem e o Portal projeta os schedules |
| [0022](./0022-omissao-escala-transbordo-cod-registro-operacional.md) | Omissao de escala, transbordo e COD como registro operacional | aceito | Estende a 0012 e a 0021; financeiro permanece manual |
| [0023](./0023-distribuicao-skills-fonte-unica-instalador-node.md) | Distribuição de skills: fonte única e instalador Node | aceito | Estende a 0010; unifica skills de Claude Code e Codex em nuvem e local |
| [0024](./0024-cancelamento-viagem-estado-retido-exclusao-hard-delete.md) | Cancelamento de viagem é estado retido; exclusão é hard delete | aceito | Complementa a ADR 0009 para viagens |
| [0025](./0025-bl-fonte-documental-unica-container-atd-pol.md) | B/L como fonte documental única da carga de container e do ATD do POL | aceito | Supersede parcialmente 0005 e 0017; implementação pendente |

## Convenção

- **aceito**: decisão vigente, ainda que parte dela tenha sido supersedida;
- **supersedida parcialmente**: uma ADR posterior altera somente o aspecto
  indicado, preservando o restante da decisão;
- novas mudanças arquiteturais devem criar uma ADR ou atualizar explicitamente
  a relação de supersessão neste índice.
