# Reset do Ambiente de Testes

Atualizado em 2026-06-01.

Use este procedimento quando precisar zerar dados operacionais entre rodadas de teste.

## Script oficial

Arquivo de reset:

`supabase/scripts/reset_operational_data.sql`

## Como executar

1. Abra o projeto no Supabase.
2. Entre em `SQL Editor`.
3. Abra o arquivo `supabase/scripts/reset_operational_data.sql`.
4. Cole o conteudo no editor.
5. Execute.

## Dados preservados

O script preserva cadastros estruturais e comerciais, incluindo usuarios, roles, armadores, navios, portos, viagens, clientes, contatos, tabelas de taxas e overrides.

## Dados removidos

O script remove dados operacionais de teste: import batches, B/Ls, containers, veiculos, calculos, invoices, pagamentos, alertas, auditoria e contador de invoice.

## Conferencia minima

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

- `import_batches`, `bls`, `bl_containers` e `audit_logs` zerados
- `customers_preserved` e `customer_contacts_preserved` mantidos

## Nota

Sempre use caminho relativo ao repositorio. Referencias antigas com caminho absoluto local foram descontinuadas.
