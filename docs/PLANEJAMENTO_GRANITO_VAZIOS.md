# Tarefa 3 — Planejamento Técnico: Novos Manifestos de Importação

## Contexto

O Transhipping Desk já suporta dois tipos de manifesto: **CNTR** (`cargo_mode = 'container'`) e **BB/Carga Solta** (`cargo_mode = 'carga_solta'`). A operação exige dois novos módulos:

- **Manifesto de Granito** — planilha "Relatório de Cargas/Booking" exportada pela COSCO Shipping, com 26 campos específicos, cliente como shipper (CNPJ), e faturamento por peso real aferido (`real_weight_kg`). Estruturalmente distinto do `bls` existente: usa tabelas próprias.
- **Manifesto de Vazios** — movimentação de contêineres vazios identificados por **booking number** (sem BL). Não integra o pipeline de faturamento; é operacional.

Decisão arquitetural: ambos usam **tabelas isoladas** (não extensão de `bls`), pois seus modelos de dados são incompatíveis com o schema atual. Reuso se dá nos utilitários de parse, componentes de UI e vínculo com `voyages`.

---

## 5.1 Modelagem de Dados

### Granito — tabelas próprias

#### `granite_manifests` (cabeçalho do lote de importação)

```sql
CREATE TABLE public.granite_manifests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id       BIGINT REFERENCES public.voyages(id),  -- vínculo com viagem cadastrada
  vessel_voyage   TEXT NOT NULL,   -- ex: "COSCO SHIPPING GLORY/30" (vem da planilha)
  loading_port    TEXT,
  discharge_port  TEXT,
  total_bls       INTEGER,
  total_weight_kg NUMERIC(14,3),
  imported_at     TIMESTAMPTZ DEFAULT now(),
  imported_by     UUID REFERENCES auth.users(id)
);
```

> `voyage_id` é FK opcional: o operador seleciona a viagem cadastrada no sistema no momento do import. `vessel_voyage` é preservado como texto da planilha.

---

#### `granite_bls` (um registro por BL/linha da planilha)

```sql
CREATE TABLE public.granite_bls (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id          UUID NOT NULL REFERENCES public.granite_manifests(id) ON DELETE CASCADE,
  client_id            BIGINT REFERENCES public.customers(id),   -- lookup por shipper_cnpj
  sequence             INTEGER,
  booking_number       TEXT,
  bl_number            TEXT NOT NULL,
  shipper_ref          TEXT,
  vessel_voyage        TEXT,
  loading_port         TEXT,
  discharge_port       TEXT,
  shipper_name         TEXT,
  shipper_cnpj         TEXT NOT NULL,
  consignee_name       TEXT,
  charter              TEXT,
  shipper_m3           NUMERIC(12,3),
  shipper_weight_kg    NUMERIC(14,3),
  blocks_qty           INTEGER,
  received_blocks_qty  INTEGER,
  blocks_balance       INTEGER GENERATED ALWAYS AS (blocks_qty - received_blocks_qty) STORED,
  final_m3             NUMERIC(12,3),
  real_weight_kg       NUMERIC(14,3),   -- BASE DO FATURAMENTO
  stockyard            TEXT,
  remarks              TEXT,
  partial_restriction  BOOLEAN DEFAULT false,
  cosco_transport      TEXT,
  fragile_blocks       INTEGER,
  cssc_selection       TEXT,
  cargo_readiness_date DATE,
  phase                TEXT,
  charge_status        TEXT DEFAULT 'not_calculated',  -- espelha workflow do sistema
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (manifest_id, bl_number)
);
```

> `client_id` referencia `customers` (tabela existente) via lookup por `shipper_cnpj` normalizado (só dígitos). Campo pode ser `NULL` se CNPJ ausente/não cadastrado — bloqueio de faturamento neste caso.

---

#### `granite_rates` (tabela de taxas administrada pelo operador)

```sql
CREATE TABLE public.granite_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('per_kg', 'per_ton', 'per_bl', 'fixed')),
  unit_value  NUMERIC(12,4) NOT NULL,
  currency    TEXT DEFAULT 'BRL',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

#### `granite_bl_charges` (linhas de cobrança calculadas por BL)

```sql
CREATE TABLE public.granite_bl_charges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_id         UUID NOT NULL REFERENCES public.granite_bls(id) ON DELETE CASCADE,
  rate_id       UUID REFERENCES public.granite_rates(id),
  description   TEXT,
  charge_type   TEXT,
  unit_value    NUMERIC(12,4),
  quantity      NUMERIC(14,3),   -- kg ou tons conforme charge_type
  subtotal      NUMERIC(12,2),
  currency      TEXT,
  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_granite_bl_charges_bl_id ON public.granite_bl_charges(bl_id);
```

---

### Vazios — tabelas próprias

#### `vazios_manifests`

```sql
CREATE TABLE public.vazios_manifests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id      BIGINT REFERENCES public.voyages(id),
  description    TEXT,
  total_bookings INTEGER,
  imported_at    TIMESTAMPTZ DEFAULT now(),
  imported_by    UUID REFERENCES auth.users(id)
);
```

#### `vazios_bookings` (um registro por booking/linha da planilha)

```sql
CREATE TABLE public.vazios_bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id      UUID NOT NULL REFERENCES public.vazios_manifests(id) ON DELETE CASCADE,
  booking_number   TEXT NOT NULL,
  container_number TEXT,
  container_type   TEXT,     -- '20GP', '40HC', '45HC', etc.
  movement_date    DATE,
  origin_terminal  TEXT,
  destination      TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (manifest_id, booking_number)
);

CREATE INDEX idx_vazios_bookings_manifest_id ON public.vazios_bookings(manifest_id);
```

> Sem BL, sem faturamento. Estrutura puramente operacional.

---

### Diagrama de Relações

```
voyages
 ├── granite_manifests
 │    └── granite_bls  ──── granite_bl_charges
 │                     ──── customers (via shipper_cnpj)
 └── vazios_manifests
      └── vazios_bookings
```

---

### Migrations

- `supabase/migrations/034_granite_module.sql` — tabelas Granito + RLS + índices
- `supabase/migrations/035_vazios_module.sql` — tabelas Vazios + RLS + índices

---

## 5.2 Integração com Excel

### Planilha de Granito — colunas da COSCO "Relatório de Cargas/Booking"

Mapeamento **pelo nome exato do cabeçalho** (linha 1), case-insensitive:

| Coluna na planilha | Campo interno | Obrigatório | Tipo | Notas |
|-------------------|--------------|-------------|------|-------|
| `#` | `sequence` | Não | integer | Ordem COSCO |
| `Booking` | `booking_number` | Não | text | |
| `BL` | `bl_number` | **Sim** | text | Chave de negócio |
| `Shipper Ref.` | `shipper_ref` | Não | text | |
| `Navio/Viagem` | `vessel_voyage` | Não | text | Mesmo valor p/ todo o manifesto |
| `L/PORT` | `loading_port` | Não | text | |
| `D/PORT` | `discharge_port` | Não | text | |
| `Shipper` | `shipper_name` | Não | text | |
| `CNPJ` | `shipper_cnpj` | Condicional | text | Pode vir vazio → pendência manual |
| `Consignee` | `consignee_name` | Não | text | |
| `Charter` | `charter` | Não | text | |
| `Shipper's M3` | `shipper_m3` | Não | numeric | |
| `Shipper's Weight` | `shipper_weight_kg` | Não | numeric | |
| `Blocks Qtty` | `blocks_qty` | Não | integer | |
| `Received Blocks Qtty` | `received_blocks_qty` | Não | integer | |
| `Balance` | `blocks_balance` | Não | integer | Calculado: `blocks_qty - received_blocks_qty` |
| `Shipper's Final M3` | `final_m3` | Não | numeric | |
| `Real Weight` | `real_weight_kg` | **Sim** | numeric | **Base do faturamento** |
| `Stockyard` | `stockyard` | Não | text | |
| `Remarks` | `remarks` | Não | text | |
| `Restrição parcial` | `partial_restriction` | Não | boolean | "Sim" → true |
| `Coscos Transportation` | `cosco_transport` | Não | text | |
| `Fragile Blocks` | `fragile_blocks` | Não | integer | |
| `CSSC Selection` | `cssc_selection` | Não | text | |
| `Prontidão de Carga` | `cargo_readiness_date` | Não | date | Parse `dd/mm/yy` → ISO |
| `Fase` | `phase` | Não | text | |

### Planilha de Vazios — colunas (definir template interno)

| Coluna esperada | Campo interno | Obrigatório | Tipo |
|----------------|--------------|-------------|------|
| `Booking` | `booking_number` | **Sim** | text |
| `Container` / `Contêiner` | `container_number` | Não | text |
| `Tipo` / `Type` | `container_type` | Não | text |
| `Data Movimentação` | `movement_date` | Não | date |
| `Terminal Origem` | `origin_terminal` | Não | text |
| `Destino` | `destination` | Não | text |
| `Observações` | `notes` | Não | text |

> O template de Vazios deve ser disponibilizado para download no módulo, já que a COSCO não exporta este formato diretamente.

---

### Parsing Services

Novos arquivos (espelham o padrão de `breakbulkImport.ts`):

**`src/services/graniteImport.ts`**
- `parseGraniteManifestFile(file: File): Promise<ParsedGraniteManifest>`
- `parseGraniteManifestBuffer(buffer: ArrayBuffer): Promise<ParsedGraniteManifest>`
- `importGraniteManifest(args): Promise<{ manifestId: string }>`

```typescript
type ParsedGraniteManifest = {
  vesselVoyage: string
  bls: ParsedGraniteBl[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

type ParsedGraniteBl = {
  bl_number: string
  shipper_cnpj: string | null   // null = pendência manual
  real_weight_kg: number
  // ... demais campos
  clientId: string | null        // resultado do lookup em customers
  reconciliationStatus: 'matched' | 'missing_cnpj' | 'not_found'
}
```

**`src/services/vaziosImport.ts`**
- `parseVaziosManifestFile(file: File): Promise<ParsedVaziosManifest>`
- `parseVaziosManifestBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosManifest>`
- `importVaziosManifest(args): Promise<{ manifestId: string }>`

---

### Utilitários Reusados (sem modificação)

| Utilitário | Arquivo | Uso |
|-----------|---------|-----|
| `normalizeText()` | `src/lib/utils.ts` | Normalização de nomes de colunas |
| `toNumber()` | `src/lib/utils.ts` | Parse de numéricos com vírgula/ponto |
| `onlyDigits()` | `src/lib/utils.ts` | Normalização de CNPJ |
| `loadCustomerMaps()` | `src/services/customerReconciliation.ts` | Mapa de clientes para lookup |

> **Diferença do CNTR/BB**: o lookup é feito pelo `shipper_cnpj`, não pelo `consignee`.

---

### Validações de Parse

**Granito:**
- `bl_number` obrigatório — linha ignorada com erro se ausente
- `real_weight_kg` obrigatório e > 0 — erro se ausente ou zero
- `shipper_cnpj` ausente → `reconciliationStatus = 'missing_cnpj'` (não bloqueia parse, bloqueia commit)
- `shipper_cnpj` presente mas não encontrado em `customers` → `reconciliationStatus = 'not_found'`
- Conversão `Prontidão de Carga`: `dd/mm/yy` → ISO usando `parse` com locale `pt-BR`
- `Restrição parcial`: "Sim" (case-insensitive) → `true`; qualquer outro → `false`

**Vazios:**
- `booking_number` obrigatório
- Formato de contêiner (se preenchido): aviso se não bate `/^[A-Z]{4}\d{7}$/`

---

### Tratamento de CNPJ Ausente no Preview

O modal de importação de Granito deve suportar **resolução inline** antes do commit:
- Linhas com `reconciliationStatus = 'missing_cnpj'` exibem campo de input para digitação do CNPJ
- Ao digitar, trigger de lookup em tempo real no mapa de clientes já carregado
- Linhas com `reconciliationStatus = 'not_found'` exibem link "Cadastrar cliente" (abre em nova aba em `/clientes/novo`)
- O commit só é habilitado quando todos os BLs têm `client_id` resolvido OU o operador aceita importar com pendências (faturamento bloqueado para os pendentes)

---

## 5.3 Fluxo Funcional

### Granito

```
1. Upload      → Usuário seleciona .xls/.xlsx no modal do módulo /granito
2. Parse       → Client-side via SheetJS → ParsedGraniteManifest
                  (lookup de customers por shipper_cnpj incluído)
3. Preview     → Tabela com BLs: BL, Shipper, CNPJ, Peso Real, Fase
                  Status de vínculo por linha:
                    ✅ cliente encontrado
                    ⚠️  CNPJ ausente (campo inline para digitação)
                    ❌ CNPJ não cadastrado (link "Cadastrar cliente")
4. Resolução   → Operador preenche CNPJs ausentes inline; resolve pendências
5. Confirmação → Seleciona viagem cadastrada → clica "Importar"
6. Persistência → RPC `import_granite_manifest` (PL/pgSQL transacional):
                    a. INSERT granite_manifests
                    b. UPSERT granite_bls (chave: manifest_id + bl_number)
                    c. Trigger auto-cálculo de taxas p/ BLs com client_id resolvido
7. Feedback    → Toast: "X BLs importados, Y com faturamento pendente"
```

### Vazios

```
1. Upload      → Usuário seleciona .xlsx no modal do módulo /vazios
2. Parse       → Client-side → ParsedVaziosManifest
3. Preview     → Tabela: Booking, Container, Tipo, Data
4. Confirmação → Seleciona viagem → clica "Importar"
5. Persistência → INSERT vazios_manifests + UPSERT vazios_bookings
6. Feedback    → Toast: "X bookings importados"
```

**Deduplicação:** `UNIQUE (manifest_id, bl_number)` em `granite_bls` e `UNIQUE (manifest_id, booking_number)` em `vazios_bookings` previnem duplicatas intra-manifesto. Reimportação do mesmo arquivo cria novo manifesto (sem dedup por hash nesta fase).

**RPC:** criar `import_granite_manifest` e `import_vazios_manifest` como funções PL/pgSQL isoladas. Não reusar `import_manifest_transactional` (schema incompatível).

---

## 5.4 Integração com Viagem

O relatório operacional atual opera sobre a tabela `bls`. Como Granito e Vazios usam tabelas próprias, a integração é por **queries independentes** agregadas no front-end:

### Novos serviços de relatório

- `fetchGraniteReportByVoyage(voyageId)` → `{ totalBls, totalWeightKg, totalWeightTon, totalCbm }`
- `fetchVaziosReportByVoyage(voyageId)` → `{ totalBookings, totalContainers }`

### Relatório Operacional (`src/pages/Relatorios.tsx`)

Adicionar aba **"Granito"** com:
- Filtros: período, porto de descarga, cliente (CNPJ)
- Colunas: Manifesto, BL, Shipper, Peso Real (kg), Peso Real (ton), CBM, Fase, Status Faturamento
- Export XLSX via `src/services/exports.ts`

### Line Up TV (`src/pages/LineUp.tsx`)

Adicionar colunas "Granito (BLs)" e "Vazios (bookings)" consultadas via JOIN em `granite_manifests` e `vazios_manifests` por `voyage_id`.

### Painel Executivo (`src/pages/Dashboard.tsx`)

Novo card "Granito pendente" — contagem de `granite_bls` com `charge_status = 'not_calculated'` ou `client_id IS NULL`.

---

## 5.5 Faturamento — Granito

Granito usa **tabelas de taxas próprias** (`granite_rates`, `granite_bl_charges`) em vez do pipeline `charge_tables`/`charge_table_items` existente, pois a base de cálculo (`real_weight_kg`) e os tipos de cobrança são específicos.

### Tabela de Taxas (`granite_rates`)

CRUD administrado em `/granito/taxas`:

| `charge_type` | Cálculo | Exemplo |
|--------------|---------|---------|
| `per_kg` | `real_weight_kg × unit_value` | Taxa por kg bruto |
| `per_ton` | `(real_weight_kg / 1000) × unit_value` | Taxa de agenciamento por tonelada |
| `per_bl` | `unit_value` (fixo por BL) | BL Fee |
| `fixed` | `unit_value` (fixo global) | Taxa administrativa |

### Cálculo de Faturamento por BL

```
Para cada granite_rate ativo:
  quantity = real_weight_kg         (se per_kg)
           = real_weight_kg / 1000  (se per_ton)
           = 1                      (se per_bl ou fixed)
  subtotal = quantity × unit_value
total_bl = SUM(subtotal)
```

Resultados persistidos em `granite_bl_charges`. Função: `calculate_granite_bl_charges(bl_id)` (novo PL/pgSQL ou lógica front-end).

### Fluxo de Faturamento

```
granite_bls.charge_status:
  not_calculated → calculated → ready_for_billing → invoiced
```

Geração de invoice: os BLs de granito prontos entram no `create_invoice_from_bls` existente **vinculando `granite_bls.id` em vez de `bls.id`** — OU uma RPC dedicada `create_granite_invoice`. A decisão de reutilizar o pipeline de invoices vs. criar fluxo próprio depende da aceitação de misturar tipos na tabela `invoices`. Recomendação: reutilizar `invoices` com campo `manifest_type = 'granite'`.

### Modal de Faturamento por BL

Exibido no detalhe do BL de granito:
- Coluna: Taxa | Tipo | Quantidade | Valor Unit. | Subtotal | Moeda
- Rodapé: Total BRL

### Vazios — sem faturamento

Manifesto de Vazios é puramente operacional; não integra billing.

---

## 5.6 Interface (Alto Nível)

### Novas Rotas e Páginas

| Rota | Arquivo | Descrição |
|------|---------|-----------|
| `/granito` | `src/pages/Granite.tsx` | Lista de manifestos + BLs + importação |
| `/granito/taxas` | `src/pages/GraniteRates.tsx` | CRUD de `granite_rates` |
| `/vazios` | `src/pages/Vazios.tsx` | Lista de manifestos + bookings + importação |

### `/granito` — Tela Principal

- **Header:** título + botão "Importar Planilha COSCO"
- **Filtros:** viagem, porto de descarga, cliente, texto livre (BL/Shipper)
- **Tabela de BLs:** BL | Shipper | CNPJ | Navio/Viagem | Peso Real (kg) | Fase | Status Faturamento
- **Modal de Importação** (3 passos):
  1. Upload `.xls/.xlsx` + seleção de viagem
  2. Preview com status de vínculo de cliente por linha (✅/⚠️/❌) + campos inline para CNPJ ausente
  3. Confirmação com resumo (N BLs, N pendentes, total de peso)
- **Detalhe do BL** (modal ou página): todos os campos + breakdown de faturamento (`granite_bl_charges`)

### `/granito/taxas` — CRUD de Taxas

- Listagem de `granite_rates` com toggle ativo/inativo
- Formulário: descrição, tipo de cobrança, valor unitário, moeda
- Acesso restrito a `admin`

### `/vazios` — Tela Principal

- **Header:** título + botão "Importar Planilha" + link "Baixar Template"
- **Filtros:** viagem, texto livre (booking/container)
- **Tabela:** Booking | Container | Tipo | Data Movimentação | Observações
- **Modal de Importação:** upload + seleção de viagem + preview simples

### Componentes Reusados (sem modificação)

- `src/components/ui/Modal.tsx` — wrapper de modal
- `src/components/ui/Button.tsx` — botões com variantes
- `src/components/ui/Toast.tsx` — feedback de ação
- `src/components/ui/Input.tsx` — campos de formulário
- Padrão de seleção de viagem (já presente em outros modais)

### Navegação (`src/components/layout/AppLayout.tsx`)

Adicionar na seção "Operação":
- "Granito" (ícone de cubo/bloco)
- "Vazios" (ícone de container vazio)

---

## 5.7 Pontos Críticos

| Ponto | Risco | Mitigação |
|-------|-------|-----------|
| `CNPJ` ausente na planilha COSCO | Operador não pode salvar sem client_id | Preview bloqueia commit por padrão; campo inline resolve antes do submit |
| `blocks_balance` como coluna gerada | PostgreSQL ≥ 12 suporta `GENERATED ALWAYS AS (...) STORED`; Supabase OK | Confirmar versão do PostgreSQL no projeto antes de criar a coluna |
| Faturamento via `invoices` existente vs. tabela nova | Misturar tipos em `invoices` exige `manifest_type` discriminador | Adicionar `manifest_type TEXT DEFAULT 'standard'` em `invoices` via migration; granito usa `'granite'` |
| `granite_rates` sem vigência por data | Mudança de taxa afeta recálculo histórico | Adicionar `valid_from/valid_to` na tabela `granite_rates` desde o início |
| RLS em novas tabelas | Dados expostos sem políticas | Criar 4 políticas por tabela (SELECT/INSERT/UPDATE/DELETE) + GRANT para `authenticated` |
| Auditoria | `granite_bls` não herda triggers de `bls` | Criar trigger de auditoria em `granite_bls` mirrorando o padrão de `audit_logs` |
| Performance de relatório Granito | Query sem filtro de data pode retornar muitas linhas | Índice em `granite_bls(manifest_id)` + limite de 2.000 linhas com flag `truncated` |
| Template de Vazios inexistente | Operador não sabe qual planilha usar | Disponibilizar template `.xlsx` para download na tela `/vazios` |
| `vessel_voyage` como texto livre | Dificulta agrupamento por viagem se houver variações de digitação | Usar `voyage_id` FK como chave canônica; `vessel_voyage` é apenas metadado do manifesto |

---

## Arquivos Críticos

### Novos arquivos

| Arquivo | Descrição |
|---------|-----------|
| `supabase/migrations/034_granite_module.sql` | Tabelas `granite_manifests`, `granite_bls`, `granite_rates`, `granite_bl_charges` + RLS + índices |
| `supabase/migrations/035_vazios_module.sql` | Tabelas `vazios_manifests`, `vazios_bookings` + RLS + índices |
| `supabase/migrations/036_granite_billing_rpc.sql` | RPC `import_granite_manifest`, `calculate_granite_bl_charges`, `import_vazios_manifest` |
| `src/services/graniteImport.ts` | Parser + importer para planilha COSCO |
| `src/services/vaziosImport.ts` | Parser + importer para planilha de vazios |
| `src/services/graniteCharges.ts` | Cálculo de faturamento por BL de granito |
| `src/pages/Granite.tsx` | Lista de manifestos/BLs + modal de importação |
| `src/pages/GraniteRates.tsx` | CRUD de tabela de taxas (`granite_rates`) |
| `src/pages/Vazios.tsx` | Lista de manifestos/bookings + modal de importação |

### Arquivos existentes a modificar

| Arquivo | Modificação |
|---------|------------|
| `src/components/layout/AppLayout.tsx` | Adicionar rotas "Granito" e "Vazios" no nav |
| `src/services/reports.ts` | Adicionar `fetchGraniteReportByVoyage`, `fetchVaziosReportByVoyage` |
| `src/services/exports.ts` | Adicionar aba Granito no workbook do relatório operacional |
| `src/types/database.ts` | Adicionar tipos `GraniteManifest`, `GraniteBl`, `GraniteRate`, `GraniteBlCharge`, `VaziosManifest`, `VaziosBooking` |
| `src/pages/Relatorios.tsx` | Adicionar aba "Granito" com filtros + tabela + export |
| `src/pages/LineUp.tsx` | Colunas "Granito (BLs)" e "Vazios (bookings)" por viagem |
| `src/pages/Dashboard.tsx` | Card "Granito pendente" |
| `README.md` | Documentar módulos Granito e Vazios |
| `docs/ROADMAP.md` | Atualizar estado e roadmap |

---

## Entregáveis Documentais

### README.md — Atualizações

- Seção "Módulos em Produção > Operação": adicionar
  - **Manifestos Granito** — importação de `.xlsx`, preview, lista de BLs, faturamento por tonelada
  - **Manifestos Vazios** — importação de `.xlsx`, preview, lista de contêineres vazios
- Fluxo de Trabalho Típico: incluir passos de Granito e Vazios
- Rotas Relevantes: `/granito` e `/vazios`

### ROADMAP.md — Atualizações

- Seção "Entregue": mover "Manifestos Granito" e "Manifestos Vazios" após implementação
- Detalhar: importação Excel, modelo de dados, billing de granito, integração com relatório
- Atualizar "Próximas Entregas" e "Riscos Monitorados"

---

## Plano de Verificação

| Etapa | Verificação |
|-------|-------------|
| Migrations aplicam | `034_granite_module.sql` e `035_vazios_module.sql` executam sem erro; tabelas visíveis no Supabase |
| Import Granito — CNPJ presente | Upload de `.xls` COSCO com CNPJ preenchido → BL criado com `client_id` resolvido; `real_weight_kg` persistido |
| Import Granito — CNPJ ausente | Upload com CNPJ vazio → preview exibe ⚠️; campo inline aceita CNPJ; commit liberado após resolução |
| Import Granito — CNPJ não cadastrado | Preview exibe ❌; link "Cadastrar cliente" funciona; BL não pode ser commitado sem resolução |
| Import Vazios | Upload de planilha → `vazios_bookings` criados com `booking_number`; sem BL |
| Cálculo de taxas Granito | Cadastrar taxa `per_ton`; rodar `calculate_granite_bl_charges(bl_id)`; verificar `granite_bl_charges` com `quantity = real_weight_kg/1000` |
| CRUD `granite_rates` | Criar, editar, desativar taxa em `/granito/taxas`; taxa inativa não entra no cálculo |
| Relatório Granito | Acessar `/relatorios` aba Granito; filtrar por viagem; exportar XLSX com colunas corretas |
| Line Up TV | Abrir `/lineup`; colunas "Granito (BLs)" e "Vazios (bookings)" exibem contagens corretas por viagem |
| RLS | Verificar com usuário autenticado sem role admin que SELECT em `granite_bls` e `vazios_bookings` funciona; INSERT só via RPC |
| Testes de parser | `npm test` — adicionar fixture da planilha COSCO e verificar parse de `Prontidão de Carga`, `Restrição parcial`, `Real Weight` |
# DOCUMENTO HISTORICO

Este documento registra decisoes de planejamento ja incorporadas ao produto.
Nao use este arquivo como fonte de verdade operacional.
