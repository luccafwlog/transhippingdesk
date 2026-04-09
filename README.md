# Transhipping Desk

Plataforma interna para operacao de agente maritimo, com frontend em React/Vite, backend em Supabase e deploy em Firebase Hosting.

## Documentacao de status

- Roadmap atualizado: `docs/ROADMAP.md`
- Roteiro de validacao: `docs/VALIDACAO.md`
- Reset de ambiente de testes: `docs/RESET_AMBIENTE.md`
- Modelo de base de clientes: `docs/templates/base-clientes-modelo.xlsx`

## Implementado

- React + TypeScript + Vite.
- Tailwind CSS com tema dark.
- Supabase Auth com email e senha.
- Rotas protegidas.
- Painel inicial com KPIs basicos.
- Viagens com criacao e edicao.
- Manifestos com filtros, paginacao e importacao de `.xlsx/.csv`.
- Parser de manifesto com `xlsx` carregado dinamicamente.
- Importacao de base mestre de clientes por `CNPJ/CPF`.
- Detalhe do B/L com edicao manual e auditoria.

## Configuracao

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Rode as migrations SQL no Supabase.
4. Crie usuarios no Supabase Auth.
5. Insira o perfil correspondente em `user_profiles`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
```

## Deploy no Firebase Hosting

Projeto configurado: `importmanager-bda3e`

```bash
npm run build
npx firebase-tools deploy --only hosting
```
