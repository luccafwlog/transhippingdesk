# Portal do Cliente - Gate por CE Mercante

Status: aprovado para especificacao - 2026-06-15

## Nota de Terminologia

O termo correto da regra de negocio e **CE Mercante**. A especificacao usa apenas esse termo.

## Contexto

O Portal do Cliente ja expoe dados financeiros e operacionais do cliente autenticado: faturas de taxas locais, faturas de demurrage, recebiveis consolidaveis, BLs e containers. Hoje essas superficies sao liberadas principalmente pelo vinculo do processo ao `customer_id`, vindo da importacao do manifesto e da reconciliacao de cliente.

Com o portal do cliente, esse vinculo por CNPJ nao pode ser o unico marco de disponibilizacao. O cliente so deve enxergar BLs, containers, faturas, valores a pagar e consolidacao quando o BL correspondente ja tiver CE Mercante vinculado.

O sistema interno, porem, deve continuar operando antes desse marco. Importacao de manifesto, reconciliacao de cliente, calculo automatico de taxas locais, calculo de demurrage e emissao interna de documentos podem continuar acontecendo antes do CE Mercante. A mudanca e de visibilidade e acao no portal, nao de calculo interno.

## Objetivo

Adicionar uma regra central de liberacao do portal baseada em CE Mercante:

- BL so e liberado ao portal quando `bls.ce_mercante` estiver preenchido com texto nao vazio.
- Containers so aparecem no portal quando pertencem a um BL liberado.
- Faturas de taxas locais so aparecem quando os BLs vinculados estao liberados.
- Faturas de demurrage so aparecem quando o BL da fatura esta liberado.
- Recebiveis para consolidacao so aparecem quando o BL do recebivel esta liberado.
- Criacao de consolidada via portal deve rejeitar qualquer selecao que contenha BL sem CE Mercante.
- Fatura consolidada so aparece quando todos os BLs vinculados a ela tiverem CE Mercante.

## Fora de Escopo

- Bloquear calculo interno de taxas locais antes do CE Mercante.
- Bloquear calculo ou criacao interna de demurrage antes do CE Mercante.
- Alterar a importacao de manifesto ou a reconciliacao de cliente.
- Revalidar formato de CE Mercante no gate do portal.
- Expor ao cliente mensagens internas como "CE Mercante ausente".
- Alterar regras de PIX, conciliacao, baixa, cancelamento ou reversao.

## Abordagens Consideradas

1. Gate central nas RPCs do portal.
   - Recomendado.
   - Usa o banco como fonte de verdade da visibilidade do portal.
   - Protege listas, detalhes e acoes diretas por RPC.
   - Mantem o frontend simples, recebendo apenas dados liberados.

2. Gate apenas no frontend.
   - Menor alteracao inicial.
   - Inseguro, porque chamadas diretas de RPC por ID ainda poderiam expor detalhes, containers, itens ou pagamentos.
   - Facil de gerar divergencia entre telas.

3. Bloquear faturamento interno ate CE Mercante.
   - Mais rigido.
   - Contraria a regra aprovada: calculos internos podem acontecer antes do CE Mercante.
   - Aumenta impacto em faturamento, revisao e demurrage sem necessidade.

A abordagem escolhida e a 1.

## Regra de Liberacao

Criar uma definicao unica de "BL liberado para portal" no banco, por exemplo:

```sql
public.bl_has_portal_release(p_bl_id text)
```

A funcao retorna verdadeiro quando existe `public.bls.id = p_bl_id` e `trim(coalesce(ce_mercante, '')) <> ''`.

O gate considera:

- `ce_mercante IS NULL`: nao liberado.
- `ce_mercante = ''`: nao liberado.
- `ce_mercante` com apenas espacos: nao liberado.
- Qualquer texto nao vazio: liberado.

Nao cabe a esse helper validar 15 digitos. A validacao do CE Mercante pertence ao fluxo de importacao/edicao de CE. O gate do portal so decide visibilidade.

## Contratos Afetados

### BLs e Containers

`portal_list_operation_bls()` deve retornar apenas BLs do cliente autenticado que tenham CE Mercante preenchido. Como os containers sao agregados a partir dos BLs retornados, containers de BLs sem CE tambem deixam de aparecer.

### Recebiveis Consolidaveis

`portal_list_consolidatable_receivables()` deve retornar apenas recebiveis de BLs liberados.

`portal_create_consolidation(p_receivable_ids)` deve validar novamente a selecao recebida. Mesmo que a tela tenha listado apenas itens liberados, a RPC deve rejeitar a criacao se qualquer receivable selecionado pertencer a BL sem CE Mercante no momento da confirmacao.

### Faturas de Taxas Locais

`portal_list_invoices()` deve aplicar o gate por BL:

- Invoice individual vinculada a um BL so aparece se esse BL tiver CE Mercante.
- Invoice consolidada so aparece quando todos os BLs vinculados por `invoice_receivable_links` ativos tiverem CE Mercante.
- Invoice sem vinculo de BL comprovavel nao aparece.

`portal_invoice_details(p_invoice_id)` deve reaplicar a mesma regra antes de devolver dados da fatura. Isso impede acesso direto por ID a detalhes, itens, containers, pagamentos e payload PIX de documentos nao liberados.

### Demurrage

`portal_list_demurrage_invoices()` deve retornar apenas faturas de demurrage cujo `demurrage_invoices.bl_id` aponte para BL liberado por CE Mercante.

`portal_get_demurrage_invoice_detail(p_invoice_id)` deve reaplicar o gate antes de devolver detalhe e itens.

### Painel do Portal

O Painel do portal consome os hooks de faturas, demurrage e BLs/containers. Ao aplicar o gate nas RPCs, os quatro indicadores passam a contar apenas dados liberados:

- Taxas locais em aberto.
- Demurrage em aberto.
- Containers sem devolucao.
- Containers em demurrage.

## Comportamento Esperado

- Antes do CE Mercante, o cliente nao ve o BL, containers, faturas, valores ou opcoes de consolidacao daquele BL.
- Apos o CE Mercante ser preenchido, os dados passam a aparecer automaticamente na proxima consulta do portal.
- Consolidada com qualquer BL sem CE Mercante fica totalmente oculta.
- Consolidada sem links ativos fica oculta, porque nao e possivel provar que todos os BLs estao liberados.
- Fatura individual sem BL vinculado fica oculta pelo mesmo motivo.
- O portal nao explica ao cliente que ha dados ocultos por falta de CE Mercante.
- O sistema interno continua mostrando pendencias de CE Mercante em `/revisao` e demais telas operacionais quando aplicavel.

## Erros e Seguranca

As RPCs de detalhe e acao devem tratar dados nao liberados como nao encontrados ou acesso negado. O cliente nao deve receber confirmacao de que existe uma fatura/BL oculto por falta de CE Mercante.

As funcoes seguem o padrao existente do portal:

- `SECURITY DEFINER`.
- `SET search_path TO 'public', 'pg_temp'`.
- Escopo do cliente via `public.current_portal_customer_id()`.
- Filtro por `customer_id` combinado com o gate por CE Mercante.

O helper de liberacao deve ser pequeno, estavel e sem dependencia de estado externo alem de `public.bls`.

## Testes

Cobertura minima esperada:

- Teste de migration do helper, verificando que `bl_has_portal_release` existe e trata `NULL`, vazio e espacos como nao liberado.
- Teste de migration para `portal_list_operation_bls`, verificando filtro por CE Mercante.
- Teste de migration para `portal_list_consolidatable_receivables`, verificando filtro por CE Mercante.
- Teste de migration para `portal_create_consolidation`, verificando guarda transacional contra receivable de BL sem CE.
- Teste de migration para `portal_list_invoices`, verificando:
  - invoice individual exige BL com CE;
  - consolidada exige todos os BLs com CE;
  - consolidada sem links ativos nao aparece.
- Teste de migration para `portal_invoice_details`, verificando reaplicacao do gate antes de detalhes.
- Teste de migration para RPCs de demurrage do portal, verificando gate por `di.bl_id`.
- Testes de UI existentes do Painel, Faturas e BLs/Containers devem continuar passando com dados ja liberados.

Verificacoes finais:

- Rodar testes focados de portal/migrations.
- Rodar testes de paginas do portal afetadas.
- Rodar `npm run build`.
- Rodar `npm run test` completo se helpers compartilhados ou contratos de service forem alterados.

## Criterios de Aceite

- BL sem CE Mercante nao aparece no portal.
- Container de BL sem CE Mercante nao aparece no portal.
- Recebivel de BL sem CE Mercante nao aparece para consolidacao.
- Criacao de consolidada via portal falha se a selecao contiver BL sem CE Mercante.
- Fatura individual de BL sem CE Mercante nao aparece no portal.
- Fatura consolidada so aparece quando todos os BLs vinculados tiverem CE Mercante.
- Detalhe de fatura nao pode ser acessado por ID quando a fatura nao esta liberada.
- Fatura de demurrage de BL sem CE Mercante nao aparece no portal.
- Detalhe de demurrage nao pode ser acessado por ID quando o BL nao esta liberado.
- Calculos internos e emissao interna continuam funcionando antes do CE Mercante.
