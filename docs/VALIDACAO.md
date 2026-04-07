# Validação da Fase 1

Este roteiro valida a entrega atual sem depender de módulos das fases 2 a 4.

## 1. Validação técnica local

Execute na raiz do projeto:

```powershell
npm install
npm run lint
npm run build
```

Resultado esperado:

- `npm run lint` finaliza sem erros.
- `npm run build` finaliza sem erros.
- O build mostra um chunk separado de `xlsx`, confirmando o carregamento lazy do SheetJS.

Observação: `npm audit --omit=dev` reporta vulnerabilidades no pacote `xlsx` sem correção disponível. O pacote foi mantido porque a especificação exige SheetJS, e ele só é carregado no fluxo de upload/exportação.

## 2. Preparar Supabase

1. Crie um projeto no Supabase.
2. Execute, nesta ordem, os arquivos em `supabase/migrations`:
   - `001_schema.sql`
   - `002_rls.sql`
   - `003_functions.sql`
3. Crie um usuário em Authentication > Users.
4. Copie o UUID do usuário criado.
5. No SQL editor, crie o perfil do usuário substituindo o UUID:

```sql
INSERT INTO public.user_profiles (id, full_name, role, active)
VALUES ('COLE_AQUI_O_UUID_DO_USUARIO', 'Administrador Validação', 'admin', true)
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    active = true;
```

6. Rode o seed operacional:

```sql
-- Conteúdo de supabase/seeds/validation_seed.sql
```

## 3. Configurar o app

Crie `.env` a partir de `.env.example`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

Rode:

```powershell
npm run dev
```

Abra a URL indicada pelo Vite.

## 4. Fluxo manual no navegador

1. Acesse `/login`.
2. Faça login com o usuário criado no Supabase.
3. Confirme que `/painel` carrega sem erro.
4. Acesse `/manifestos`.
5. Clique em `Importar Manifesto`.
6. Selecione a viagem `MV VALIDACAO / 001W`.
7. Faça upload do arquivo `docs/fixtures/manifesto-exemplo.csv`.
8. Confirme o preview:
   - Deve mostrar 3 B/Ls.
   - Deve mostrar 4 containers.
   - Deve marcar pelo menos 1 B/L como pendente de revisão.
9. Confirme a importação.
10. A tabela de Manifestos deve listar os B/Ls importados.
11. Abra um B/L em `Ver detalhe`.
12. Altere um campo, por exemplo `Consignatário`.
13. Preencha a justificativa.
14. Salve.
15. Confirme que a seção `Auditoria` mostra o campo alterado com valor antigo, novo e justificativa.

## 5. Consultas de conferência

Após a importação e edição, valide no SQL editor:

```sql
SELECT id, consignee, review_status, financial_status
FROM public.bls
ORDER BY created_at DESC;

SELECT bl_id, container_number, is_oog, is_imo, imo_class
FROM public.bl_containers
ORDER BY id DESC;

SELECT entity_type, entity_id, field_name, old_value, new_value, justification
FROM public.audit_logs
ORDER BY changed_at DESC;
```

Resultado esperado:

- `bls.id` é o número do B/L, não UUID.
- Não existe isolamento por `owner_id`.
- Containers com `Height` preenchido ficam `is_oog = true`.
- Containers com `Class` preenchido ficam `is_imo = true`.
- Edição manual de B/L gera registros em `audit_logs`.
