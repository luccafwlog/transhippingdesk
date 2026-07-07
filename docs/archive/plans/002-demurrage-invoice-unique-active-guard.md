# Plan 002: Impedir fatura de Demurrage ativa duplicada por B/L no banco

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 86cb5ac..HEAD -- src/services/demurrage/demurrageInvoices.ts supabase/migrations/156_demurrage_create_invoice_issued.sql supabase/migrations/`
> Se algum arquivo em escopo mudou desde a escrita do plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; em caso de
> divergência, trate como condição de STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (mudança aditiva: índice parcial + checagem na RPC; nenhum
  caminho feliz muda)
- **Depends on**: plans/001-fix-migration-numbering-docs.md (apenas para a
  numeração de migration nos docs; se 001 não tiver rodado, ignore o literal
  stale "próximo é 160_" em WORKFLOW.md e use o próximo número real)
- **Category**: bug
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

Hoje a única proteção contra duas faturas de Demurrage ativas para o mesmo
B/L é uma checagem client-side de "existe fatura issued/paid?" feita ANTES de
chamar a RPC que insere (`check-then-act`). A RPC
`create_demurrage_invoice_with_items` trava a linha do B/L (`FOR UPDATE`) mas
não verifica fatura ativa existente, e não há índice único no banco. Dois
operadores em abas diferentes — ou a emissão automática da importação de datas
(`containerDatesImport.ts` → `createInvoiceForReturnedBL`) concorrendo com a
emissão manual da página Demurrage — podem ambos passar pela checagem e criar
duas faturas `issued` para o mesmo B/L: cobrança dupla ao cliente, ambas
entrando no recálculo diário. A regra de negócio (ADR 0014 e comentários no
próprio serviço) é: uma fatura ativa por B/L; a correção é cancelar e reemitir.

## Estado atual

Arquivos relevantes:

- `src/services/demurrage/demurrageInvoices.ts` — serviço de emissão; contém a
  checagem client-side e os dois fluxos de criação.
- `supabase/migrations/156_demurrage_create_invoice_issued.sql` — definição
  vigente da RPC `create_demurrage_invoice_with_items` (155 linhas; a versão
  anterior estava na 132 e foi substituída pela 156).
- `src/services/__tests__/createDemurrageInvoiceMigration.test.ts` — teste
  textual da migration 156 (padrão do repo para migrations).
- `src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts` —
  teste do serviço de criação.

Checagem client-side (`demurrageInvoices.ts:111-120`):

```ts
async function hasActiveInvoiceForBL(blId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('id')
    .eq('bl_id', blId)
    .in('status', ['issued', 'paid'])
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}
```

Uso nos dois fluxos: `createInvoiceForBL` lança erro amigável
(`demurrageInvoices.ts:150-152`); `createInvoiceForReturnedBL` retorna `null`
silenciosamente (`demurrageInvoices.ts:220`). Esses comportamentos de UX devem
ser preservados — o banco vira a última linha de defesa, não a primeira.

Na RPC (migration 156), após validar os parâmetros, existe apenas:

```sql
  SELECT b.customer_id
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = p_bl_id
  FOR UPDATE;
```

…e nenhuma checagem de fatura ativa antes do `INSERT INTO
public.demurrage_invoices (... status ...) VALUES (..., 'issued', ...)`.

Índices existentes sobre a tabela: apenas
`idx_demurrage_invoices_customer_status (customer_id, status)` (migration
114). Nenhum índice único por `bl_id`.

Statuses possíveis da fatura (ver `types/database.ts` e uso no serviço):
`draft`, `issued`, `paid`, `overdue`, `cancelled`. "Ativa" = `issued` ou
`paid` (mesma definição de `hasActiveInvoiceForBL`). `cancelled` pode se
repetir livremente por B/L.

Convenções do repo que se aplicam:

- Migrations: arquivo novo `NNN_descricao_curta.sql` em
  `supabase/migrations/`, NUNCA editar migrations existentes (são protegidas
  por hook em `.claude/hooks/`). Siga `docs/CONVENCOES.md` e o padrão dos
  arquivos recentes (ex.: `164_guard_iso_container_numbers.sql`): comentário
  de cabeçalho explicando a mudança, `CREATE OR REPLACE FUNCTION` completo ao
  alterar RPC, `SECURITY DEFINER` + `SET search_path` idênticos ao original.
- Teste textual de migration: siga o padrão de
  `src/services/__tests__/createDemurrageInvoiceMigration.test.ts` (lê o SQL
  como texto e afirma presença de cláusulas-chave).
- Vocabulário do domínio (CONTEXT.md): "Invoice de Demurrage", "Recálculo
  Diário"; mensagens de erro ao operador em português, sem acento inconsistente
  com o arquivo (o serviço usa "nao"/"não" misto — siga o texto vizinho).

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Testes | `npm test` | todos passam |
| Teste focado | `npx vitest run src/services/__tests__/createDemurrageInvoiceMigration.test.ts` | passa |
| Lint | `npm run lint` | exit 0 |
| Build/typecheck | `npm run build` | exit 0 (requer `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` no ambiente; se indisponíveis, rode `npx tsc -b` para o typecheck) |
| Docs | `npm run docs:check` | exit 0 |
| Próximo nº de migration | `ls supabase/migrations/ \| sort \| tail -1` | último arquivo; novo = número+1 |

## Escopo

**Em escopo** (únicos arquivos a modificar/criar):
- `supabase/migrations/169_demurrage_invoice_unique_active.sql` (criar; se o
  número 169 já existir, use o próximo livre e ajuste os nomes citados abaixo)
- `src/services/demurrage/demurrageInvoices.ts` (mapear erro de violação para
  mensagem amigável)
- `src/services/__tests__/demurrageInvoiceUniqueActiveMigration.test.ts` (criar)
- `src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts`
  (estender, se necessário)
- `docs/AUDITORIA_MIGRATIONS.md` e/ou docs de módulo, somente se o
  `docs:check` ou as convenções exigirem registrar a migration nova
- `plans/README.md` (status)

**Fora de escopo** (NÃO tocar):
- Qualquer migration existente (`001_`–`168_`) — protegidas.
- `unmarkInvoicePaid`, `cancelDemurrageInvoice`, fluxo de recálculo diário —
  nenhum deles cria fatura.
- A checagem client-side `hasActiveInvoiceForBL` — permanece como está (UX de
  erro antecipado); não removê-la.
- `src/types/database.ts` — protegido; a RPC não muda de assinatura.

## Git workflow

- Branch designada pelo operador; commits no estilo do repo (`fix:`/`feat:`),
  ex.: `fix(demurrage): impede fatura ativa duplicada por B/L no banco`.
- Não faça push nem abra PR a menos que o operador instrua.

## Passos

### Passo 1: Verificar pré-condição de dados (duplicatas existentes)

A migration criará um índice único parcial; ela falha se já houver duplicatas
em produção. A migration deve falhar de forma legível nesse caso, e o executor
não pode "limpar" dados por conta própria. Inclua no início da migration:

```sql
DO $$
DECLARE
  v_dupes TEXT;
BEGIN
  SELECT string_agg(bl_id, ', ')
  INTO v_dupes
  FROM (
    SELECT bl_id
    FROM public.demurrage_invoices
    WHERE status IN ('issued', 'paid')
    GROUP BY bl_id
    HAVING COUNT(*) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Faturas de Demurrage ativas duplicadas para B/L(s): %. Cancele as duplicatas antes de aplicar esta migration.', v_dupes;
  END IF;
END $$;
```

**Verify**: bloco presente no arquivo da migration (checado pelo teste do
Passo 4).

### Passo 2: Criar a migration com índice único parcial + checagem na RPC

Crie `supabase/migrations/169_demurrage_invoice_unique_active.sql` contendo,
após o bloco do Passo 1:

1. O índice único parcial:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_demurrage_invoices_active_bl
  ON public.demurrage_invoices (bl_id)
  WHERE status IN ('issued', 'paid');
```

2. `CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_with_items(...)`
   — copie a definição COMPLETA e vigente da migration 156 (assinatura,
   `SECURITY DEFINER`, `SET search_path`, corpo e `GRANT`s idênticos) e
   acrescente, logo APÓS o `SELECT ... FOR UPDATE` do B/L e antes das
   validações de itens, a checagem explícita:

```sql
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices di
    WHERE di.bl_id = p_bl_id AND di.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Ja existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;
```

A ordem importa: o `FOR UPDATE` no B/L serializa duas chamadas concorrentes
para o mesmo B/L, então a segunda chamada enxerga a fatura da primeira nesta
checagem; o índice único cobre qualquer caminho de escrita que não passe pela
RPC.

**Verify**: `ls supabase/migrations/ | tail -1` → o novo arquivo;
`grep -c "uq_demurrage_invoices_active_bl" supabase/migrations/169_*.sql` → ≥1.

### Passo 3: Mapear a violação para mensagem amigável no serviço

Em `src/services/demurrage/demurrageInvoices.ts`, na função
`createDemurrageInvoiceWithItems` (linhas ~67–98), o `if (error) throw error`
repassa o erro cru do Postgres. Após o `rpc(...)`, detecte o código `23505`
(tanto da exceção da RPC quanto de violação direta do índice) e lance a mesma
mensagem amigável já usada em `createInvoiceForBL:151`:

```ts
if (error) {
  const text = extractErrorText(error).toLowerCase()
  if (text.includes('23505')) {
    throw new Error('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
  }
  throw error
}
```

Use o helper existente `extractErrorText` de `src/lib/errors.ts` (padrão do
repo para matching de erros Supabase — ver o comentário no próprio helper).
Não altere o comportamento de `createInvoiceForReturnedBL` (continua retornando
`null` quando a checagem antecipada encontra fatura ativa; se a corrida
acontecer e a RPC falhar com 23505, propagar o erro amigável é aceitável — o
chamador `containerDatesImport.ts:131` já trata falhas por B/L).

**Verify**: `npm run lint` → exit 0; `npx tsc -b` → exit 0.

### Passo 4: Teste textual da migration

Crie `src/services/__tests__/demurrageInvoiceUniqueActiveMigration.test.ts`
seguindo o padrão estrutural de
`src/services/__tests__/createDemurrageInvoiceMigration.test.ts` (ler o SQL da
migration como texto). Afirme:

- presença de `CREATE UNIQUE INDEX` com `WHERE status IN ('issued', 'paid')`;
- presença do bloco de pré-checagem de duplicatas (`HAVING COUNT(*) > 1`);
- a RPC redefinida contém a checagem `IF EXISTS` com `ERRCODE = '23505'`;
- a RPC preserva `SECURITY DEFINER` e `SET search_path` (mesmas asserções que
  o teste da 156 usa para essas cláusulas).

**Verify**: `npx vitest run src/services/__tests__/demurrageInvoiceUniqueActiveMigration.test.ts` → passa.

### Passo 5: Teste do mapeamento de erro no serviço

Estenda `src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts`
(ou crie um `describe` novo no mesmo arquivo) com um caso em que o mock da RPC
retorna erro com `code: '23505'` e o serviço lança a mensagem amigável
("Já existe fatura de Demurrage…"). Use o padrão de mock de `supabase.rpc` já
presente nesse arquivo.

**Verify**: `npx vitest run src/services/demurrage/__tests__/createDemurrageInvoiceAtomic.test.ts` → passa, incluindo o caso novo.

### Passo 6: Gates finais

**Verify**: `npm test` → todos passam; `npm run docs:check` → exit 0 (se
falhar por falta de registro da migration nova em algum doc vivo, adicione o
registro no documento apontado pelo próprio check e rode de novo).

## Plano de testes

- Novo: teste textual da migration (Passo 4) — arquivo
  `demurrageInvoiceUniqueActiveMigration.test.ts`, modelado em
  `createDemurrageInvoiceMigration.test.ts`.
- Novo: caso de erro 23505 → mensagem amigável (Passo 5), no arquivo de teste
  atômico existente.
- Regressão: suíte completa (`npm test`) — os fluxos felizes de criação não
  mudam.

## Critérios de conclusão

- [ ] `ls supabase/migrations/` contém a nova migration e nenhuma migration
  antiga foi modificada (`git diff --name-only` não lista `001_`–`168_`)
- [ ] `npm test` sai com 0, incluindo os 2+ testes novos
- [ ] `npm run lint` e `npx tsc -b` saem com 0
- [ ] `git status` mostra somente arquivos do escopo modificados
- [ ] Linha do plano 002 atualizada em `plans/README.md`

## Condições de STOP

Pare e reporte (não improvise) se:

- A definição da RPC vigente não estiver na migration 156 (procure
  `grep -ln "create_demurrage_invoice_with_items" supabase/migrations/*.sql`
  — se aparecer arquivo > 156, a versão vigente é a desse arquivo e os
  excertos deste plano estão desatualizados).
- O hook de proteção bloquear a criação do arquivo de migration (reporte a
  mensagem do hook em vez de contorná-lo).
- Os statuses usados na tabela divergirem de
  `draft/issued/paid/overdue/cancelled` (indicaria enum diferente; a cláusula
  `WHERE` do índice precisaria de revisão humana).
- Qualquer teste existente de Demurrage quebrar por causa da checagem nova na
  RPC (indicaria um fluxo legítimo que cria fatura com outra ativa — decisão
  de negócio, não do executor).

## Notas de manutenção

- O status `overdue` de fatura (usado em `markInvoicePaid`) NÃO está no
  predicado do índice; hoje nenhuma fatura nasce ou transiciona para `overdue`
  em código ativo (a migration 157 dropou esse fluxo), mas se ele voltar, o
  predicado do índice e a checagem da RPC precisam incluí-lo.
- A aplicação da migration em produção é uma ação de operador (fora do repo);
  o plano só está completo operacionalmente após a aplicação — registre isso
  ao atualizar o status.
- Revisor: confira que a RPC redefinida é byte-a-byte a da 156 exceto pela
  checagem nova (diff mental curto; qualquer outra mudança é red flag).
