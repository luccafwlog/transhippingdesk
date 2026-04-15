# Roadmap do Sistema

Estado de referencia do projeto em 2026-04-15.

## Status Geral

- Base web publicada e operacional em Firebase Hosting.
- Backend em Supabase conectado e autenticado.
- Fase 1 esta entregue e operando.
- Fase 2 esta entregue em parte relevante, com hardening tecnico concluido.
- Migration `020_billing_hybrid_workflow` versionada no repositorio.
- Etapa A de Taxas Locais ativa com calculo por B/L, overrides e other charges manuais no detalhe do B/L.
- Modulo de Faturamento hibrido ativo no app (single B/L + consolidada).
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
- Suite dedicada de integracao com Supabase real (`npm run test:integration`, gated por variaveis de ambiente).

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
- Tratamento de conflito concorrente com mensagem especifica ao operador.

### Observabilidade operacional minima

- Eventos criticos registrados em `audit_logs` com `entity_type = system_event`:
  - `manifest_import_rate_limited` (P0429)
  - `manifest_import_duplicate_hash` (23505)
  - `bl_review_concurrent_conflict` (40001)
  - `invoice_create_conflict`
  - `invoice_payment_invalid`
  - `invoice_cancel_blocked`

### Taxas Locais

- Tela operacional ativa em `/taxas-locais`.
- CRUD de tabelas de taxa e itens.
- Overrides por cliente.
- Simulacao por B/L.
- Lancamentos manuais de other charges por B/L.
- Acoes em lote:
  - calcular/recalcular
  - marcar revisado
  - marcar pronto para faturar
- Exportacao da operacao filtrada.

### Faturamento

- Tela funcional em `/faturamento`.
- Emissao hibrida:
  - por B/L unico
  - consolidada por multiplos B/Ls do mesmo cliente
- Snapshot de itens na invoice via `invoice_items`.
- Vinculo N:N invoice <-> B/L via `invoice_bls`.
- Registro de baixa parcial e total.
- Cancelamento com rollback de status financeiro do B/L.
- Detalhe da invoice com:
  - cabecalho
  - itens
  - pagamentos
  - B/Ls vinculados
- Geracao de PDF da invoice no frontend via `jsPDF` (estavel com React 19).

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
- `npm run test:integration` disponivel para homologacao com Supabase real.
- Ha cobertura automatizada inicial para:
  - parser CNTR
  - parser BB
  - importacao de veiculos
  - importacao de CE Mercante
  - validacao de hardening (dedupe/rate-limit/optimistic-lock/RLS) via suite de integracao gated
- Os fluxos principais seguem exigindo validacao manual complementar.

### UX operacional

- O visual principal esta em nivel utilizavel e consistente.
- Ainda existe espaco para refinamento fino em tabelas, dropdowns, responsividade e densidade de informacao.

## Nao Tratar Como Pronto

### Fase 2 pendente

- Homologar o motor de calculo de taxas locais (Etapa A) com migrations `016` a `019`.
- Expandir o modulo de Taxas Locais (overrides completos, fluxo de faturamento e excecoes por cliente).
- Regras comerciais por cliente.
- Melhorias de produtividade na revisao manual.
- Reconciliacao automatica mais forte cliente <-> B/L.

### Fase 3

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

### Fase 2.1 - Gate de estabilizacao (executado)

1. Hardening de banco aplicado ate migration `015`.
2. Documentacao de validacao e baseline atualizada.
3. Eventos criticos mapeados em observabilidade minima (`audit_logs`).
4. Suite de integracao com Supabase real disponivel para homologacao controlada.

### Fase 2.2 - Endurecimento da operacao

1. Executar homologacao operacional completa em ambiente real com evidencias.
2. Melhorar parser com novos fixtures reais.
3. Refinar reconciliacao automatica cliente <-> B/L.
4. Decidir se a entidade de trecho sera formalizada antes da fase financeira.

### Fase 3 - Operacao expandida

1. Implementar Alertas operacionais.
2. Implementar Relatorios.
3. Integrar alertas financeiros no modulo de faturamento.

## Conclusao objetiva

Estado honesto:

- O sistema ja atende a operacao assistida de viagens, manifestos CNTR, carga solta, veiculos, revisao e clientes, com hardening tecnico aplicado.
- O sistema ainda nao deve ser tratado como produto completo.
- O proximo ciclo correto e fechar homologacao operacional e abrir o sprint de Taxas Locais.
