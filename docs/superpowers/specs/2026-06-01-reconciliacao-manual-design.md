# Reconciliacao Manual

Atualizado em 2026-06-01.

## Contexto

O sistema ja bloqueia fluxos financeiros quando nao ha reconciliacao segura de cliente, documento, B/L, invoice ou pagamento. A melhoria desejada nao e remover a revisao humana, mas tornar a decisao manual mais clara, rapida e auditavel.

## Problema

Quando cliente, CNPJ, B/L, invoice ou pagamento nao batem automaticamente, o usuario precisa decidir com pouco apoio visual e pouca explicacao sobre o motivo da ambiguidade.

## Objetivos

- Mostrar por que um item caiu em reconciliacao manual.
- Expor candidatos plausiveis de forma comparavel.
- Destacar divergencias relevantes entre origem e candidato.
- Registrar a decisao humana com contexto suficiente para auditoria.
- Reduzir retrabalho sem autoaprovar casos ambiguos.

## Nao-objetivos

- Criar um novo motor de matching.
- Autoaprovar casos ambiguos.
- Alterar regras financeiras centrais.
- Alterar RLS, RPCs transacionais ou modelo de ledger sem spec propria.
- Unificar todos os fluxos de reconciliacao em uma unica tela nova.

## Escopo inicial

A primeira implementacao deve mapear e melhorar os pontos existentes de reconciliacao, com prioridade para:

- reconciliacao de cliente/CNPJ em importacoes e revisao;
- conciliacao PIX e pagamentos quando houver divergencia de valor, TXID, invoice ou cliente;
- pendencias financeiras que bloqueiam faturamento ou baixa.

## Comportamento esperado

Cada pendencia manual deve responder visualmente:

- qual e a origem da pendencia;
- qual campo causou a ambiguidade;
- quais candidatos sao plausiveis;
- quais campos conferem e quais divergem;
- qual acao esta disponivel;
- qual risco permanece ao confirmar.

Campos comparaveis recomendados:

- cliente detectado;
- CNPJ/CPF;
- documento de origem;
- valor;
- viagem;
- B/L;
- invoice;
- data;
- origem do dado;
- status atual.

## Decisao e auditoria

Quando o usuario confirmar uma reconciliacao manual, o sistema deve registrar, quando a tabela ou fluxo ja suportar:

- usuario;
- timestamp;
- decisao tomada;
- entidade afetada;
- motivo ou observacao quando houver risco residual;
- origem da pendencia.

Se algum fluxo atual nao tiver persistencia adequada para auditoria, a implementacao deve explicitar essa limitacao no plano antes de alterar schema.

## Estados de UX

A fila de reconciliacao deve diferenciar:

- pendencia sem candidato;
- pendencia com candidato unico incerto;
- pendencia com multiplos candidatos;
- pendencia bloqueada por dado ausente;
- pendencia ja resolvida;
- erro ao carregar ou salvar decisao.

## Criterios de aceite

Um operador deve conseguir responder sem consultar banco ou codigo:

- por que isso esta pendente?
- quais opcoes tenho?
- quais dados conferem?
- quais dados divergem?
- qual e o risco de confirmar?
- minha decisao foi salva?
- onde vejo ou reconstruo o historico da decisao?

## Verificacao

- Criar ou atualizar testes unitarios para helpers de classificacao de pendencia, quando extraidos.
- Validar manualmente pelo menos um caso de cada estado de UX aplicavel.
- Confirmar que erros de mutation exibem feedback recuperavel.
- Confirmar que uma decisao manual nao remove dados necessarios para auditoria.

## Riscos

- Melhorar a interface pode dar falsa sensacao de certeza em casos ainda ambiguos.
- Campos financeiros podem ter regras diferentes por origem de invoice.
- Alteracoes de schema para auditoria precisam seguir fluxo de migration e RLS-first.

## Dependencias

- `docs/VALIDACAO.md` deve ganhar cenarios de reconciliacao manual quando esta spec virar plano.
- Qualquer mudanca em banco deve seguir as diretrizes de migration do projeto.
