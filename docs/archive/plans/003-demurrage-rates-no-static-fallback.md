# Plan 003: Remover o fallback estático de tarifas de Demurrage e falhar explícito

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 86cb5ac..HEAD -- src/services/demurrage/demurrageRates.ts src/services/demurrage/demurrageContainers.ts src/services/demurrage/demurrageInvoices.ts CONTEXT.md`
> Se algum arquivo em escopo mudou desde a escrita do plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; em caso de
> divergência, trate como condição de STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (muda comportamento de falha em caminho de cobrança: de
  "cobra silenciosamente pela tarifa errada" para "recusa calcular e avisa o
  operador" — direção correta, mas altera fluxos existentes)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

O glossário de domínio (`CONTEXT.md`, verbete **Tarifa de Demurrage (Rate)**)
registra a decisão: "A tarifa do banco é a única fonte de verdade; **não
existe fallback estático**." O código contradiz isso em três pontos: (1) uma
tabela `STATIC_RATE_GROUPS` hardcoded no serviço; (2) quando a carga do banco
falha ou retorna vazio, o serviço adota silenciosamente essas tarifas de
código — sem telemetria, e com o erro suprimido por 5 minutos de cache; (3)
um tipo de container desconhecido cai em `groups[0]` — o primeiro grupo que o
banco retornou, uma tarifa arbitrária. Consequência concreta: uma fatura de
Demurrage pode ser emitida com valores que não vieram da tabela vigente do
banco, sem que ninguém perceba. Este plano alinha o código à decisão
documentada: sem tarifa do banco não há cálculo — erro claro ao operador e
telemetria; tipo desconhecido não é precificado por grupo arbitrário.

## Estado atual

Arquivos relevantes:

- `src/services/demurrage/demurrageRates.ts` (157 linhas) — cache de tarifas,
  resolução de grupo e `calculateDemurrage` (função pura de cálculo).
- `src/services/demurrage/demurrageContainers.ts` — lista operacional e
  updates de datas; chama `ensureDemurrageRatesLoaded()` + `calculateDemurrage`.
- `src/services/demurrage/demurrageInvoices.ts` — emissão de fatura; idem.
- `src/services/demurrage/__tests__/calculateDemurrage.test.ts` — testes do
  cálculo (hoje passam usando as tarifas estáticas como base).
- `src/lib/telemetry.ts` — `reportBestEffortFailure(context, error, extra)`,
  o helper do repo para falhas observáveis que não quebram o fluxo.

Os três pontos, como existem hoje em `demurrageRates.ts`:

Tabela estática e uso como default (linhas 17–26, 40):

```ts
const STATIC_RATE_GROUPS: RateGroup[] = [
  { aliases: ['20GP', '20G0', ...], freeUntil: 21, p1: { range: [22, 30], usd: 30 }, ... },
  ...
]
const DEFAULT_RATE: RateGroup = STATIC_RATE_GROUPS[0]
...
function resolveActiveRateGroups(): RateGroup[] {
  ...
  return STATIC_RATE_GROUPS   // quando o cache dinâmico nunca carregou
}
```

Fallback silencioso em erro/vazio (linhas 85–95):

```ts
  if (error) {
    if (!dynamicRateGroups) {
      dynamicRateGroups = STATIC_RATE_GROUPS
    }
    dynamicRateGroupsLoadedAt = now
    return
  }
  const resolved = toRateGroups((data ?? []) as DemurrageRate[])
  dynamicRateGroups = resolved.length > 0 ? resolved : STATIC_RATE_GROUPS
```

Grupo arbitrário para tipo desconhecido (linha 105):

```ts
  const group = groups.find((g) => g.aliases.includes(type)) ?? groups[0] ?? DEFAULT_RATE
```

Decisão documentada a honrar (`CONTEXT.md`, citar nos comentários do código):

> "A resolução usa precedência: override do B/L > tarifa do banco > fallback.
> A tarifa do banco é a única fonte de verdade; não existe fallback estático."

Nota de interpretação (inline para o executor): a palavra "fallback" na
primeira frase refere-se à precedência histórica; a segunda frase é a decisão
vigente — a fonte é o banco, e a ausência dela é um estado de erro, não um
gatilho para tarifas de código.

Convenções do repo:

- Falha observável sem quebrar fluxo: `reportBestEffortFailure` (ver uso em
  `demurrageKpis.ts:275` e `demurrageContainers.ts:132`).
- Erros ao operador: `throw new Error('mensagem em português')` — ver
  `demurrageInvoices.ts:139,148` e `demurrageRates.ts:121-123`.
- Comentários em português citando o ADR/CONTEXT pertinente (padrão em todo o
  diretório demurrage/).

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Testes focados | `npx vitest run src/services/demurrage` | todos passam |
| Suíte | `npm test` | todos passam |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npx tsc -b` | exit 0 |

## Escopo

**Em escopo** (únicos arquivos a modificar):
- `src/services/demurrage/demurrageRates.ts`
- `src/services/demurrage/__tests__/calculateDemurrage.test.ts`
- `src/services/demurrage/__tests__/demurrageService.test.ts` (se referir às
  tarifas estáticas)
- Chamadores diretos SOMENTE se a mudança de assinatura/erro exigir tratamento
  novo: `demurrageContainers.ts`, `demurrageInvoices.ts`,
  `src/pages/Demurrage.tsx` (exibição de erro já existente deve bastar)
- `plans/README.md` (status)

**Fora de escopo** (NÃO tocar):
- `supabase/migrations/**` — nenhuma mudança de banco; a tabela
  `demurrage_rates` e a RPC ficam como estão.
- `CONTEXT.md` — a decisão documentada é a âncora deste plano; não reescrever.
- O cache TTL de 5 minutos e o refresh em background para o caso de SUCESSO —
  continuam como estão; o plano muda apenas os caminhos de falha/ausência.
- Overrides por B/L (`free_time_override`, `demurrage_rate_override_*`) — já
  corretos.

## Passos

### Passo 1: Caracterizar o comportamento atual do cálculo

Antes de mudar, rode e leia
`src/services/demurrage/__tests__/calculateDemurrage.test.ts`. Identifique
quais casos dependem de `STATIC_RATE_GROUPS` (por exemplo, testes que chamam
`calculateDemurrage` sem carregar tarifas do banco). Liste-os — eles serão
adaptados no Passo 4 para injetar tarifas explícitas de teste, preservando os
valores esperados.

**Verify**: `npx vitest run src/services/demurrage/__tests__/calculateDemurrage.test.ts` → passa (baseline).

### Passo 2: Tornar a ausência de tarifas um erro explícito

Em `demurrageRates.ts`:

1. Remova o uso de `STATIC_RATE_GROUPS` como fonte de cálculo. A constante
   pode ser mantida SOMENTE se algum teste a importar como fixture; caso
   contrário, delete-a junto com `DEFAULT_RATE`.
2. `ensureDemurrageRatesLoaded`: em erro do Supabase ou resultado vazio,
   NÃO preencher `dynamicRateGroups` com estáticas. Em vez disso:
   - chame `reportBestEffortFailure('ensureDemurrageRatesLoaded: tarifas de demurrage indisponiveis', error ?? new Error('demurrage_rates vazia'), { rowCount: data?.length ?? 0 })`;
   - se já existe um cache carregado do banco anteriormente
     (`dynamicRateGroups` não nulo), mantenha-o em uso (last-known-good do
     BANCO, não de código) e atualize `dynamicRateGroupsLoadedAt` para evitar
     marteladas;
   - se nunca carregou nada do banco, deixe o estado vazio e lance
     `new Error('Tarifas de Demurrage indisponíveis. Verifique a tabela de tarifas antes de calcular.')`.
3. `resolveActiveRateGroups`: quando não há grupos carregados, lance o mesmo
   erro (em vez de retornar estáticas).
4. Adicione comentário citando o CONTEXT.md: `// A tarifa do banco é a única
   fonte de verdade; não existe fallback estático (CONTEXT.md, Tarifa de
   Demurrage).`

**Verify**: `npx tsc -b` → exit 0.

### Passo 3: Tipo de container desconhecido deixa de cair em grupo arbitrário

Em `getRate` (`demurrageRates.ts:102-118`), substitua
`?? groups[0] ?? DEFAULT_RATE` por erro explícito:

```ts
const group = groups.find((g) => g.aliases.includes(type))
if (!group) {
  throw new Error(`Tipo de container "${type || '(vazio)'}" sem tarifa de Demurrage cadastrada. Cadastre a tarifa em Tarifas de Demurrage antes de calcular.`)
}
```

Isso propaga para `calculateDemurrage`, que já lança erros de dados inválidos
(datas) — os chamadores existentes exibem a mensagem ao operador
(`Demurrage.tsx` via mutation `onError`) ou pulam o container
(`containerDatesImport`). Confirme nos chamadores listados no escopo que
nenhum deles engole a exceção silenciosamente; se `createInvoiceForReturnedBL`
(emissão automática pós-importação) passar a falhar o lote inteiro por um tipo
desconhecido, envolva SOMENTE a chamada `calculateDemurrage` desse fluxo em
try/catch que registra via `reportBestEffortFailure` e pula o container — o
fluxo automático não deve derrubar a importação, mas o manual deve mostrar o
erro.

**Verify**: `npx tsc -b` → exit 0.

### Passo 4: Adaptar e ampliar os testes

Em `calculateDemurrage.test.ts` (e `demurrageService.test.ts` se afetado):

- Os casos existentes que dependiam das tarifas estáticas passam a carregar
  tarifas de teste explícitas (mock do `supabase.from('demurrage_rates')` no
  padrão de mock já usado no arquivo, ou export de função de injeção de teste
  se o arquivo já tiver uma) com os MESMOS valores da antiga tabela estática —
  os valores esperados dos testes não mudam.
- Casos novos:
  1. banco indisponível e sem cache → `ensureDemurrageRatesLoaded` lança o
     erro "Tarifas de Demurrage indisponíveis…";
  2. banco indisponível com cache previamente carregado → continua calculando
     com o cache e `reportBestEffortFailure` foi chamado (mock de
     `src/lib/telemetry`);
  3. tipo de container desconhecido → `calculateDemurrage` lança o erro "sem
     tarifa de Demurrage cadastrada";
  4. resultado vazio do banco → mesmo comportamento do caso 1.

**Verify**: `npx vitest run src/services/demurrage` → todos passam, incluindo
os 4 casos novos.

### Passo 5: Gates finais

**Verify**: `npm test` → todos passam; `npm run lint` → exit 0.

## Plano de testes

Descrito no Passo 4. Padrão estrutural: os testes existentes do próprio
diretório (`calculateDemurrage.test.ts` para a função pura;
`demurrageService.test.ts` para mocks de Supabase). Telemetria mockada como em
`updateContainerReturnDate.audit.test.ts`.

## Critérios de conclusão

- [ ] `grep -n "STATIC_RATE_GROUPS" src/services/demurrage/demurrageRates.ts`
  não retorna uso como fonte de cálculo (idealmente, zero ocorrências fora de
  fixture de teste)
- [ ] `npm test` sai com 0, incluindo os 4 casos novos
- [ ] `npx tsc -b` e `npm run lint` saem com 0
- [ ] `git status` mostra somente arquivos do escopo modificados
- [ ] Linha do plano 003 atualizada em `plans/README.md`

## Condições de STOP

Pare e reporte (não improvise) se:

- Algum teste ou página depender de calcular demurrage SEM banco em cenário
  legítimo de produção (não de teste) — indicaria um fluxo offline deliberado
  que a auditoria não viu; a decisão é do mantenedor.
- O verbete do CONTEXT.md tiver mudado desde `86cb5ac` (a âncora da decisão
  caiu; reavaliar antes de codar).
- A adaptação dos testes exigir reescrever mais de ~50% de
  `calculateDemurrage.test.ts` — sinal de que a estratégia de injeção de
  tarifas escolhida está errada; reporte a alternativa antes de seguir.
- Qualquer mudança parecer necessária em `supabase/migrations/**` ou
  `src/types/database.ts` (protegidos; fora do escopo deste plano).

## Notas de manutenção

- A partir deste plano, um banco de tarifas vazio TRAVA o cálculo de
  demurrage por design. O seed/cadastro de tarifas passa a ser pré-condição
  operacional — se surgir reclamação de "não calcula mais", a resposta é
  cadastrar tarifas, não reintroduzir fallback.
- Revisor: escrutinar o Passo 3 nos fluxos automáticos (importação de datas) —
  é o único ponto onde o plano permite engolir a exceção, e apenas com
  telemetria.
- Follow-up deferido: persistir o last-known-good em `localStorage` (como o
  cache de ROE em `demurrageKpis.ts`) foi considerado e adiado — o cache em
  memória cobre a sessão e o caso raro não justifica mais estado persistente.
