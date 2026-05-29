# Ledger de Faturamento por B/L e Invoices Consolidadas

**Data:** 2026-05-29
**Escopo:** redesenhar o fluxo de invoices de taxas locais para suportar invoices individuais e consolidadas sobre os mesmos B/Ls, com saldo real controlado por B/L, reconciliação PIX exclusivamente por TXID e um modal novo para emissão de consolidadas.

## Contexto

O botão atual de "Nova Invoice" em `Faturamento.tsx` tenta listar B/Ls elegíveis usando a lógica antiga: B/L pronto para faturamento, financeiro pendente e sem invoice ativa vinculada. Essa regra conflita com o workflow desejado, porque as invoices individuais já são emitidas automaticamente. Depois da emissão individual, o B/L fica com `financial_status = invoiced` e vínculo em `invoice_bls`, então o modal esconde exatamente os B/Ls que deveriam poder entrar em uma consolidada.

Há três bloqueios codificados hoje:

1. `listBillingReadyBls` lista somente B/Ls pendentes e sem invoice ativa.
2. `create_invoice_from_bls_core` rejeita B/L com `financial_status != pending` e rejeita vínculo ativo existente.
3. `prevent_duplicate_active_invoice_bl_link` impede um segundo vínculo ativo do mesmo B/L em `invoice_bls`.

Portanto, o problema não é só visual. A regra de negócio atual assume que um B/L só pode estar em uma invoice ativa.

## Decisões

1. A invoice consolidada não substitui nem cancela a invoice individual no momento da emissão. Ela é um documento adicional, um envelope de cobrança sobre B/Ls ainda abertos.
2. O saldo real deve morar no B/L, não na invoice. Invoices são documentos que apontam para saldos.
3. Se uma consolidada é paga, todos os B/Ls vinculados ficam liquidados e as individuais desses B/Ls ficam marcadas como cobertas pela consolidada.
4. Se uma individual é paga, o B/L fica liquidado e qualquer consolidada aberta que continha esse B/L fica obsoleta; uma nova consolidada deve ser emitida para os B/Ls restantes.
5. Reconciliação automática é somente por TXID. CNPJ e valor podem aparecer como informação de conferência, mas nunca decidem baixa automática.
6. Demurrage fica fora do primeiro rollout. No futuro, deve migrar para a mesma lógica conceitual: obrigação/saldo, documento e liquidação.

## Arquitetura

### `bl_receivables`

Uma linha por B/L faturável de taxas locais. É a fonte da verdade financeira para aquele B/L.

Campos esperados:

- `id`
- `bl_id`
- `customer_id`
- `source`: inicialmente `local_charges`
- `original_amount_brl`
- `settled_amount_brl`
- `balance_brl`
- `status`: `open`, `partially_settled`, `settled`, `void`
- snapshots úteis: `voyage_id`, `cargo_mode`, `pol`, `pod`
- timestamps e auditoria

### `invoices`

Continua sendo a tabela de documentos emitidos ao cliente. Deve ganhar tipo/ciclo de vida compatível com documentos alternativos sobre o mesmo saldo.

Campos/estados esperados:

- `invoice_type`: `individual` ou `consolidated` para taxas locais
- status documentais: `issued`, `partially_paid`, `paid`, `covered`, `obsolete`, `cancelled`, `overdue`
- `obsolete_reason`
- `covered_by_invoice_id`
- `replaced_by_invoice_id`, nullable; preenchido quando uma consolidada obsoleta for reemitida com outro número

### `invoice_receivable_links`

Liga documentos a saldos de B/L.

Campos esperados:

- `invoice_id`
- `receivable_id`
- `bl_id`
- `subtotal_brl`
- `status`: `active`, `settled_by_this_invoice`, `settled_elsewhere`, `obsolete`
- snapshots do B/L no momento da emissão

Pode substituir gradualmente o papel financeiro de `invoice_bls`. `invoice_bls` pode ser mantida em compatibilidade enquanto telas antigas ainda dependem dela.

### `settlements`

Registra a aplicação de pagamentos contra saldos de B/L.

Campos esperados:

- `payment_id`
- `receivable_id`
- `invoice_id`
- `amount_brl`
- `settled_at`
- `method`
- `pix_txid`
- `source`: `manual`, `pix_extract`

### `invoice_lifecycle_events`

Histórico explícito para auditoria:

- invoice emitida
- invoice paga
- invoice coberta por outra
- invoice obsoleta por pagamento individual
- invoice cancelada
- conciliação por TXID

## Workflows

### Emissão individual automática

Quando um B/L fica pronto para faturamento:

1. Criar ou atualizar o `bl_receivable` do B/L.
2. Emitir a invoice individual.
3. Criar link ativo entre a invoice individual e o receivable.
4. Gerar PIX com TXID baseado no número da invoice.

### Emissão consolidada manual

O operador seleciona um cliente e escolhe B/Ls com receivables abertos.

Validações:

- todos os receivables são do mesmo cliente;
- todos estão `open` ou `partially_settled` com saldo positivo;
- nenhum receivable selecionado está em consolidada aberta ainda pagável;
- documento terá TXID próprio baseado no número da consolidada.

Resultado:

- cria invoice `consolidated`;
- cria links para os receivables;
- preserva as invoices individuais existentes.

### Pagamento de consolidada

A baixa deve acontecer em uma RPC transacional.

Resultado:

- cria `payment`;
- cria `settlements` para todos os receivables ligados à consolidada;
- marca os receivables como `settled`;
- marca a consolidada como `paid`;
- marca as individuais dos mesmos receivables como `covered`;
- grava lifecycle events e audit logs.

### Pagamento de individual

Resultado:

- cria `payment`;
- cria settlement para o receivable daquele B/L;
- marca o receivable como `settled`;
- marca a individual como `paid`;
- marca consolidadas abertas que continham esse receivable como `obsolete`;
- exige nova consolidação para os demais B/Ls, se o operador quiser cobrar em grupo.

### Reconciliação PIX

Reconciliação automática deve ser apenas por TXID.

Fluxo:

1. Parser do extrato lê `txid`, data e valor.
2. Serviço procura invoice pagável pelo TXID normalizado.
3. Se não houver match por TXID, não reconcilia automaticamente.
4. Se houver match único, a confirmação chama a mesma RPC de pagamento usada pela baixa manual.
5. A RPC valida valor, status pagável e receivables ligados.
6. A RPC aplica settlements e propaga estados.

Sem fallback por CNPJ + valor.

## RPCs

RPC é a função transacional no banco que o frontend chama como API. A regra financeira deve morar nessas funções para evitar baixa parcial, corrida entre usuários ou divergência entre baixa manual e reconciliação.

RPCs propostas:

- `create_local_individual_invoice_from_receivable`
- `create_local_consolidated_invoice`
- `register_ledger_invoice_payment`
- `reconcile_invoice_payment_by_txid`
- `obsolete_consolidated_invoice`
- `list_consolidatable_receivables`

`register_ledger_invoice_payment` deve ser o núcleo usado tanto pela baixa manual quanto pela reconciliação PIX.

## UX do Modal

O botão deve ser focado em invoice consolidada. O modo "B/L único" sai desse modal porque a invoice individual já é automática.

Layout:

- filtros à esquerda;
- tabela de receivables à direita;
- resumo fixo no rodapé;
- diagnóstico explícito para linhas não selecionáveis.

Campos:

- Cliente, obrigatório.
- Navio/viagem, opcional, mostrando apenas viagens com receivables abertos daquele cliente.
- Vencimento.
- Observações.
- Busca por B/L.

Tabela:

- seleção;
- B/L;
- navio/viagem;
- invoice individual existente;
- saldo aberto do B/L;
- elegibilidade/motivo.

Estados vazios:

- sem cliente: "Selecione um cliente para ver B/Ls com saldo aberto";
- sem saldo: "Cliente não possui B/Ls abertos para consolidar";
- conflito: "B/L já está em consolidada aberta";
- pago: "B/L já liquidado por invoice X".

## Rollout

1. **Schema:** criar tabelas novas sem desligar fluxo atual.
2. **Backfill:** popular receivables a partir de B/Ls, invoices e charge calculations atuais, gerando relatório de divergências.
3. **RPCs:** implementar criação, baixa e reconciliação usando ledger.
4. **Serviços/hooks:** trocar consultas de elegibilidade para ler receivables.
5. **UI:** redesenhar modal e ajustar tela de reconciliação.
6. **Compatibilidade:** manter dados antigos consultáveis e só remover bloqueios antigos quando a nova regra estiver coberta por testes.

## Testes Obrigatórios

- Criar consolidada com B/Ls que já têm individuais emitidas.
- Pagar consolidada e verificar receivables liquidados e individuais `covered`.
- Pagar individual e verificar consolidada aberta `obsolete`.
- Tentar conciliar PIX sem TXID correspondente e garantir que nada é baixado.
- Tentar conciliar mesmo TXID duas vezes e garantir idempotência/erro controlado.
- Simular pagamento concorrente e garantir um único settlement.
- Backfill deve bater totais ou produzir relatório de exceções.
- Modal deve mostrar B/Ls não selecionáveis com motivo, sem esconder silenciosamente.

## Fora de Escopo Inicial

- Migrar Demurrage para ledger.
- Reescrever documento PDF de demurrage.
- Reconciliar automaticamente por CNPJ + valor.
- Alterar cálculo de taxas locais.
- Suportar pagamento parcial por item dentro do B/L além do saldo do receivable.

## Critério de Sucesso

Depois do rollout, o sistema deve permitir múltiplos documentos históricos apontando para o mesmo B/L, mas deve impedir que o mesmo saldo de B/L seja pago duas vezes.
