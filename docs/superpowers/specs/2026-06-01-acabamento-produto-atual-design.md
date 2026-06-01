# Acabamento do Produto Atual

Atualizado em 2026-06-01.

## Contexto

O Transhipping Desk ja cobre o fluxo operacional principal em producao: viagens, Baplie EDI, manifestos CNTR e BB, Granito, Vazios, revisao, taxas locais, faturamento, demurrage, conciliacao PIX e portal do cliente.

O proximo ciclo de melhoria deve focar em acabamento do produto atual, nao em novos modulos. O objetivo e reduzir atrito operacional em pontos que ja fazem parte do uso diario.

## Problema

Partes do uso diario ainda exigem interpretacao manual, leitura cansativa de tabelas ou validacao baseada em memoria operacional. Isso aumenta o custo de operacao e dificulta saber se uma melhoria esta realmente pronta.

## Objetivos

- Padronizar melhorias pequenas e verificaveis em tres frentes:
  - reconciliacao manual;
  - tabelas e estados operacionais;
  - validacao operacional.
- Manter as melhorias conectadas ao fluxo atual de producao.
- Definir criterios de aceite objetivos para cada frente.
- Preparar cada frente para virar plano de implementacao separado.

## Nao-objetivos

- Redesenhar o produto inteiro.
- Trocar stack, biblioteca de UI ou padrao arquitetural.
- Criar novos modulos funcionais.
- Substituir regras financeiras, RLS ou RPCs transacionais ja existentes.
- Automatizar decisoes ambiguas sem revisao humana.

## Principios de acabamento

- Mudancas devem ser incrementais e reversiveis.
- A linguagem visivel ao usuario permanece em portugues e alinhada ao dominio.
- Fluxos usados em producao devem ser preservados, salvo ajuste pontual aprovado.
- Dados criticos nao devem ser escondidos para simplificar a tela.
- Estados do sistema devem ser explicitos: carregando, vazio, filtrado, erro, salvo, pendente e concluido.
- Casos ambiguos devem preservar caminho de revisao humana.
- Cada melhoria deve ter evidencia de validacao antes de ser considerada pronta.

## Specs filhas

| Spec | Foco | Resultado esperado |
|---|---|---|
| `2026-06-01-reconciliacao-manual-design.md` | Decisoes humanas em casos ambiguos | Pendencias mais explicaveis, comparaveis e auditaveis |
| `2026-06-01-tabelas-estados-operacionais-design.md` | Leitura e feedback em telas densas | Usuario entende filtros, contagens, loading, vazio, erro e efeito de acoes |
| `2026-06-01-validacao-operacional-design.md` | Roteiro de validacao por fluxo | Validacao executavel com pre-condicoes, passos, resultado esperado e evidencia |

## Ordem sugerida

1. Validacao operacional, para definir como evidenciar melhorias.
2. Tabelas e estados operacionais, para reduzir atrito cotidiano em varias telas.
3. Reconciliacao manual, por ser mais sensivel e depender de criterios claros de ambiguidade.

Essa ordem nao impede implementacoes paralelas, mas evita que melhorias sensiveis avancem sem roteiro de validacao.

## Criterios globais de pronto

Uma melhoria deste ciclo so deve ser considerada pronta quando:

- respeitar o escopo da spec filha correspondente;
- preservar o fluxo atual em producao;
- tiver criterio de aceite verificavel;
- atualizar ou referenciar `docs/VALIDACAO.md` quando afetar validacao manual;
- passar em `npm test` para alteracoes com cobertura automatizada aplicavel;
- passar em `npm run build` antes de PR;
- documentar qualquer dependencia de Supabase real, seed ou fixture.

## Verificacao da documentacao

Antes de transformar uma spec filha em plano de implementacao, confirmar:

- nao ha placeholders ou secoes incompletas;
- o escopo cabe em um PR ou em uma pequena sequencia de PRs;
- criterios de aceite nao dependem de gosto subjetivo;
- riscos e nao-escopo estao explicitos;
- existe uma forma clara de validar manualmente ou por teste automatizado.
