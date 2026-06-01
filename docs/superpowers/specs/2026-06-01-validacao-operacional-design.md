# Validacao Operacional

Atualizado em 2026-06-01.

## Contexto

`docs/VALIDACAO.md` ja lista os fluxos principais do sistema em producao. Para apoiar o ciclo de acabamento, esse roteiro precisa ficar mais executavel e menos dependente de memoria de quem conhece o produto.

## Problema

O roteiro atual funciona como checklist macro. Para terminar melhorias com confianca, cada fluxo precisa declarar pre-condicoes, passos, resultado esperado e evidencia objetiva.

## Objetivos

- Transformar validacao manual em roteiro executavel por modulo.
- Explicitar dados, perfil de usuario e ambiente necessario.
- Definir resultado esperado para cada fluxo critico.
- Registrar evidencia minima de sucesso ou falha.
- Diferenciar validacao local, validacao com Supabase real e validacao visual/manual.

## Nao-objetivos

- Substituir testes automatizados.
- Exigir E2E antes de haver plano proprio.
- Documentar fluxos obsoletos.
- Reintroduzir specs historicas que ja viraram codigo.
- Criar seed completa de producao nesta spec.

## Escopo inicial

Atualizar `docs/VALIDACAO.md` para cobrir, com mais detalhe, os fluxos:

- login interno e permissao por perfil;
- importacao CNTR, BB, Baplie, Granito, Veiculos e Vazios;
- revisao manual;
- taxas locais e faturamento;
- demurrage;
- conciliacao PIX;
- portal do cliente;
- admin de usuarios;
- relatorios, alertas e Line Up TV como fluxos complementares.

## Modelo de roteiro por fluxo

Cada fluxo deve seguir este formato:

- objetivo do fluxo;
- ambiente necessario;
- perfil de usuario;
- dados de entrada ou fixture;
- pre-condicoes;
- passos;
- resultado esperado;
- evidencia a coletar;
- falhas comuns;
- testes automatizados relacionados, quando existirem.

## Evidencias recomendadas

Dependendo do fluxo, a evidencia pode ser:

- screenshot da tela final;
- numero de invoice emitida;
- B/L ou viagem criada/importada;
- registro visivel em tabela;
- status atualizado;
- email disparado ou evento esperado;
- pagamento conciliado;
- log ou retorno de RPC quando o fluxo exigir Supabase real.

## Ambientes

### Local sem Supabase real

Usado para build, testes unitarios, lint e validacao visual limitada.

### Local com Supabase real

Usado para fluxos que dependem de auth, RLS, RPCs, Edge Functions ou dados persistidos.

### Producao

Usado apenas para validacao operacional controlada, sem dados destrutivos e sem reset.

## Criterios de aceite

Uma pessoa nova no projeto deve conseguir:

- escolher um fluxo em `docs/VALIDACAO.md`;
- saber qual ambiente usar;
- saber qual perfil de usuario precisa;
- preparar os dados necessarios;
- executar os passos;
- comparar o resultado com o esperado;
- registrar se passou ou falhou;
- apontar evidencias suficientes para outra pessoa revisar.

## Verificacao

- Revisar `docs/VALIDACAO.md` apos cada melhoria funcional relevante.
- Confirmar que fluxos dependentes de Supabase real estao marcados explicitamente.
- Confirmar que nenhum passo exige conhecimento implicito fora do documento.
- Manter comandos tecnicos alinhados aos scripts de `package.json`.

## Riscos

- Roteiro detalhado demais pode ficar obsoleto rapidamente.
- Roteiro vago demais nao melhora a confianca de release.
- Dados de validacao podem misturar ambiente local e producao se as pre-condicoes nao forem claras.

## Dependencias

- `docs/ROADMAP.md` continua sendo a fonte para backlog e riscos monitorados.
- `docs/ARCHITECTURE.md` continua sendo a fonte para fluxo operacional canonico.
- Seeds e fixtures existentes devem ser referenciados quando forem suficientes.
