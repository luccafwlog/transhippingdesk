# Validacao do Sistema

Roteiro executavel de validacao do estado atual em 2026-06-01.

## Ambientes

### Local sem Supabase real

Usado para validacao tecnica, testes unitarios, build e revisao visual limitada.

```powershell
npm install
npm test
npm run lint
npm run build
```

Resultado esperado: testes, lint e build sem erro.

Evidencia minima: saida dos comandos com exit code 0.

### Local com Supabase real

Usado quando o fluxo depende de Auth, RLS, RPCs, Edge Functions, storage ou dados persistidos.

Pre-condicoes gerais:

- `.env` apontando para projeto Supabase de validacao;
- usuario interno cadastrado com perfil compativel;
- dados de teste identificaveis para nao misturar com producao;
- nenhuma operacao destrutiva fora de dados criados para validacao.

### Producao

Usado apenas para validacao operacional controlada, sem reset e sem dados destrutivos. Toda evidencia deve indicar data, usuario e entidade validada.

## Modelo de registro de evidencia

Para cada fluxo, registrar:

- ambiente usado;
- usuario e perfil;
- dados de entrada;
- resultado: passou ou falhou;
- evidencia coletada;
- observacao ou link do erro, quando houver.

## 1. Login interno e permissoes

- Objetivo do fluxo: validar acesso interno, redirecionamento e permissoes visiveis por perfil.
- Ambiente necessario: local com Supabase real ou producao controlada.
- Perfil de usuario: admin, operacao e financeiro, conforme perfil disponivel.
- Dados de entrada ou fixture: usuario interno ativo.
- Pre-condicoes: usuario existe em Auth e possui role em tabela de perfis.
- Passos:
  1. Acessar `/login`.
  2. Entrar com usuario interno ativo.
  3. Confirmar redirecionamento para `/painel`.
  4. Abrir rotas permitidas ao perfil.
  5. Tentar acessar uma rota sem permissao, quando houver perfil limitado.
- Resultado esperado: login conclui, menu respeita permissao e rotas bloqueadas nao exibem dados sensiveis.
- Evidencia a coletar: screenshot do painel, perfil usado e rota bloqueada testada.
- Falhas comuns: sessao expirada, role ausente, RLS bloqueando leitura de perfil.
- Testes automatizados relacionados: `npm test` cobre helpers e componentes, mas este fluxo exige Supabase real.

## 2. Importacao CNTR, BB, Baplie, Granito, Veiculos e Vazios

- Objetivo do fluxo: validar que arquivos operacionais geram registros, pendencias e vinculos esperados.
- Ambiente necessario: local com Supabase real.
- Perfil de usuario: operacao ou admin.
- Dados de entrada ou fixture: arquivos de validacao CNTR, BB, Baplie EDI, COSCO Granito, Veiculos, Vazios Importacao e Vazios Exportacao.
- Pre-condicoes:
  - viagem cadastrada quando o importador exigir viagem;
  - clientes base cadastrados para casos de reconciliacao;
  - arquivos separados entre casos validos e casos com erro esperado.
- Passos:
  1. Acessar `/viagens` e confirmar viagem de teste.
  2. Importar manifesto CNTR em `/manifestos`.
  3. Abrir detalhe do B/L criado em `/manifestos/:blId`.
  4. Importar manifesto BB em `/carga-solta`.
  5. Importar Baplie EDI em `/baplie` e validar criacao de vazios de importacao.
  6. Importar planilha de veiculos em `/veiculos`.
  7. Importar planilha COSCO em `/granito`.
  8. Importar planilha de vazios em `/vazios-importacao` ou gerar via Baplie.
  9. Importar bookings em `/embarquevazios`.
- Resultado esperado: registros aparecem nas tabelas corretas, erros de linha ficam visiveis e B/Ls com cliente incerto entram em revisao/reconciliacao.
- Evidencia a coletar: numero da viagem, B/L, manifesto ou lote importado; screenshot da tabela final; resumo de erros quando houver.
- Falhas comuns: layout de arquivo divergente, cliente nao cadastrado, POD/POL sem cadastro, arquivo duplicado.
- Testes automatizados relacionados: `src/services/__tests__/manifestImport.test.ts`, `src/services/__tests__/breakbulkImport.test.ts`, `src/services/__tests__/manifestParser.test.ts`, `src/services/__tests__/breakbulkFixtures.real.test.ts`, `src/services/__tests__/manifestFixtures.real.test.ts`.

## 3. Revisao manual

- Objetivo do fluxo: resolver pendencias operacionais sem perder trilha de decisao.
- Ambiente necessario: local com Supabase real.
- Perfil de usuario: operacao ou admin.
- Dados de entrada ou fixture: B/L pendente de revisao por cliente, peso, CE Mercante ou dado obrigatorio ausente.
- Pre-condicoes: fila de `/revisao` possui ao menos um item pendente.
- Passos:
  1. Acessar `/revisao`.
  2. Confirmar contagem e filtros da fila.
  3. Abrir um item pendente.
  4. Corrigir dado faltante ou vincular cliente.
  5. Informar justificativa quando a tela exigir.
  6. Salvar a revisao.
  7. Recarregar a fila.
- Resultado esperado: item sai da fila ou muda de estado, dados corrigidos ficam visiveis e B/L avanca para Taxas Locais/Faturamento quando aplicavel.
- Evidencia a coletar: B/L revisado, justificativa usada, status antes/depois.
- Falhas comuns: conflito de edicao concorrente, usuario sem permissao para cliente, dado financeiro bloqueando avanco.
- Testes automatizados relacionados: `src/services/__tests__/blStatusService.test.ts` e testes de importacao que geram pendencia.

## 4. Taxas locais e faturamento

- Objetivo do fluxo: validar cadastro de tabelas/overrides, calculo de pendencias, emissao e baixa de invoices locais.
- Ambiente necessario: local com Supabase real.
- Perfil de usuario: financeiro ou admin.
- Dados de entrada ou fixture: B/L reconciliado e elegivel para taxas locais.
- Pre-condicoes:
  - tabela ativa em `/taxas-locais`;
  - B/L sem pendencia bloqueante;
  - cliente com dados fiscais suficientes.
- Passos:
  1. Acessar `/taxas-locais`.
  2. Confirmar filtros, contagem de tabelas e itens ativos/manuais.
  3. Criar ou editar tabela de teste.
  4. Acessar `/faturamento`.
  5. Validar abas Faturas, Validacao, Pendencias e Demurrage.
  6. Emitir invoice individual ou consolidada.
  7. Registrar pagamento manual de invoice local.
- Resultado esperado: invoice emitida, ledger atualizado, pagamento registrado e status refletido na tabela sem refresh manual.
- Evidencia a coletar: numero da invoice, B/L vinculado, valor, status antes/depois.
- Falhas comuns: B/L sem taxa calculada, cliente sem reconciliacao, permissao financeira ausente, ROE/dados fiscais ausentes.
- Testes automatizados relacionados: `src/pages/__tests__/Faturamento.test.ts`, `src/pages/__tests__/TaxasLocais.test.ts`, `src/services/__tests__/localCharges.test.ts`.

### Distincao atual em Faturamento

- `Validação`: esteira operacional antes do faturamento. Reune filtros de B/L, reconciliacao de cliente, gargalos de calculo/revisao/pronto para faturar e acoes em lote para calcular, revisar, marcar pronto e gerar invoices.
- `Pendências`: subconjunto de bloqueios de calculo/revisao. Usa `charge_status = 'review_required'` e serve para recalcular ou tratar linhas que impedem a invoice.
- Proposta de unificacao para revisao com dados reais: criar uma aba `Operacional` com faixas de prioridade da `Validação` e uma subsecao/tabela para as pendencias de revisao de cobranca. Manter `Faturas` e `Demurrage` separados. Nao remover `Validação` ou `Pendências` ate validar a tela unificada com dados reais.

## 5. Demurrage

- Objetivo do fluxo: validar calculo, edicao controlada, emissao e pagamento de demurrage.
- Ambiente necessario: local com Supabase real.
- Perfil de usuario: financeiro ou admin.
- Dados de entrada ou fixture: container com descarga, devolucao e free time conhecido.
- Pre-condicoes: B/L e container existem; taxas de demurrage configuradas.
- Passos:
  1. Acessar `/demurrage`.
  2. Filtrar ou localizar o container de teste.
  3. Conferir status de free time, vencido ou devolvido.
  4. Gerar invoice quando houver valor devido.
  5. Emitir ou cancelar invoice conforme caso de validacao.
  6. Confirmar aparicao da invoice em `/faturamento`, aba Demurrage.
- Resultado esperado: calculo segue regras configuradas e invoice muda de estado com feedback recuperavel em erro.
- Evidencia a coletar: container, B/L, invoice de demurrage, valor calculado e status.
- Falhas comuns: data de descarga ausente, free time divergente, taxa nao configurada, ROE ausente.
- Testes automatizados relacionados: `src/services/demurrage/__tests__/calculateDemurrage.test.ts`.

## 6. Conciliacao PIX e reconciliacao manual

- Objetivo do fluxo: validar conciliacao por extrato PIX preservando revisao humana para casos ambiguos.
- Ambiente necessario: local com Supabase real.
- Perfil de usuario: financeiro ou admin.
- Dados de entrada ou fixture: arquivo "QR Codes recebidos" `.xlsx` com TXID que case uma invoice e outro TXID/valor ambiguo ou sem candidato.
- Pre-condicoes:
  - invoice local ou de demurrage emitida;
  - extrato PIX contem TXID esperado;
  - casos ambiguos nao devem ser confirmados automaticamente.
- Passos:
  1. Acessar `/reconciliacao`.
  2. Importar o extrato PIX.
  3. Conferir contagem de correspondencias, ambiguas e total.
  4. Abrir a explicacao dos itens ambiguos.
  5. Confirmar apenas pagamentos nao ambiguos.
  6. Validar em `/faturamento` ou `/demurrage` que o pagamento foi baixado.
- Resultado esperado: pagamentos seguros sao conciliados, ambiguos permanecem pendentes de revisao humana e a tela mostra motivo, campo de ambiguidade, dados que conferem/divergem e risco residual.
- Evidencia a coletar: TXID, invoice, valor, contagem de ambiguos e status pago.
- Falhas comuns: extrato sem transacoes, TXID repetido, valor divergente, invoice ja paga, cliente/documento divergente.
- Testes automatizados relacionados: `src/services/__tests__/reconciliacao.test.ts`.
- Dependencia de auditoria: invoices locais sao conciliadas por TXID via `reconcile_invoice_payment_by_txid`, que registra ledger/payment/settlements e marca a invoice com `pix_txid` e `conciliated_by_extract`. Demurrage e marcado diretamente em `demurrage_invoices` com `status = paid`, `paid_at`, `pix_txid` e `conciliated_by_extract`. Quando houver decisao manual fora desse fluxo, validar tabela ou RPC especifica antes de alterar schema.

## 7. Portal do cliente

- Objetivo do fluxo: validar acesso externo e consulta de cobrancas pelo cliente.
- Ambiente necessario: local com Supabase real ou producao controlada.
- Perfil de usuario: cliente com token/sessao valida.
- Dados de entrada ou fixture: cliente com invoice local ou demurrage visivel no portal.
- Pre-condicoes: acesso configurado para `/portal/login`; invoice vinculada ao cliente.
- Passos:
  1. Acessar `/portal/login`.
  2. Autenticar com credenciais ou token do cliente.
  3. Abrir `/portal/billing`.
  4. Conferir lista de cobrancas.
  5. Abrir detalhe quando disponivel.
- Resultado esperado: cliente ve apenas dados proprios, totais batem com faturamento interno e estados de loading/vazio/erro sao claros.
- Evidencia a coletar: cliente usado, invoice visivel, screenshot da lista/detalhe.
- Falhas comuns: token expirado, RLS bloqueando dados, invoice sem vinculo com cliente.
- Testes automatizados relacionados: validacao manual com Supabase real.

## 8. Admin de usuarios

- Objetivo do fluxo: validar manutencao de usuarios internos.
- Ambiente necessario: local com Supabase real ou producao controlada.
- Perfil de usuario: admin.
- Dados de entrada ou fixture: usuario interno de teste.
- Pre-condicoes: admin autenticado e usuario alvo existente.
- Passos:
  1. Acessar `/admin/usuarios`.
  2. Alterar role ou status do usuario de teste.
  3. Salvar.
  4. Revalidar login/permissao do usuario alterado.
- Resultado esperado: alteracao persiste e permissao visivel acompanha a role/status.
- Evidencia a coletar: usuario alterado, role/status antes/depois.
- Falhas comuns: usuario sem perfil, permissao admin ausente, cache de sessao.
- Testes automatizados relacionados: validacao manual com Supabase real.

## 9. Relatorios, alertas e Line Up TV

- Objetivo do fluxo: validar fluxos complementares sem alterar dados criticos.
- Ambiente necessario: local com Supabase real ou producao controlada.
- Perfil de usuario: usuario interno com acesso aos modulos.
- Dados de entrada ou fixture: dados operacionais suficientes para gerar listas.
- Pre-condicoes: existem viagens, B/Ls, invoices ou alertas.
- Passos:
  1. Abrir `/relatorios`, navegar pelas abas e exportar um relatorio.
  2. Abrir `/alertas`, reconhecer um alerta de teste e fechar quando permitido.
  3. Abrir `/line-up-tv/display`.
- Resultado esperado: relatorios exportam, alertas mudam de estado e Line Up TV carrega sem erro.
- Evidencia a coletar: arquivo exportado, alerta reconhecido/fechado, screenshot do painel.
- Falhas comuns: falta de dados, permissao insuficiente, filtro escondendo resultados.
- Testes automatizados relacionados: validacao manual com Supabase real.

## 10. Redirecionamentos ativos

- Objetivo do fluxo: validar compatibilidade de rotas antigas.
- Ambiente necessario: local sem Supabase real para navegacao basica; Supabase real se a rota final exigir dados.
- Perfil de usuario: usuario interno autenticado quando necessario.
- Dados de entrada ou fixture: nenhum.
- Pre-condicoes: app rodando.
- Passos:
  1. Acessar `/vazios`.
  2. Acessar `/demurrage/invoices`.
  3. Acessar `/demurrage/reconciliacao`.
- Resultado esperado:
  - `/vazios` redireciona para `/embarquevazios`;
  - `/demurrage/invoices` redireciona para `/demurrage`;
  - `/demurrage/reconciliacao` redireciona para `/reconciliacao`.
- Evidencia a coletar: URL final apos redirecionamento.
- Falhas comuns: rota protegida sem sessao, history mantendo rota antiga.
- Testes automatizados relacionados: validacao manual.

## Criterios de pronto para melhoria funcional

Antes de considerar uma melhoria pronta:

- confirmar ambiente usado;
- registrar evidencia do fluxo afetado;
- rodar `npm test` quando houver cobertura automatizada aplicavel;
- rodar `npm run build` antes de PR;
- documentar dependencia de Supabase real, seed ou fixture;
- atualizar este roteiro quando a melhoria alterar passos, resultado esperado ou evidencia.
