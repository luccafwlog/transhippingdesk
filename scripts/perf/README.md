# Medição de inicialização autenticada

O harness `measure-authenticated-startup.mjs` mede o caminho frio de `/login`
até o primeiro heading do `/painel`. Ele cria um contexto novo por rodada,
mantém credenciais apenas em memória e grava somente tempos, origens e caminhos
de requests no relatório.

Requisitos:

```powershell
$env:PERF_BASE_URL = 'https://transhipping-desk.web.app'
$env:PERF_USER_EMAIL = 'usuario-de-teste@example.com'
$env:PERF_USER_PASSWORD = 'senha-de-teste'
npx playwright install chromium
npm run perf:authenticated-startup
```

O comando grava `artifacts/perf/authenticated-startup.json`, que não deve ser
versionado. O relatório falha com código diferente de zero quando o p95 supera
2 segundos. Nunca inclua credenciais, tokens, cookies ou headers no relatório.
