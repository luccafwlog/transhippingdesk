# Baseline de Release - 2026-04-14

Marco tecnico de congelamento apos ciclo de hardening e estabilizacao inicial.

## Estado congelado

- Branch de referencia: `main`
- Commit de baseline: `ec19c04` (merge tecnico das entregas do hardening)
- Supabase: migrations `001` a `015` aplicadas
- Frontend publicado em Firebase

## Itens validados neste baseline

- Importacao CNTR transacional com dedupe por hash.
- Rate limit de importacao no banco (`P0429`).
- Revisao de B/L com optimistic lock (`40001` em conflito concorrente).
- CE Mercante com trilha de auditoria.
- RLS por role (financeiro restrito a admin).
- Fluxos de cliente com paginacao na listagem principal.
- Timeout de inatividade de sessao no frontend.

## Observabilidade minima ativa

Eventos gravados em `audit_logs` (`entity_type = system_event`):

- `manifest_import_rate_limited`
- `manifest_import_duplicate_hash`
- `bl_review_concurrent_conflict`

## Comandos de verificacao tecnica

```powershell
npm test
npm run lint
npm run build
```

Opcional (ambiente controlado com credenciais):

```powershell
$env:SUPABASE_RUN_INTEGRATION="1"
npm run test:integration
```

## Proximo ciclo recomendado

Abrir sprint de **Taxas Locais** em duas etapas:

1. Motor de calculo por POD/cargo/perfil.
2. Produto (tela, simulacao por B/L, persistencia e auditoria).

