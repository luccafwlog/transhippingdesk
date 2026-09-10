# Medição de inicialização autenticada

O harness `measure-authenticated-startup.mjs` mede o caminho frio de `/login`
até o primeiro heading do `/painel`. Ele cria um contexto novo por rodada,
mantém credenciais apenas em memória e grava somente tempos, origens e caminhos
de requests no relatório.

Requisitos:

```powershell
$env:PERF_BASE_URL = 'https://transhippingdesk.com.br'
$env:PERF_USER_EMAIL = 'usuario-de-teste@example.com'
$env:PERF_USER_PASSWORD = 'senha-de-teste'
npx playwright install chromium
npm run perf:authenticated-startup
```

O comando grava `artifacts/perf/authenticated-startup.json`, que não deve ser
versionado. O relatório falha com código diferente de zero quando o p95 supera
2 segundos. Nunca inclua credenciais, tokens, cookies ou headers no relatório.

## Read-model operacional

`npm run perf:operational-read-model` compara a RPC resumida de viagens com a
projeção pesada que agrega todas as colunas de `voyages`/`bls`/`bl_containers`.
Os cenários têm 100, 1.000 e 10.000 B/Ls, três viagens e quatro combinações de
POL/POD, com números de container compartilhados. Cada cenário é executado em
uma transação e termina em `ROLLBACK`.

O benchmark é deliberadamente local e exige um banco sem viagens:

```bash
bash scripts/setup-local-pg.sh --reset
PERF_BENCHMARK_ALLOW_LOCAL=1 \
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  npm run perf:operational-read-model
```

O relatório grava `artifacts/perf/operational-read-model.json` com p50/p95,
bytes do JSON, uma instrução SQL por leitura e `EXPLAIN (ANALYZE, BUFFERS)`.
“Requests” significa instruções SQL locais; isso não substitui medição HTTP do
PostgREST nem a execução autenticada no Preview. A saída não inclui a URL do
banco e os dados são descartados pelo rollback.

## Contraste dos temas

`npm run a11y:contrast` lê os tokens reais de `src/index.css` nos temas light e
dark e falha abaixo de 4,5:1 para texto, links, status e cabeçalho de tabela.
Ele é um gate de tokens, não substitui a verificação manual de componentes,
hover/disabled, leitor de tela e foco no Preview.
