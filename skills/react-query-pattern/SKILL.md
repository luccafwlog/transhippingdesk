---
name: react-query-pattern
description: Use when adding or changing Supabase data access, TanStack React Query hooks, cache keys, invalidation, mutations, reusable remote state, or page-to-service calls in Transhipping Desk.
---

# React Query and Data Access

Put reusable operations in services and reusable remote-state lifecycle in
hooks. Match the existing owner instead of enforcing a layer diagram the
repository does not universally follow.

| Need | Preferred owner |
|---|---|
| Reusable Supabase/domain operation | `src/services/` |
| Reusable query/cache/mutation lifecycle | `src/hooks/` |
| One-shot import, export or command | Focused service called by the page |
| Presentation state | Component/page state |

`useBilling()` is reusable server state. `listInvoicesForExport()` is an
acceptable one-shot service command. Do not add raw Supabase access when a
service or hook already owns the operation.

## Services

Use `src/services/supabase.ts`:

```ts
import { supabase } from './supabase'
```

Services accept explicit arguments, execute queries/RPCs, throw on required
failures, normalize awkward responses when needed, and return typed data
without React state. Never convert a real failure into empty success.

## Hooks

Use a hook for shared loading/error/refetch state, cache, mutations,
invalidation, enabled guards, or optimistic updates.

```ts
export function useVoyageTimeline(voyageId: number | null) {
  return useQuery({
    queryKey: queryKeys.voyages.timeline(voyageId),
    queryFn: () => listVoyageTimeline(voyageId!),
    enabled: voyageId != null,
  })
}
```

Keep form and modal state outside React Query.

## Query keys

Prefer `src/services/queryKeys.ts`.

### Invalidação: declare o evento, não a chave

Para ler cache, use `queryKeys`. Para invalidar depois de uma mutação, use
`src/services/cacheEffects.ts`: a interface são eventos de domínio, não chaves.

```ts
await afterViagemAlterada(queryClient, { voyageId })
await afterEscalaAlterada(queryClient, { voyageId })
await afterRotaAlterada(queryClient, { voyageId })
await afterBaplieImportado(queryClient, { voyageId })
await afterBlRevisado(queryClient, { blId })
```

Não escreva `invalidateQueries({ queryKey: ['voyages'] })` em página ou
componente. A lista de chaves de um evento mora em `cacheEffects.ts`; se um
evento ainda não existir, crie-o com teste em
`src/services/__tests__/cacheEffects.test.ts`.

- arrays only;
- stable entity prefix first;
- IDs before filter objects;
- omit absent suffixes when prefix invalidation is expected;
- do not create a second key family for the same data.

```ts
operations: (filters?: OperationFilters) =>
  filters ? ['local-charge-operations', filters] : ['local-charge-operations']
```

`['local-charge-operations', undefined]` is not the same base-prefix contract.

## Mutations

List every stale view before implementing.

- invalidate the narrowest complete families;
- include detail and aggregate keys;
- include Portal/internal consumers of the same mutation;
- use optimistic updates only with rollback tests;
- surface failures through existing toast/error UI.

## Red-green

1. Test wrong key shape, stale UI, or missing mutation behavior.
2. Confirm the expected failure.
3. Implement the smallest service/hook/key change.
4. Run focused and related page/component tests.

Prefer pure tests for key factories and behavioral tests for visible
invalidation.

## Existing direct calls

Pages currently call services for imports, exports, commands and legacy flows.
Preserve a direct call when extraction has no concrete benefit. Reuse an
existing hook when it owns the same data, and never duplicate a query in both.
This is not permission to spread direct Supabase calls.

## Avoid

- raw effect fetching where React Query fits;
- infinite stale time as a dependency workaround;
- hand-rolled polling;
- broad invalidation without an impact list;
- catch/log followed by fake success;
- unrelated layer refactors.

## Verification

Complete focused red-green coverage; prove key and invalidation scope; preserve
loading, empty and error states; avoid duplicate query ownership; run lint,
tests and build; update living docs if the convention changes.
