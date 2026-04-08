# Roadmap do Sistema

Estado de referencia do projeto em 2026-04-08.

## Status Geral

- Base web publicada e operacional em Firebase Hosting.
- Backend em Supabase conectado e autenticado.
- Fase 1 esta funcional para operacao assistida.
- Fase 2 esta parcialmente implementada.
- Fases 3 e 4 ainda nao foram implementadas como produto final.

## Entregue e Funcionando

### Infraestrutura e base tecnica

- React + TypeScript + Vite.
- Tailwind com layout dark.
- Supabase Auth por email e senha.
- Rotas protegidas.
- Deploy em Firebase Hosting.
- Migrations SQL versionadas em `supabase/migrations`.

### Operacao inicial

- Login.
- Painel inicial com KPIs basicos.
- Cadastro de viagens.
- Edicao de viagens ja criadas.
- Armador padrao no cadastro:
  - `Cosco Shipping Specialized Carriers`
  - `CSSC`
- Importacao de manifestos `.xlsx` e `.csv`.
- Parsing de manifesto tabular e de manifesto real em layout carrier-style.
- Vinculo do manifesto a uma viagem existente.
- Criacao de viagem dentro do fluxo de importacao.
- Preview do manifesto antes da importacao.
- Identificacao de trecho `POL/POD` no manifesto.
- Consolidacao de trechos por viagem na tela `Viagens`.
- Consulta paginada de B/Ls.
- Filtro por viagem, POD, texto, revisao, financeiro e perfil de carga.
- Detalhe do B/L com edicao manual.
- Auditoria campo a campo em `audit_logs`.

### Fase 2 ja entregue

- Modulo de Revisao Manual com fila de pendencias.
- Correcao manual do B/L a partir da fila de revisao.
- Marcacao de B/L como `reviewed` com auditoria.
- Cadastro mestre de clientes.
- Ficha do cliente com dados cadastrais editaveis.
- Contatos do cliente por finalidade.
- Historico de B/Ls e invoices na ficha do cliente.

### Carga especial

- OOG detectado por indicios de dimensao/altura no manifesto.
- IMO detectado no parser por classe IMO / DG class.
- `UN number` capturado quando presente.
- Filtro de manifestos por perfil `IMO`.

## Parcial / Funciona com Restricoes

### Modelo de viagem

- A viagem hoje representa `armador + navio + numero da viagem`.
- `POL/POD` ficam gravados no B/L importado, nao numa entidade propria de trecho.
- Isso atende o fluxo atual, mas ainda nao modela formalmente um objeto de `trecho` ou `manifesto de viagem`.

### Parsing de manifesto

- O parser atual cobre:
  - planilhas tabulares
  - layout real ja usado nos testes
- Ainda nao ha garantia de leitura correta para qualquer layout novo de armador sem ajuste de regra.

### Validacao de funcionamento

- `npm run lint` passa.
- `npm run build` passa.
- Fluxos principais foram testados manualmente.
- Nao existem testes automatizados de unidade, integracao ou E2E.

## Pendente

### Fase 2

- Motor de calculo de taxas locais.
- Taxas locais.
- Vinculacao e manutencao de cliente diretamente no detalhe completo do B/L.
- Melhorias de usabilidade na revisao manual.
- Regras de associacao automatica cliente <-> B/L por CNPJ/consignatario.
- Overrides comerciais por cliente.

### Fase 3

- Faturamento.
- Alertas operacionais.
- Relatorios.

### Fase 4

- Line up TV.
- Administracao de usuarios.
- Administracao de tarifas.

## Principais Riscos Atuais

- Parser pode exigir ajuste para novos layouts de manifesto.
- Nao ha suite automatizada protegendo regressao.
- `xlsx` segue com vulnerabilidade conhecida sem correcao disponivel no ecossistema atual.
- O modelo de trecho ainda esta implicito nos B/Ls, nao explicitado em tabela propria.

## Proximas Entregas Recomendadas

1. Criar entidade explicita para `manifesto` ou `trecho da viagem`.
2. Exibir badge `IMO` e `OOG` ja no preview de importacao.
3. Implementar modulo real de `Taxas Locais`.
4. Adicionar testes automatizados para parser e fluxo de importacao.
5. Conectar o detalhe do B/L com a base de clientes.
6. Iniciar modulo de `Faturamento`.

## Conclusao Objetiva

O que ja foi implementado nao esta "perfeito".

Estado honesto:

- Esta funcional para os fluxos principais de Fase 1.
- Esta estavel o suficiente para continuar evoluindo em producao assistida.
- Ainda ha limites claros de modelagem, cobertura de testes e escopo funcional.
