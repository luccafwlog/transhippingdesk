# Transhipping Desk

Plataforma interna para operacao de agente maritimo, com frontend em React/Vite, backend em Supabase e deploy em Firebase Hosting.

## Documentacao principal

- Roadmap real do produto: `docs/ROADMAP.md`
- Roteiro de validacao operacional: `docs/VALIDACAO.md`
- Reset de ambiente de testes: `docs/RESET_AMBIENTE.md`
- Baseline de release: `docs/RELEASE_BASELINE_2026-04-14.md`
- Modelo de base de clientes: `docs/templates/base-clientes-modelo.xlsx`

## Modulos operacionais entregues

- Login e rotas protegidas.
- Painel executivo.
- Viagens.
- Manifestos CNTR.
- Containers.
- Manifestos BB.
- Veiculos.
- Revisao Manual.
- Clientes.
- Detalhe do B/L com auditoria.

## Modulos ainda nao concluidos como produto final

- Taxas Locais
- Faturamento
- Alertas
- Relatorios
- Line up TV
- Admin - Usuarios
- Admin - Tarifas

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
npm test
npm run test:integration
```

## Deploy no Firebase Hosting

Projeto configurado: `importmanager-bda3e`

```bash
npm run build
npx firebase-tools deploy --only hosting
```
