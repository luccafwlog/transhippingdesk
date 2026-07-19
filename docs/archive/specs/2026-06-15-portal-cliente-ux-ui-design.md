# Portal do Cliente - UX/UI Painel, Faturas, BLs e Containers

Status: aprovado para especificacao - 2026-06-15

## Contexto

O Portal do Cliente ja possui areas para dashboard, faturas, operacao, notificacoes e perfil. A experiencia atual ficou funcional, mas ainda mistura informacoes de resumo, consultas financeiras e consulta operacional em telas com modelos visuais diferentes.

O objetivo desta melhoria e simplificar a experiencia do cliente e alinhar as telas do portal com os padroes ja usados no sistema interno, mantendo o escopo de seguranca do cliente autenticado.

## Objetivo

Melhorar o Portal do Cliente em tres frentes:

- Transformar o dashboard em um **Painel** minimalista com apenas quatro indicadores acionaveis.
- Fazer a pagina **Faturas** do portal espelhar a aba **Faturas** do sistema interno, aplicada aos dados do cliente autenticado.
- Substituir a area **Operacao** por **BLs e Containers**, com duas abas independentes: BLs e Containers.

## Fora de Escopo

- Expor funcionalidades administrativas no portal, como validacao, pendencias internas, registro manual de pagamento, cancelamento de invoice ou edicao de cobrancas.
- Alterar o modelo de autenticacao do portal.
- Criar cadastro publico.
- Alterar regras de faturamento, consolidacao, demurrage, PIX ou conciliacao.
- Refatorar o sistema interno fora do necessario para reutilizar padroes visuais.

## Abordagens Consideradas

1. Reusar visualmente os componentes internos, adaptando dados do portal.
   - Melhor equilibrio entre consistencia, seguranca e escopo.
   - Mantem RPCs escopadas ao cliente autenticado.
   - Evita trazer acoes administrativas para o portal.

2. Generalizar componentes internos para aceitar fontes interna e portal.
   - Pode ser melhor no longo prazo.
   - Maior risco agora, porque exige mexer em contratos compartilhados e tipos de faturamento.

3. Copiar a pagina interna inteira e esconder o que nao serve.
   - Rapido visualmente.
   - Fragil e propenso a expor acoes ou estados administrativos indevidos.

A abordagem escolhida e a 1.

## Painel

O menu e a rota inicial do portal devem usar o nome **Painel**, nao **Dashboard**.

A tela deve ser minimalista e conter somente quatro cards:

1. **Taxas locais em aberto**
   - Valor total pendente de taxas locais.
   - Quantidade de faturas de taxas locais em aberto.
   - Link para `Faturas > Taxas Locais`.

2. **Demurrage em aberto**
   - Valor total pendente de demurrage.
   - Quantidade de faturas de demurrage em aberto.
   - Link para `Faturas > Demurrage`.

3. **Containers sem devolucao**
   - Quantidade de containers do cliente sem `return_date`.
   - Link para `BLs e Containers > Containers`, filtrado por containers sem devolucao.

4. **Containers em demurrage**
   - Quantidade de containers sem devolucao e com dias de demurrage maiores que zero.
   - Link para `BLs e Containers > Containers`, filtrado por demurrage.

A tela nao deve conter listas, comentarios explicativos, alertas textuais extensos ou titulo alternativo como "pendencias do cliente". O titulo visivel da pagina deve ser **Painel**.

## Faturas

A pagina **Faturas** do portal deve manter duas abas:

- **Taxas Locais**
- **Demurrage**

As duas abas devem seguir a configuracao visual da aba **Faturas** do sistema interno:

- Barra de filtros no padrao `FilterBar`.
- Cards de resumo.
- Tabela no estilo de `InvoicesTable`.
- Paginacao.
- Estados de carregamento, vazio e erro consistentes.
- Acao de detalhe por linha.
- Exportacao em Excel (`.xlsx`), nunca CSV.

O filtro **Cliente** deve ficar oculto no portal, porque o cliente ja esta definido pela sessao autenticada.

### Taxas Locais

A aba **Taxas Locais** deve listar as faturas locais do cliente autenticado.

Filtros esperados:

- Numero do B/L.
- Numero da Fatura.
- Navio / Viagem.
- POD.
- Tipo de Fatura.
- Status.
- Itens por pagina.
- Emissao de / ate.
- Pagamento de / ate.

A tabela deve seguir a estrutura interna quando aplicavel:

- Numero do B/L.
- Fatura.
- Tipo.
- Navio / Viagem / POD.
- Emissao.
- Pagamento.
- Financeiro.
- Status.
- Acoes.

Acoes administrativas internas nao devem aparecer para o cliente.

### Demurrage

A aba **Demurrage** deve usar a mesma configuracao de experiencia da aba **Taxas Locais**, adaptada ao contrato de demurrage.

Filtros esperados:

- B/L.
- Documento.
- Navio.
- Viagem.
- POL.
- POD.
- Status.
- Itens por pagina.
- Emissao de / ate.
- Vencimento de / ate quando houver dado disponivel.

A tabela deve mostrar:

- Documento.
- B/L.
- Navio / Viagem.
- POL / POD.
- Emissao.
- Vencimento.
- Total USD.
- Total BRL.
- Status.
- Acoes.

Demurrage deve continuar disponivel como aba separada dentro de **Faturas**.

## BLs e Containers

A antiga entrada **Operacao** deve ser renomeada para **BLs e Containers** na navegacao e na pagina.

A tela deve ter duas abas:

- **BLs**
- **Containers**

O objetivo e permitir duas consultas operacionais diferentes sem obrigar o usuario a abrir accordions de B/L para encontrar containers especificos.

### Aba BLs

Lista todos os B/Ls do cliente autenticado com suas informacoes operacionais.

Colunas esperadas:

- B/L.
- CE Mercante.
- Navio.
- Viagem.
- POL.
- POD.
- Containers.
- Containers devolvidos.
- Containers sem devolucao.
- Containers em demurrage.
- Situacao.
- Acao de detalhe somente leitura, quando houver detalhe a exibir.

Filtros esperados:

- B/L.
- CE Mercante.
- Navio.
- Viagem.
- POL.
- POD.
- Situacao de devolucao dos containers do B/L.
- Status operacional.
- Itens por pagina.

A situacao de devolucao deve cobrir, no minimo:

- Todos.
- Todos devolvidos.
- Com containers sem devolucao.
- Com containers em demurrage.
- Sem descarga.

### Aba Containers

Lista todos os containers do cliente autenticado, derivados dos B/Ls retornados pelo portal.

Colunas esperadas:

- Container.
- Tipo.
- B/L.
- CE Mercante.
- Navio.
- Viagem.
- POL.
- POD.
- Descarga.
- Devolucao.
- Dias de uso.
- Free time.
- Dias em demurrage.
- Status.

Filtros esperados:

- Container.
- B/L.
- CE Mercante.
- Navio.
- Viagem.
- POL.
- POD.
- Situacao de devolucao.
- Status operacional.
- Itens por pagina.

Status operacional segue o contrato atual:

- Sem descarga.
- Dentro do free time.
- Em demurrage.
- Devolvido.

Cada aba deve exportar o resultado filtrado em Excel (`.xlsx`).

## Dados e Contratos

Sempre que possivel, a implementacao deve reutilizar o contrato atual de `portal_list_operation_bls()`.

Como o payload atual ja retorna containers dentro de cada B/L, a aba **Containers** pode ser derivada no frontend a partir dos dados da aba **BLs**, sem nova RPC.

Se algum dado necessario para o **Painel** nao estiver disponivel diretamente, a implementacao deve preferir derivar dos hooks existentes do portal:

- Faturas locais: `usePortalInvoices`.
- Demurrage: `usePortalDemurrageInvoices`.
- BLs e containers: `usePortalOperationBls`.
- Saldo do cliente: `usePortalAuth().overview`, apenas quando coerente com as metricas detalhadas.

Uma nova RPC so deve ser criada se os calculos do Painel ficarem incorretos ou custosos demais no frontend.

## Exportacao

Todas as exportacoes novas ou alteradas no Portal do Cliente devem ser em Excel (`.xlsx`).

Nao usar CSV nas telas:

- Faturas > Taxas Locais.
- Faturas > Demurrage.
- BLs e Containers > BLs.
- BLs e Containers > Containers.

O Painel nao tem exportacao.

A implementacao deve reutilizar a infraestrutura existente de `src/services/exports.ts`, incluindo a sanitizacao contra formula injection.

## Navegacao

Navegacao esperada:

- Painel
- Faturas
- BLs e Containers
- Perfil

Rotas podem permanecer tecnicamente iguais quando isso reduzir risco, mas o texto visivel deve seguir os nomes aprovados.

Links dos cards do Painel:

- Taxas locais em aberto -> `/portal/billing`, aba Taxas Locais.
- Demurrage em aberto -> `/portal/billing`, aba Demurrage.
- Containers sem devolucao -> `/portal/operacao`, aba Containers, filtro sem devolucao.
- Containers em demurrage -> `/portal/operacao`, aba Containers, filtro em demurrage.

A rota tecnica `/portal/operacao` pode permanecer nesta entrega para reduzir risco, mas todo texto visivel deve usar **BLs e Containers**.

## Testes

Cobertura minima:

- Teste do Painel verificando os quatro cards, seus valores derivados e links de saida.
- Teste da pagina Faturas verificando:
  - abas Taxas Locais e Demurrage;
  - filtro Cliente ausente;
  - exportacao chama workbook Excel, nao CSV;
  - tabela de Taxas Locais no padrao interno.
- Teste da pagina BLs e Containers verificando:
  - abas BLs e Containers;
  - coluna POL na aba BLs;
  - filtros separados de navio, viagem, POL e POD;
  - aba Containers derivada dos containers dos B/Ls;
  - filtros de devolucao e demurrage.
- Testes unitarios para helpers de flatten/filtragem/exportacao, se forem criados.

Verificacoes finais:

- Rodar testes focados do portal.
- Rodar `npm run build`.
- Rodar `npm run test` completo se componentes compartilhados de faturamento/exportacao forem alterados.
- Validar no browser as tres telas principais do portal em desktop e mobile.

## Criterios de Aceite

- O menu do portal mostra **Painel**, **Faturas**, **BLs e Containers** e **Perfil**.
- O Painel mostra somente quatro cards aprovados.
- Faturas do portal tem abas **Taxas Locais** e **Demurrage**.
- O filtro Cliente nao aparece no portal.
- Exportacoes alteradas do portal geram `.xlsx`, nao CSV.
- **BLs e Containers** tem abas **BLs** e **Containers**.
- A aba BLs mostra POL e permite filtrar por navio, viagem, POL, POD, B/L, CE Mercante e situacao.
- A aba Containers permite consultar containers diretamente, sem depender de abrir B/L.
- O portal continua exibindo apenas dados do cliente autenticado.
