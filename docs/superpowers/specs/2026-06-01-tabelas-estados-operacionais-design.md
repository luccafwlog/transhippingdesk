# Tabelas e Estados Operacionais

Atualizado em 2026-06-01.

## Contexto

O Transhipping Desk tem varias telas densas usadas em rotina operacional e financeira. O acabamento esperado e melhorar leitura, previsibilidade e feedback sem trocar a arquitetura de paginas, hooks e services.

## Problema

As paginas densas concentram muitos dados e acoes. Quando filtros, carregamento, erro, vazio ou selecao nao estao explicitos, o usuario perde tempo distinguindo "nao ha dados" de "a consulta ainda nao terminou" ou "o filtro escondeu tudo".

## Objetivos

- Padronizar estados de carregamento, vazio, erro e sucesso em telas criticas.
- Tornar filtros ativos e contagens visiveis.
- Reduzir ambiguidade apos acoes do usuario.
- Preservar contexto apos mutations, filtros e navegacao curta.
- Manter densidade operacional sem transformar telas internas em landing pages.

## Nao-objetivos

- Redesenhar a navegacao global.
- Trocar biblioteca ou criar um novo design system.
- Introduzir virtualizacao antes de haver problema medido.
- Refatorar paginas grandes fora do necessario para a melhoria.
- Alterar regras de permissao ou acesso a dados.

## Escopo inicial

Priorizar telas com uso operacional frequente ou decisao financeira:

- `/faturamento`;
- `/reconciliacao`;
- `/taxas-locais`;
- `/revisao`;
- `/viagens`;
- `/manifestos`;
- `/vazios-importacao`;
- `/granito`;
- `/demurrage`;
- `/portal/billing`.

A implementacao pode selecionar um subconjunto por PR, desde que a spec mantenha o padrao comum.

## Padroes de comportamento

Cada tabela ou lista critica deve expor, quando aplicavel:

- titulo ou contexto da lista;
- total de itens retornados;
- indicacao de filtros ativos;
- estado de loading antes dos dados;
- estado vazio com causa provavel;
- estado de erro com acao recuperavel;
- feedback apos criar, editar, importar, emitir, conciliar ou excluir;
- acao afetando item proxima ao dado afetado;
- preservacao razoavel de filtro ou aba apos mutation.

## Estados minimos

### Carregando

Mostrar que a consulta esta em andamento. Preferir skeleton ou indicador integrado ao espaco da tabela, evitando salto de layout.

### Vazio sem filtro

Informar que ainda nao ha dados para aquele modulo ou contexto. Quando houver acao primaria evidente, ela pode ser apresentada.

### Vazio com filtro

Informar que os filtros atuais nao retornaram resultados e permitir limpar filtros quando ja existir controle equivalente.

### Erro

Informar que os dados nao puderam ser carregados ou salvos, com acao recuperavel quando possivel. O erro tecnico detalhado pode continuar em log ou toast, conforme padrao atual.

### Sucesso

Depois de mutation, indicar qual acao foi concluida e, quando possivel, qual item foi afetado.

## Criterios de aceite

Em qualquer tela priorizada, o usuario deve conseguir responder:

- quantos itens estou vendo?
- ha filtros aplicados?
- a tela esta carregando ou vazia?
- houve erro?
- minha acao deu certo?
- qual item foi afetado?
- preciso atualizar a pagina manualmente?

## Verificacao

- Adicionar ou ajustar testes de componentes/helpers quando a melhoria extrair logica reutilizavel.
- Validar manualmente estados de loading, vazio, erro e sucesso para pelo menos uma tela por PR.
- Confirmar que textos cabem em desktop e mobile quando a tela for responsiva.
- Rodar `npm test` quando houver testes aplicaveis.
- Rodar `npm run build` antes de PR.

## Riscos

- Padronizacao excessiva pode apagar particularidades importantes de cada modulo.
- Mensagens de vazio podem prometer acoes que o perfil do usuario nao tem permissao para executar.
- Feedback duplicado entre toast e estado inline pode gerar ruido.

## Dependencias

- Componentes existentes em `src/components/ui/` devem ser preferidos.
- Padroes de cache e invalidacao devem continuar em hooks e `queryKeys.ts`.
- Mudancas visuais amplas em paginas grandes devem ser precedidas por testes quando houver risco de regressao.
