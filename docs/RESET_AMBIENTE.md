# Reset do Ambiente de Testes

Use este procedimento quando precisar zerar a base operacional entre rodadas de teste.

## O que o reset preserva

- `auth.users`
- `public.user_profiles`
- `public.carriers`
- `public.vessels`
- `public.ports`
- `public.voyages`
- `public.customers`
- `public.customer_contacts`
- `public.customer_rate_overrides`
- `public.charge_tables`
- `public.charge_table_items`

## O que o reset remove

- lotes de importacao de manifesto
- B/Ls
- containers
- calculos
- invoices
- pagamentos
- alertas
- auditoria
- contador de invoice

## Como executar

1. Abra o projeto no Supabase.
2. Entre em `SQL Editor`.
3. Abra o arquivo:

`supabase/scripts/reset_operational_data.sql`

4. Cole o conteudo no editor.
5. Execute.

## Arquivo de reset

[reset_operational_data.sql](C:\Users\lucca\OneDrive - Fwlog Brasil Representações Ltda\Transhipping Desk\supabase\scripts\reset_operational_data.sql)

## Conferencia minima

Rode esta consulta para confirmar o reset:

```sql
SELECT 'import_batches' AS table_name, COUNT(*) AS total FROM public.import_batches
UNION ALL
SELECT 'bls', COUNT(*) FROM public.bls
UNION ALL
SELECT 'bl_containers', COUNT(*) FROM public.bl_containers
UNION ALL
SELECT 'customers_preserved', COUNT(*) FROM public.customers
UNION ALL
SELECT 'customer_contacts_preserved', COUNT(*) FROM public.customer_contacts
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM public.audit_logs;
```

Resultado esperado:

- `import_batches`, `bls`, `bl_containers` e `audit_logs` devem retornar `0`
- `customers_preserved` e `customer_contacts_preserved` devem manter seus valores
- `voyages`, `carriers`, `vessels` e `ports` continuam disponiveis

## Observacao

Esse reset foi desenhado para repetir testes rapidamente sem precisar recriar nem a estrutura da viagem nem o cadastro mestre de clientes.
