# Transhipping Desk

Plataforma interna para operação de agente marítimo, conforme a Fase 1 do prompt de desenvolvimento.

## Implementado

- React + TypeScript + Vite.
- Tailwind CSS com tema dark naval/industrial.
- Supabase Auth com email/senha.
- Rotas protegidas e rotas admin por `user_profiles.role`.
- Migrations Supabase em `supabase/migrations`.
- Painel inicial com KPIs carregados por queries pontuais.
- Manifestos com filtros, paginação via `.range()` e importação de `.xlsx/.csv`.
- Parser de manifesto com `xlsx` carregado dinamicamente.
- Detalhe do B/L com edição manual e registro em `audit_logs`.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Rode as migrations SQL no Supabase.
4. Crie usuários pelo admin do Supabase Auth.
5. Insira o perfil correspondente em `user_profiles`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
```
