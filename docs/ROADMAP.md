# Roadmap do Sistema

Estado de referencia do projeto em 2026-04-11.

## Status Geral

- Base web publicada e operacional em Firebase Hosting.
- Backend em Supabase conectado e autenticado.
- Fase 1 esta entregue e operando.
- Fase 2 esta entregue em parte relevante, mas ainda precisa de estabilizacao.
- Fases 3 e 4 ainda nao foram implementadas como produto final.

## Entregue e Em Uso

### Infraestrutura e base tecnica

- React + TypeScript + Vite.
- Supabase Auth por email e senha.
- Rotas protegidas por perfil.
- Deploy em Firebase Hosting.
- Migrations SQL versionadas em `supabase/migrations`.
- Tema visual com variacoes e layout principal revisado.
- Suite minima de testes com `vitest` para parser e importadores criticos.

### Operacao de viagens e manifestos

- Cadastro de viagens.
- Edicao de viagens.
- Exclusao de viagens quando permitida pelas regras atuais.
- Armador padrao no cadastro:
  - `Cosco Shipping Specialized Carriers`
  - `CSSC`
- Viagens com multiplos POL e multiplos POD.
- ETD por POL.
- ETA e ATA por POD.
- Consolidacao de trechos por viagem.
- Filtros por navio e numero de viagem.

### Manifestos CNTR

- Importacao de manifestos `.xlsx` e `.csv`.
- Parsing de manifesto tabular e de manifesto real carrier-style.
- Preview antes da importacao.
- Criacao de viagem dentro do fluxo de importacao.
- Identificacao de trecho `POL/POD` no manifesto.
- Consulta paginada de B/Ls.
- Filtros por viagem, POL, POD, texto, revisao, financeiro e perfil.
- Exportacao de manifestos.
- Tela consolidada de containers.
- Importacao complementar de IMO/OOG por planilha.
- Importacao complementar de CE Mercante por planilha.
- Detalhe do B/L com edicao manual.
- Auditoria campo a campo em `audit_logs`.

### Carga Solta / BB

- Modulo de manifestos BB ativo.
- Importacao de manifesto BB no layout operacional atual.
- Consulta paginada de B/Ls BB.
- Exportacao da tela de BB.
- Importacao complementar de CE Mercante por planilha.
- Integracao da carga solta com a viagem.

### Veiculos

- Modulo de veiculos ativo.
- Importacao de planilha de veiculos.
- Validacao de vinculo `viagem -> container -> BL`.
- Varios veiculos por container.
- Varios veiculos por BL.
- Listagem, busca, filtros e cards de resumo.
- Exibicao de veiculos no detalhe do B/L CNTR.

### Clientes

- Cadastro mestre de clientes.
- Importacao de base de clientes.
- CNPJ/CPF e Razao Social obrigatorios na importacao.
- Importacao de multiplos emails por cliente.
- Ficha do cliente com edicao.
- Contatos por finalidade.
- Historico de B/Ls e invoices na ficha do cliente.
- Exclusao de cliente.
- Filtros por emails, B/Ls e saldo pendente.

### Revisao Manual

- Fila de revisao manual.
- Correcao manual de B/L com justificativa.
- Marcacao de B/L como `reviewed`.
- Auditoria da revisao.

## Entregue, Mas Ainda Precisa Complemento

### Parsing de manifesto

- O parser atual cobre os layouts ja utilizados nos testes.
- Ainda nao ha garantia de leitura correta para qualquer layout novo de armador.
- O parser ainda depende de ajustes iterativos conforme novos manifestos reais aparecem.

### Modelagem de viagem

- O sistema hoje opera bem com o modelo atual.
- Porem, o conceito de trecho ainda esta implicito nos B/Ls importados.
- Ainda nao existe uma entidade formal de trecho ou manifesto de viagem.

### Qualidade e regressao

- `npm test` passa.
- `npm run lint` passa.
- `npm run build` passa.
- Ha cobertura automatizada inicial para:
  - parser CNTR
  - parser BB
  - importacao de veiculos
  - importacao de CE Mercante
- Os fluxos principais seguem exigindo validacao manual complementar.

### UX operacional

- O visual principal esta em nivel utilizavel e consistente.
- Ainda existe espaco para refinamento fino em tabelas, dropdowns, responsividade e densidade de informacao.

## Nao Tratar Como Pronto

### Fase 2 pendente

- Motor de calculo de taxas locais.
- Modulo real de Taxas Locais.
- Regras comerciais por cliente.
- Melhorias de produtividade na revisao manual.
- Reconciliacao automatica mais forte cliente <-> B/L.

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
- A suite automatizada ainda e inicial e cobre apenas os fluxos mais criticos.
- `xlsx` segue com vulnerabilidade conhecida sem correcao disponivel no ecossistema atual.
- O modelo de trecho ainda esta implicito nos B/Ls.
- Ainda existem rotas placeholder acessiveis por URL direta, embora escondidas da navegacao principal.

## Proximos Passos Recomendados

### Fase 2.1 - Estabilizacao

1. Atualizar documentacao operacional e roteiro de validacao.
2. Expandir a suite automatizada inicial para ampliar cobertura de parser e importadores.
3. Revisar navegacao para esconder ou marcar placeholders.
4. Reforcar UX da revisao manual e dos previews de importacao.

### Fase 2.2 - Endurecimento da operacao

1. Melhorar parser com novos fixtures reais.
2. Refinar reconciliacao automatica cliente <-> B/L.
3. Decidir se a entidade de trecho sera formalizada antes da fase financeira.
4. Revisar relatorios executivos de viagem para separar melhor container, carga geral, veiculos e BB.

### Fase 3 - Financeiro

1. Implementar Taxas Locais.
2. Implementar Faturamento.
3. Implementar Alertas.
4. Implementar Relatorios.

## Conclusao Objetiva

Estado honesto:

- O sistema ja atende a operacao assistida de viagens, manifestos CNTR, carga solta, veiculos, revisao e clientes.
- O sistema ainda nao deve ser tratado como produto completo.
- O proximo ciclo correto nao e abrir novos modulos financeiros imediatamente.
- O proximo ciclo correto e estabilizar, testar e documentar melhor o que ja esta em uso.
