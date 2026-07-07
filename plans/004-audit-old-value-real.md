# Plan 004: Gravar o `old_value` real nos registros de auditoria de devolução e flags Baplie

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 86cb5ac..HEAD -- src/services/demurrage/demurrageContainers.ts src/services/baplieReconciliation.ts`
> Se algum arquivo em escopo mudou desde a escrita do plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; em caso de
> divergência, trate como condição de STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (só muda o conteúdo gravado no log de auditoria; nenhum fluxo
  de negócio depende de `old_value` desses eventos hoje)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

`CONTEXT.md` define **Auditoria** como o registro de "quem mudou o quê, **de
qual valor para qual**, e por quê". Dois pontos de escrita em `audit_logs`
gravam `old_value: null` incondicionalmente: a mudança de data de devolução de
container (seção Demurrage) e a aplicação de flags físicas do Baplie. O
resultado é uma trilha de auditoria que não permite reconstruir o valor
anterior — exatamente o que ela existe para garantir. O valor antigo está
disponível (ou é barato buscar) em ambos os sites; a correção é passá-lo.

## Estado atual

Arquivos relevantes:

- `src/services/demurrage/demurrageContainers.ts` — updates de datas do
  container e o helper de auditoria `auditReturnDateChange` (linhas 117–134).
- `src/services/baplieReconciliation.ts` — aplicação de flags físicas
  (IMO/OOG) do Baplie nos containers do B/L, com um insert de auditoria por
  container (linhas ~200–210).
- `src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts` —
  teste existente do caminho de auditoria (padrão a seguir/estender).

Site 1 — `demurrageContainers.ts:119-134` (o helper recebe só o valor novo):

```ts
async function auditReturnDateChange(containerId: number, returnDate: string | null): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('audit_logs').insert({
      entity_type: 'bl_container',
      entity_id: String(containerId),
      field_name: 'return_date',
      old_value: null,
      new_value: returnDate,
      ...
```

Chamadores: `updateContainerReturnDate` (linhas 89–115) chama
`auditReturnDateChange` duas vezes (limpar e definir). Observação-chave: no
ramo de definir data, a função JÁ busca a linha do container
(`select('type, discharge_date, bl:bls(...)')` na linha ~97-102) — basta
incluir `return_date` nesse select e passar o valor. No ramo de limpar
(linhas 90–95) não há fetch hoje; será preciso buscar `return_date` antes do
update (1 select barato por operação manual de operador).

Site 2 — `baplieReconciliation.ts:200-210` (dentro do loop de updates):

```ts
    await supabase.from('audit_logs').insert({
      entity_type: 'bl_container',
      entity_id: String(update.bl_container_id),
      field_name: 'baplie_physical_flags',
      old_value: null,
      new_value: JSON.stringify({ is_imo: ..., imo_class: ..., un_number: ..., is_oog: ... }),
```

Observação-chave: o loop itera `updates` computados por
`computeBapliePhysicalUpdates(staged, blContainers)` a partir de
`fetchStagingAndBlContainers(voyageId)` (linha ~185) — os valores ANTIGOS das
flags já estão em memória em `blContainers`. Verifique o shape retornado por
`fetchStagingAndBlContainers`/`computeBapliePhysicalUpdates` no mesmo arquivo:
se o objeto `update` ainda não carrega os valores antigos, estenda
`computeBapliePhysicalUpdates` para incluí-los (é função local do arquivo) —
não faça um novo fetch por container.

Convenção do repo: auditoria é best-effort (nunca quebra o fluxo do usuário) —
ver o comentário e o try/catch com `reportBestEffortFailure` no site 1.
Preserve isso.

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Testes focados | `npx vitest run src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts` | passa |
| Suíte | `npm test` | todos passam |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npx tsc -b` | exit 0 |

## Escopo

**Em escopo** (únicos arquivos a modificar):
- `src/services/demurrage/demurrageContainers.ts`
- `src/services/baplieReconciliation.ts`
- `src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts`
- `src/services/__tests__/baplieReconciliation.test.ts` (se existir; senão,
  criar teste do site 2 seguindo o padrão do teste de auditoria do site 1)
- `plans/README.md` (status)

**Fora de escopo** (NÃO tocar):
- Outros pontos de escrita em `audit_logs` no repo (podem já estar corretos ou
  ter contexto próprio; este plano cobre os dois sites com evidência).
- Schema/migrations de `audit_logs`.
- `updateContainerDates` (linhas 64–87) só se o site de auditoria for
  compartilhado; não adicione auditoria nova a fluxos que hoje não auditam.

## Git workflow

- Branch designada pelo operador; commit no estilo do repo, ex.:
  `fix(auditoria): grava old_value real na devolução e flags Baplie`.
- Não faça push nem abra PR a menos que o operador instrua.

## Passos

### Passo 1: Site 1 — data de devolução

Em `demurrageContainers.ts`:

1. Mude a assinatura do helper para
   `auditReturnDateChange(containerId, oldReturnDate: string | null, returnDate: string | null)`
   e grave `old_value: oldReturnDate`.
2. Ramo "definir data" de `updateContainerReturnDate`: acrescente
   `return_date` ao select existente (linha ~99) e passe o valor antigo.
3. Ramo "limpar data" (linhas 90–95): busque `return_date` do container antes
   do update (`select('return_date').eq('id', containerId).single()`) e passe
   como valor antigo. Mantenha o comportamento best-effort: se o fetch do
   valor antigo falhar, audite com `old_value: null` em vez de abortar o
   fluxo (registre via `reportBestEffortFailure`).

**Verify**: `npx tsc -b` → exit 0.

### Passo 2: Site 2 — flags físicas do Baplie

Em `baplieReconciliation.ts`, garanta que cada `update` do loop carrega as
flags antigas do container correspondente (estendendo
`computeBapliePhysicalUpdates` se necessário — os dados já estão em
`blContainers`) e grave:

```ts
old_value: JSON.stringify({ is_imo: <antigo>, imo_class: <antigo>, un_number: <antigo>, is_oog: <antigo> }),
```

com o mesmo shape de chaves do `new_value`, para o diff ser legível na linha
do tempo do B/L.

**Verify**: `npx tsc -b` → exit 0.

### Passo 3: Testes

1. Estenda `updateContainerReturnDate.audit.test.ts`: os casos existentes
   passam a afirmar `old_value` com o valor anterior mockado (defina o
   `return_date` antigo no mock do select), cobrindo os dois ramos
   (definir e limpar).
2. Site 2: adicione/crie teste que mocka `fetchStagingAndBlContainers` (ou o
   builder de mock de supabase usado pelos testes do arquivo) e afirma que o
   insert de `audit_logs` recebeu `old_value` com as flags antigas.

**Verify**: `npx vitest run src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts` → passa;
`npm test` → todos passam.

### Passo 4: Gates finais

**Verify**: `npm run lint` → exit 0; `npm test` → exit 0.

## Plano de testes

Descrito no Passo 3; padrão estrutural:
`updateContainerReturnDate.audit.test.ts` (mocks de supabase + telemetria).
Casos: definir data com valor antigo presente; limpar data; falha do fetch do
valor antigo não aborta o update (best-effort); flags Baplie com old/new
consistentes.

## Critérios de conclusão

- [ ] `grep -n "old_value: null" src/services/demurrage/demurrageContainers.ts src/services/baplieReconciliation.ts`
  retorna somente o caminho best-effort de fallback (fetch do valor antigo
  falhou), se existir — nenhum caminho principal
- [ ] `npm test` sai com 0, incluindo os casos novos/estendidos
- [ ] `npx tsc -b` e `npm run lint` saem com 0
- [ ] `git status` mostra somente arquivos do escopo modificados
- [ ] Linha do plano 004 atualizada em `plans/README.md`

## Condições de STOP

Pare e reporte (não improvise) se:

- `computeBapliePhysicalUpdates`/`fetchStagingAndBlContainers` não expuserem
  as flags antigas e a extensão exigir mudar o shape de retorno usado por
  OUTROS chamadores fora deste arquivo.
- O teste existente de auditoria afirmar explicitamente `old_value: null`
  como CONTRATO (não como estado atual) — indicaria decisão anterior; checar
  `docs/adr/` e reportar.
- Alguma RLS/grant impedir o select do valor antigo no ramo de limpar data
  (erro 42501 nos testes de integração) — a solução seria outra (RPC), fora
  deste escopo.

## Notas de manutenção

- A linha do tempo do B/L (`blTimeline.ts`) consome `audit_logs`; com
  `old_value` real, a UI pode passar a exibir "de X para Y" — melhoria de
  exibição deferida, não incluída aqui.
- Revisor: conferir que nenhum fluxo passou a falhar quando o container não
  existe mais no momento da auditoria (best-effort preservado).
