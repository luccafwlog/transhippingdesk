# Plan 003: Corrigir o I5 do EDI Mercante contra arquivo real — IMO, NCM de 8 dígitos e tipo 40FM

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`.
>
> **Drift check (run first)**: `git diff --stat b2461da..HEAD -- src/services/mercanteEdiGenerator.ts src/services/__tests__/mercanteEdiGenerator.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (gerador puro, coberto por teste; formato validado contra EDI real aceito)
- **Depends on**: 001 (para carga IMO fluir do B/L; as correções em si são independentes)
- **Category**: bug (documento aduaneiro sai desalinhado para carga IMO)
- **Planned at**: commit `b2461da`, 2026-07-08

## Why this matters

O registro I5 do gerador tem três defeitos confirmados por comparação com um
**EDI Mercante real aceito pelo sistema federal** contendo carga perigosa
(veículos elétricos, UN 3556/3166, classe 9) e containers compartilhados entre
B/Ls: (1) o bloco IMO é escrito na posição errada e sem zero-padding — o
próprio código tem um `ponytail` dizendo que o placement nunca foi verificado;
(2) o NCM é truncado a 4 dígitos, mas o arquivo real grava 8; (3) o tipo de
container `40FM` (flat rack usado nos B/Ls de veículos) não existe no mapa
ISO e sai truncado. Com o Plano 001 alimentando DG Class/ONU dos B/Ls, esses
três erros passariam a corromper EDIs de carga IMO reais.

## Current state

- `src/services/mercanteEdiGenerator.ts` — gerador posicional (M5 164 / C5
  4104 / I5 5000, CRLF). Único arquivo de produção a mudar.
- `src/services/__tests__/mercanteEdiGenerator.test.ts` — testes de offsets.

Excerto vigente de `generateI5Record` (`mercanteEdiGenerator.ts:333-361`):

```ts
export function generateI5Record(container: MercanteContainerData, seq: number): string {
  const buf = newBuffer(I5_LEN)
  place(buf, 0, 'I5', 2)
  place(buf, 2, '1', 1)
  place(buf, 3, fmtNum(seq, 4), 4)
  place(buf, 7, fmtNumDec(container.grossWeightKg, 12, 3), 12)
  place(buf, 19, toIsoContainerType(container.containerType), 4)
  place(buf, 23, container.containerNumber, 11)
  place(buf, 34, fmtNumDec(container.tareWeightKg, 9, 3), 9)

  // ponytail: IMO/UN placement unverified — the reference manifest has no
  // dangerous cargo. UN number + class written into the reserved [447,458)
  // slot; confirm against an IMO manifest before relying on it.
  if (container.isImo) {
    place(buf, 447, digits(container.unNumber), 4)
    place(buf, 451, container.imoClass, 4)
  }

  place(buf, 458, fmtNumDec(container.totalCbm ?? 0, 13, 3), 13)
  // Seals may be alphanumeric (e.g. SEL123) — keep the text, don't strip letters.
  place(buf, 471, (container.sealNumber ?? '').replace(/\s+/g, ''), 6)

  // NCM codes: 4-digit code every 8 chars from offset 531.
  container.ncmCodes.slice(0, 6).forEach((ncm, i) => {
    place(buf, 531 + i * 8, digits(ncm), 4)
  })
```

Mapa de tipos (`mercanteEdiGenerator.ts:82-92`) — não contém `40FM`:

```ts
const ISO_CONTAINER_TYPE: Record<string, string> = {
  '20': '22G1', '20GP': '22G1', ...
  '40HC': '45G1', '40HQ': '45G1', '45HC': '45G1', '45': '45G1', '45G0': '45G1',
  ...
}
```

`extractNcmCodes` (`src/lib/ncm.ts:10-23`) retorna dígitos completos — para
`NCM : 8703.80.00` retorna `'87038000'` (8 dígitos). O `place(..., 4)` atual
trunca para `8703`.

### Fatos do EDI real aceito (fonte da verdade dos offsets)

Arquivo de referência: EDI Mercante de manifesto aceito, com carga IMO e
containers compartilhados (o operador possui o arquivo
`FWL_MERCANTE_560735.TXT`; os fatos necessários estão inlined abaixo).
Registros I5 de container flat-rack de veículo elétrico, fatias exatas
(índices 0-based dentro da linha I5):

| Fatia | Conteúdo real | Interpretação |
|---|---|---|
| `[19:23)` | `49P0` | tipo ISO gravado para container `40FM` |
| `[447:458)` | `' 0035569   '` | pos 447 = espaço; **UN zero-padded a 6 dígitos em `[448:454)`** (`003556`); **classe em `[454:...)`** (`9`) |
| `[447:458)` (outro B/L) | `' 0031669   '` | UN `003166` + classe `9` — confirma o padrão |
| `[531:539)` | `87038000` | **NCM com 8 dígitos** (não 4) |
| `[7:19)` | `000001405000` | peso bruto = parcela daquele B/L (container compartilhado repete o I5 em cada C5 com peso/CBM parciais — o gerador já faz isso por construção, 1 I5 por linha de `bl_containers`) |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Testes (foco) | `npx vitest run src/services/__tests__/mercanteEdiGenerator.test.ts` | all pass |
| Testes (suíte) | `npm test` | all pass |
| Lint / Build | `npm run lint && npm run build` | exit 0 |
| Docs | `npm run docs:check` | "Documentation checks passed" |

## Scope

**In scope**:

- `src/services/mercanteEdiGenerator.ts`
- `src/services/__tests__/mercanteEdiGenerator.test.ts`
- `docs/modules/manifesto-edi.md` (seção "Geração de EDI Mercante (M5)", item I5)

**Out of scope** (NÃO tocar):

- `src/lib/ncm.ts` — a extração já retorna 8 dígitos; o defeito é só a largura
  no gerador.
- `src/services/blParser.ts` / `blFreightImport.ts` — Plano 001.
- Offsets do M5 e do C5 — validados contra o mesmo arquivo real; nada a mudar.
- `src/components/shared/MercanteEdiModal.tsx` — a montagem de dados não muda.

## Git workflow

- Branch: a designada pelo operador; na ausência, `claude/plan-003-edi-i5`.
- Commits em português (`fix:`); mensagem cita a validação contra EDI real.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Corrigir o bloco IMO do I5

Em `generateI5Record`, substituir o bloco `if (container.isImo)` e o
`ponytail` acima dele por:

```ts
  // IMO block verified against an accepted Mercante EDI with dangerous cargo
  // (UN 3556/3166 class 9): UN number zero-padded to 6 digits at [448,454),
  // DG class from 454.
  if (container.isImo) {
    place(buf, 448, digits(container.unNumber).padStart(6, '0').slice(-6), 6)
    place(buf, 454, container.imoClass, 4)
  }
```

(Classe com largura 4 para acomodar classes como `5.1`; o arquivo real mostra
`9` em 454 seguido de espaços.)

**Verify**: `npx vitest run src/services/__tests__/mercanteEdiGenerator.test.ts`
→ pass após atualizar o teste (Step 4). Assert chave: I5 com
`unNumber: '3556', imoClass: '9'` produz fatia `[447:458)` igual a
`' 0035569   '`.

### Step 2: NCM com até 8 dígitos

Trocar a largura do NCM de 4 para 8 e atualizar o comentário:

```ts
  // NCM codes: up to 8 digits every 8 chars from offset 531 (verified: the
  // accepted EDI writes the full 8-digit code, e.g. 87038000).
  container.ncmCodes.slice(0, 6).forEach((ncm, i) => {
    place(buf, 531 + i * 8, digits(ncm), 8)
  })
```

**Verify**: assert: NCM `'87038000'` → fatia `[531:539)` = `'87038000'`; NCM
de 4 dígitos `'5514'` → `[531:539)` = `'5514    '`.

### Step 3: Mapear `40FM` → `49P0`

Adicionar ao `ISO_CONTAINER_TYPE`: `'40FM': '49P0',` (junto dos flat racks
`'40FR': '42P1'` — manter o comentário `ponytail` do mapa, apenas estendendo).
Adicionar somente `40FM` — nenhum outro código foi validado contra arquivo
real.

**Verify**: assert: `toIsoContainerType('40FM')` → `'49P0'`.

### Step 4: Atualizar testes e documentação

- `mercanteEdiGenerator.test.ts`: atualizar os asserts existentes do bloco IMO
  e NCM para os novos offsets/larguras; adicionar os três asserts dos Steps
  1–3 (modelar nos testes de offset já presentes no arquivo).
- `docs/modules/manifesto-edi.md`, bullet **I5**: registrar UN zero-padded 6
  dígitos na pos. 448 + classe na 454 (verificado contra EDI real com carga
  IMO), NCM de até 8 dígitos e o mapeamento `40FM→49P0`. Remover a menção a
  placement não verificado se houver.

**Verify**: `npm test` → all pass; `npm run docs:check` → pass.

## Test plan

Em `src/services/__tests__/mercanteEdiGenerator.test.ts` (padrão: testes de
fatia por offset já existentes no arquivo):

1. I5 IMO: `{ isImo: true, unNumber: '3556', imoClass: '9' }` →
   `record.slice(447, 458) === ' 0035569   '`.
2. I5 IMO com UN já 6 dígitos (`'003166'`) → mesma fatia `' 0031669   '`
   (idempotência do padding).
3. I5 não-IMO → `[447:458)` só espaços.
4. NCM 8 dígitos e NCM 4 dígitos (asserts do Step 2); dois NCMs → segundo em
   `[539:547)`.
5. `toIsoContainerType('40FM') === '49P0'`; regressão: `'40HC'` → `'45G1'`.
6. Comprimento do I5 permanece 5000 e demais offsets inalterados (reusar
   asserts existentes como regressão).

## Done criteria

- [ ] `npx vitest run src/services/__tests__/mercanteEdiGenerator.test.ts` exit 0, incluindo os 6 casos acima
- [ ] `grep -n "place(buf, 447, digits" src/services/mercanteEdiGenerator.ts` → nenhuma ocorrência
- [ ] `grep -n "'40FM': '49P0'" src/services/mercanteEdiGenerator.ts` → 1 ocorrência
- [ ] `npm test`, `npm run lint`, `npm run build`, `npm run docs:check` → exit 0
- [ ] `git status` sem arquivos fora do escopo
- [x] Linha deste plano atualizada em `docs/archive/plans/2026-07-08-transhipping-desk-edi-taxas/README.md`

## STOP conditions

Pare e reporte se:

- O excerto de `generateI5Record` não bater com o código (drift).
- Algum teste existente assertar o comportamento antigo do IMO em posição
  DIFERENTE de 447/451 (indicaria terceira fonte de verdade — resolver com o
  operador antes de escolher).
- Precisar mudar qualquer offset fora de `[447,458)`, `[531,...)` NCM e o mapa
  de tipos — os demais offsets estão validados e fora do escopo.

## Maintenance notes

- Classes IMO com subdivisão (`5.1`) nunca foram observadas em arquivo real
  aceito — a largura 4 a partir de 454 as acomoda, mas o primeiro manifesto
  real com classe decimal merece conferência byte a byte.
- Dois NCMs de 8 dígitos ficam adjacentes sem separador (`531+8=539`); o
  arquivo real disponível só tem 1 NCM por container. Se o Mercante rejeitar
  múltiplos NCMs colados, reduzir para os 4 primeiros dígitos por código é o
  fallback compatível com o passo de 8.
- O operador possui o EDI real (`FWL_MERCANTE_560735.TXT`) e 3 B/Ls COSCO de
  referência; para validação byte a byte adicional, pedir a ele — os arquivos
  não estão no repositório por conterem dados reais de clientes.
