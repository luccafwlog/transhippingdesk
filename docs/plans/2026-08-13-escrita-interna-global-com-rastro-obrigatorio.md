# Plano — escrita interna global com rastro obrigatório

Status: TODO

Origem: sessão de grilling de 2026-08-13 sobre as decisões de escrita do RBAC,
disparada pela investigação dos furos de leitura remanescentes da ADR 0044.

Substitui o eixo de escrita da
[ADR 0044](../adr/0044-leitura-interna-global-departamento-restringe-escrita.md).

## Objetivo

Trocar a autorização por departamento pelo **rastro obrigatório**: todo
departamento interno ativo lê e escreve em todos os módulos, e o registro de
quem fez o quê — com o departamento congelado no momento do evento — passa a
ser o controle, no lugar da barreira prévia.

A ordem é inegociável: **o rastro existe antes de a barreira sair**. Abrir a
escrita antes de instrumentar a auditoria produziria uma janela em que ninguém
é barrado e nada é registrado, estritamente pior que o estado atual nos dois
eixos.

## Não-objetivos

- Mexer no RBAC do Portal do Cliente (fronteira por CNPJ, ADR 0013).
- Afrouxar a exclusão de registros operacionais, o provisionamento do Portal ou
  a administração de usuários — as três exceções decididas.
- Mudar o Sign-off Departamental do ADR de Saída, que continua sendo a única
  autoridade que o departamento exerce dentro do sistema.

## Decisões que este plano executa

| Decisão | Alcance |
|---|---|
| Escrita interna é global | Todo departamento ativo escreve em todos os módulos |
| Exclusão de registro operacional continua com Administrativo | O registro não desfaz exclusão |
| Provisionamento do Portal continua com Administrativo + Documentação | Erro escapa da empresa e não é reversível internamente |
| `/admin/usuarios` continua exclusivo do Administrativo, inclusive na leitura | Única exceção à leitura global |
| Sign-off Departamental do ADR de Saída permanece departamental | Ali o departamento significa responsabilidade, não permissão |
| Departamento é congelado no evento | Sem isso o log reescreve o passado a cada mudança de setor |
| Ator não-humano assina `sistema` | Vocabulário já usado em `_portal_log_event` |
| Auditoria por grão | Uma ação humana → um evento; carga em massa → o evento é o lote |

### Regra de desambiguação — o que é "exclusão de registro operacional"

A decisão "apagar continua com Administrativo" foi tomada sobre o `DELETE` de
registro operacional: B/L, container, veículo, viagem, manifesto, escala. Ela
**não** alcança a remoção de uma linha que a própria pessoa lançou no mesmo
fluxo de edição — taxa manual de B/L, taxa manual de fatura, booking manual de
vazios. Remover a linha que se acabou de lançar é parte de editar, e tratá-la
como exclusão **restringiria** um fluxo que hoje funciona, o que este plano não
se propõe a fazer.

Consequência prática: `delete_manual_bl_charge`, `delete_manual_invoice_charge`
e `delete_manual_vazios_booking` seguem o gate de escrita (aberto);
`delete_baplie_manifest_for_voyage` e todas as policies `DELETE` de tabela
seguem em `is_admin()`.

---

> **Numeração**: `293` está reservada por `293_cnpj_alfanumerico.sql`, em
> desenvolvimento paralelo. Este plano usa `294` e `295`. Confirmar o próximo
> número livre em `supabase/migrations/` antes de criar os arquivos, conforme a
> ADR 0016.

## Etapa 1 — migration `294_audit_trail_actor_and_triggers.sql`

Instala o rastro. Nenhuma permissão muda nesta etapa.

### 1.1 Departamento congelado no evento

`audit_logs` ganha `actor_role TEXT`, preenchida por `DEFAULT`, para que
nenhum dos 68 call sites existentes precise ser tocado:

```sql
CREATE OR REPLACE FUNCTION public.current_actor_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN 'sistema'
    ELSE (
      SELECT CASE up.role WHEN 'admin' THEN 'administrativo'
                          WHEN 'operator' THEN 'documentacao'
                          ELSE up.role END
      FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.active = true
    )
  END;
$$;

-- Dois comandos, não um. `ADD COLUMN ... DEFAULT <expr>` avalia a expressão
-- UMA vez e grava o resultado em todas as linhas existentes (attmissingval,
-- PG 11+) — com `current_actor_role()` sendo STABLE, toda a história herdaria
-- o papel de quem rodou a migration. Adicionar sem default e só então
-- declarar o default preserva `NULL` no passado e avalia por INSERT no futuro.
ALTER TABLE public.audit_logs ADD COLUMN actor_role TEXT;
ALTER TABLE public.audit_logs
  ALTER COLUMN actor_role SET DEFAULT public.current_actor_role();
```

`NULL` volta a significar uma coisa só — identidade sem perfil ativo, anomalia
a investigar. Linhas anteriores à 294 **ficam com `NULL`**: preenchê-las com o
departamento atual assaria justamente a distorção que esta migration existe
para eliminar. A UI exibe `—` para elas.

### 1.2 Trigger genérico de auditoria

`public.audit_row_changes()`, `AFTER INSERT/UPDATE/DELETE FOR EACH ROW`,
recebendo o nome da coluna de chave primária em `TG_ARGV[0]` (padrão `id`).
Volume limitado por desenho:

- `INSERT` → **uma** linha, `field_name = 'criado'`
- `UPDATE` → uma linha **por campo alterado** (formato atual de `audit_logs`)
- `DELETE` → **uma** linha, `field_name = 'excluido'`

`entity_type` = `TG_TABLE_NAME`; `entity_id` = a chave primária **convertida
para texto** (`bls.id` é `TEXT`, `granite_bls.id` é `UUID`, o resto é `BIGINT`);
`changed_by` = `auth.uid()`; `actor_role` cai no `DEFAULT`.

**A função precisa ser `SECURITY DEFINER`.** A policy `audit_logs_insert_self`
exige `is_active_user() AND changed_by = auth.uid()` (`014:41`, endurecida em
`096:34`). Um trigger rodando como o chamador seria rejeitado em dois casos
previsíveis: escrita de `service_role` (sem `auth.uid()` — exatamente o ator
`sistema` que 1.1 introduz) e, na janela entre a 294 e a 295, qualquer escrita
legítima de Equipamentos, que `is_active_user()` ainda exclui — quebraria
VAZIOS EXP e Veículos em produção. Além do mais, o registro de auditoria não
pode ser recusável pelo próprio autor do ato.

### 1.3 A quem o trigger é aplicado — critério de grão

**Grão humano — trigger completo.** Uma ação de uma pessoa gera uma linha.

Cadastros: `customers`, `customer_contacts`, `carriers`, `vessels`, `ports`,
`voyages`, `voyage_export_schedules`, `vessel_schedules`, `voyage_omissions`,
`voyage_route_ce_master`, `bl_transshipments`, `ended_vessels`, `depots`,
`depot_services`.

Tarifas e configuração: `charge_tables`, `charge_table_items`,
`customer_rate_overrides`, `demurrage_rates`, `granite_rates`,
`vazios_reorg_rates`, `vazios_reorg_services`, `exchange_rate_reference`.

Financeiro: `invoices`, `invoice_items`, `payments`, `invoice_refunds`,
`invoice_bls`, `bl_receivables`, `invoice_receivable_links`,
`ledger_settlements`, `demurrage_invoices`, `demurrage_invoice_items`.

Lotes (o `INSERT` **é** o evento da importação): `import_batches`,
`granite_manifests`, `vazios_manifests`, `vazios_importacao_manifests`.

> As oito primeiras tarifas e cadastros são o buraco de hoje: `charge_tables`,
> `charge_table_items`, `customer_rate_overrides`, `demurrage_rates`,
> `granite_rates`, `depots`, `depot_services` e `vehicles` são escritos direto
> da tela, sem passar por RPC, e **não registram nada**. Hoje isso passa porque
> só Administrativo os altera; a Etapa 2 acaba com essa premissa.

**Linhas de lote — trigger só em `UPDATE`/`DELETE`.** Nascem em massa; a
criação já é contada pelo lote, mas a edição posterior é ação humana:
`bls`, `bl_containers`, `bl_breakbulk_items`, `bl_freight_lines`,
`granite_bls`, `granite_bl_charges`, `vazios_bookings`,
`vazios_importacao_containers`, `baplie_containers`, `vehicles`,
`charge_calculations`, `vazios_export_operations`,
`vazios_export_service_lines`.

**Fora do caderninho.** Já são registro de evento, ou são estado técnico:
`audit_logs`, `import_errors`, `billing_runs`, `billing_run_logs`,
`billing_batches`, `invoice_lifecycle_events`, `demurrage_invoice_history`,
`portal_*` (cobertas por `portal_provisioning_events`),
`agency_departure_report*` (cobertas pelo próprio sign-off),
`customer_reconciliation_queue`, `pricing_rule_versions`, `invoice_counters`,
`provision_rate_limit_log`, `baplie_reconciliation_resolutions`,
`portal_login_attempts`, `alerts` (geradas em massa pelas rotinas `detect_*`).
`user_profiles` já tem trigger próprio desde `259` — não duplicar.

### 1.4 Congelar a descrição do evento de importação

A linha do tempo já monta `"17 B/Ls importados · BRSSZ → BRPNG"`
(`voyageSummaries.ts:690-703`), mas **recalcula rota e contagem na leitura**, a
partir dos B/Ls que existem agora (`VoyageVisaoTab.tsx:67`). Corrigir o POD de
um B/L reescreve o evento passado.

- `import_batches` ganha `route_summary TEXT`, preenchida por
  `import_manifest_transactional` e `import_bl_freight_transactional` a partir
  dos B/Ls **daquele lote**, no momento da importação.
- Backfill único a partir dos B/Ls atuais, para os lotes já existentes.

### 1.5 O órfão: Baplie

O Baplie é a única importação **sem linha de lote** — grava direto em
`baplie_containers`, então a linha do tempo mostra a data sem autor nem
contagem. Sem criar tabela nova:
`import_baplie_staging_transactional` passa a gravar **uma** linha em
`audit_logs` (`entity_type = 'baplie_import'`, `entity_id` = a viagem,
`field_name = 'criado'`, `new_value` = contagem de containers).

### 1.6 Leitura da autoria na linha do tempo

`voyageTimeline.ts` hoje resolve nomes apenas para eventos de escala e de
edição. Passa a:

1. selecionar `uploaded_by` em `import_batches` (linha 69);
2. incluir esses ids no conjunto de atores (linhas 79-84);
3. ler `actor_role` de `audit_logs` em vez de derivar o departamento do perfil
   atual — o `JOIN` em `user_profiles.role` das linhas 88-101 deixa de
   determinar o departamento e passa a resolver **só o nome**.

---

## Etapa 2 — migration `295_internal_writes_global.sql`

Abre a escrita. Só entra depois da 294 aplicada e verificada.

### 2.1 Um carimbo volta a dizer a verdade

`211_equipamentos_rbac_hardening.sql` redefiniu `is_active_user()` para excluir
`equipamentos`. É a armadilha que originou toda esta investigação: um nome que
mente, usado em ~26 RPCs. A redefinição de volta é o núcleo desta migration —
ela abre sozinha todas as RPCs gateadas só por ela, e **também fecha oito dos
onze furos de leitura** mapeados na investigação:

```sql
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
  );
$$;
```

Fica idêntica a `is_active_read_user()`, que permanece como o nome canônico de
leitura (nota da ADR 0044) — nenhuma das duas mente mais.

### 2.2 De oito carimbos para dois

Varredura dinâmica de `pg_policies`, no idioma da própria `211`, substituindo
`is_active_non_equipamentos_user()` por `is_active_user()` e simplificando os
`is_active_user() OR is_equipamentos_user()` — redundantes após 2.1.

Depois de nenhuma policy e nenhuma RPC os referenciarem, dropar:
`can_edit_voyages()`, `can_edit_customers()`, `can_edit_local_charges()`,
`can_edit_depots()`, `is_equipamentos_user()`,
`is_active_non_equipamentos_user()`.

Sobram dois: `is_admin()` e `is_active_user()`.

### 2.3 O que **não** muda

- Todas as policies `DELETE` seguem em `is_admin()`.
- RPCs com `is_active_user() AND is_admin()` de escrita seguem restritas.
- Provisionamento do Portal (`192`, `195`) segue em
  `administrativo, documentacao`, e `portal_admin_change_cnpj` segue só
  `administrativo`.
- `/admin/usuarios` e `admin_list_users` seguem em `is_admin()`.
- Sign-off Departamental (`213`, `225`, `228`, `253`, `258`) intacto.

**Verificação obrigatória ao fim da migration**: nenhuma policy `DELETE` e
nenhuma RPC de escrita de faturamento passou a referenciar `is_active_user()`
por efeito colateral de 2.1 — falhar a migration se acontecer.

### 2.4 Os três furos de leitura que a redefinição não alcança

Gateados por `is_admin()`, precisam de edição explícita para
`is_active_read_user()`:

| RPC | Origem | Efeito hoje |
|---|---|---|
| `list_invoice_details` | `020:761` | 42501 ao abrir qualquer fatura, para todos menos Administrativo |
| `get_consolidated_invoice_item_breakdown` | `090:43` | detalhamento vazio, silencioso |
| `get_customer_portal_account` | `129:108` | latente (sem chamador atual) |

### 2.5 O furo de leitura do console do Portal

`292:258-259` estendeu o console a `operacoes` e `equipamentos`, mas o
histórico de eventos só a `equipamentos` — Operações abre o console e toma
42501 no histórico. Em vez de acrescentar mais um papel a uma allowlist que já
derivou uma vez, `portal_list_provisioning_console` e
`portal_list_provisioning_events` passam a gatear leitura por
`is_active_read_user()`. A **escrita** de provisionamento (2.3) não muda.

---

## Etapa 3 — frontend

### 3.1 Colapsar a matriz de permissões

`src/hooks/useAuth.tsx`: de 14 permissões para **três**.

Sobrevivem: `admin_panel`, `manage_users` (tela de Usuários) e
`portal_provisioning` (Administrativo + Documentação, decisão A6).

Removidas, com seus call sites: `charge_tables` e `charge_overrides`
(`TaxasLocais.tsx`), `voyages_edit` (`VoyageCard.tsx`, `VoyageVisaoTab.tsx`,
`BlDetalhe.tsx`, `Viagens.tsx`), `manifests_upload` (`Baplie.tsx`),
`customers_edit` (`Clientes.tsx`, `CadastroContatosTab.tsx`), `vazios_edit` e
`veiculos_edit` (`VoyageImportActions.tsx`, `Veiculos.tsx`, `EmbarqueVazios.tsx`),
`depots_edit` (`DepotCadastro.tsx`), `demurrage_edit`, `faturamento_edit`,
`reconciliacao_edit` (sem call site).

### 3.2 Gates `isAdmin` — o que abre e o que fica

**Abre** (ação de escrita, agora global): criar/editar tarifa em
`DemurrageRates.tsx:98-161` e `GraniteRates.tsx:100-163`.

**Fica** (exclusão de registro operacional): `Containers.tsx`,
`Manifestos.tsx`, `Veiculos.tsx` (`canDeleteVehicles`),
`VoyageVisaoTab.tsx:277` (excluir escala), `VoyageCard.tsx:329`.

**Fica** (exceções decididas): `ProtectedRoute adminOnly`, o item de menu
`/admin`, `PortalReviewPanel.tsx:135` (troca de CNPJ auditada).

**Revisar caso a caso**: `InvoiceDetailModal.tsx:531` e `Reconciliacao.tsx:345`
(cancelar baixa) — decisão A4 abriu as operações irreversíveis de caixa, então
abrem, mantida a justificativa obrigatória que já existe.

### 3.3 Texto que o administrador lê

`PROFILE_SCOPES` (`src/services/adminUsers.ts:69-75`) hoje descreve um modelo
de allow-list por departamento que deixa de existir. Reescrever os cinco itens
para o modelo novo: leitura e escrita globais, com as três exceções nomeadas e
o sign-off de cada departamento.

---

## Etapa 4 — documentação

### 4.1 ADR 0046 (nova)

`docs/adr/0046-escrita-interna-global-com-rastro-obrigatorio.md`, com o
conteúdo abaixo. Substitui a 0044 em vez de emendá-la: a metade "leitura é
global" continua valendo e é reafirmada no corpo, para que exista **um**
documento a ler.

> **Contexto.** A ADR 0044 corrigiu o eixo de leitura e manteve o eixo de
> escrita restrito por departamento, via `is_admin()` e helpers
> `can_edit_*`. A revisão de 2026-08-13 das ~73 RPCs de escrita mostrou que o
> modelo não descrevia a operação real: 26 exigiam Administrativo, 26 aceitavam
> qualquer perfil exceto Equipamentos — uma exclusão herdada da `211` que o
> `CONTEXT.md` nunca declarou — e apenas 5 aceitavam os cinco departamentos. A
> matriz do frontend, o `PROFILE_SCOPES` e o banco discordavam entre si, e a
> operação real é departamentalmente fluida: a mesma pessoa cobre funções de
> mais de um departamento conforme o dia.
>
> **Decisão.** A escrita de dado interno é liberada a todo departamento interno
> ativo. O controle passa a ser o **rastro obrigatório**: toda escrita registra
> autor e departamento, este último congelado no momento do evento. A leitura
> permanece global, como decidido na 0044.
>
> Três exceções, cada uma por um motivo distinto:
>
> 1. **Exclusão de registro operacional** — só Administrativo. O registro prova
>    que sumiu; não traz de volta.
> 2. **Provisionamento do Portal do Cliente** — Administrativo e Documentação.
>    É a única família de escritas cujo erro sai da empresa: convite ao email
>    errado ou CNPJ trocado expõe dado de um cliente a outro, e o registro não
>    desfaz a exposição. Sustenta o Teste de isolamento por CNPJ.
> 3. **Administração de usuários** (`/admin/usuarios`) — só Administrativo,
>    inclusive na leitura. É a única exceção à leitura global.
>
> O Sign-off Departamental do ADR de Saída permanece departamental: ali o
> departamento exprime responsabilidade, não permissão.
>
> **Consequências.** *Positivas*: o departamento deixa de bloquear trabalho
> legítimo, e a autoridade fica em um lugar auditável em vez de espalhada por
> oito helpers e ~30 policies. *Negativas*: o sistema passa a depender da
> integridade do registro — um erro de boa-fé não é mais impedido, apenas
> atribuído; e a auditoria vira caminho crítico, não acessório. *Difícil de
> reverter*: reintroduzir barreiras por departamento exigiria remontar a matriz
> de permissões e reescrever as policies, com a operação já acostumada ao
> modelo aberto.

### 4.2 ADR 0044

Ganha `Status: substituída pela ADR 0046 — 2026-08-13`, preservada como
registro histórico conforme o contrato de documentação do `CLAUDE.md`.

### 4.3 `CONTEXT.md`

**Remover** — descrevem um modelo que deixa de existir: "Escopo de Operações",
"Escopo de Equipamentos", "Escopo de Documentação", e a última frase de
"Visualização global interna" ("A única escrita do Financeiro é a conciliação
de pagamentos").

**Adicionar** três termos:

> **Departamento**
> Assinatura de responsabilidade de um usuário interno (Administrativo,
> Financeiro, Operações, Documentação, Equipamentos). Identifica o autor no
> registro de eventos e define quem assina cada seção do ADR de Saída. Não
> delimita acesso.
> _Evitar_: setor, perfil de acesso, papel, role.
>
> **Escrita interna global**
> Todo Departamento ativo altera dados em todos os módulos. As exceções são
> três, e nenhuma delas é departamental por conveniência: exclusão de registro
> operacional (Administrativo), provisionamento do Portal (Administrativo e
> Documentação) e administração de usuários (Administrativo).
>
> **Rastro obrigatório**
> Toda escrita registra autor e Departamento no instante do evento. O
> Departamento é gravado junto com o evento, nunca derivado do cadastro atual —
> uma pessoa que muda de Departamento não reescreve o próprio passado. Ações
> automáticas assinam `sistema`.

**Ajustar** "Visualização global interna" para nomear `/admin/usuarios` como a
única exceção, e "Dupla proteção RBAC" para refletir que a UI orienta e o
registro responsabiliza.

### 4.4 `docs/RASTREABILIDADE.md`

Atualizar as linhas das rotas e RPCs tocadas pelas Etapas 2 e 3.

---

## Etapa 5 — testes

Um por decisão, no padrão dos testes de migration existentes
(`src/services/__tests__/*Migration.test.ts`):

1. **Rastro grava o departamento da época** — evento criado com o usuário em um
   departamento; o departamento do usuário muda; o evento antigo continua
   exibindo o departamento original. É o teste que prova a decisão B2, e o
   único que falha hoje por desenho.
2. **Escrita aberta aos cinco** — cada departamento altera uma tarifa, um
   cliente e um B/L sem 42501.
3. **Exclusão continua fechada** — não-Administrativo recebe 42501 ao excluir
   B/L, container, veículo e escala.
4. **Portal continua fechado** — Financeiro, Operações e Equipamentos recebem
   42501 em `portal_set_exception` e `portal_cancel_invite`.
5. **Leitura do Portal aberta** — os cinco leem console e histórico de
   provisionamento (fecha o furo do `292`).
6. **Fatura abre para todos** — `list_invoice_details` responde aos cinco.
7. **Importação registra autor, contagem e rota congelados** — alterar o POD de
   um B/L depois da importação não muda o evento na linha do tempo.

O teste de integração `supabase.integration.test.ts:164` ("RLS financeiro
permite leitura") valida apenas `error === null` e passa vacuamente com RLS
negando. Corrigir para asserir linhas, não ausência de erro — foi essa asserção
vazia que deixou o furo original passar.

---

## Pendências antes de executar

| # | Pendência | Bloqueia |
|---|---|---|
| 1 | Aval da regra de desambiguação de exclusão (as três RPCs de linha manual seguem abertas) | Etapa 2 |
| 2 | Autorização para regenerar `src/types/database.ts`, protegido por `.claude/hooks/protect-files.sh` — a coluna `actor_role` e as seis funções dropadas mudam os tipos gerados | Etapas 1 e 3 |
| 3 | Confirmar o próximo número livre de migration; `293` está reservada por trabalho paralelo ainda não mergeado | Etapas 1 e 2 |
| 4 | Medir o volume de `UPDATE` em `charge_calculations` num recálculo real de viagem cheia antes de ligar o trigger nela — é a única tabela da lista que uma ação humana altera em massa | Etapa 1 |

A pendência 4 tem saída conhecida se o volume assustar: manter
`charge_calculations` fora do trigger e cobrir a recalculação pelo evento de
`import_batches`, que já registra o lote — mesma lógica de grão aplicada às
demais tabelas filhas.

## Ordem e risco

| # | Passo | Risco |
|---|---|---|
| 1 | Migration 294 + leitura da autoria na linha do tempo | Baixo — só adiciona registro |
| 2 | Verificar em preview que as tabelas de tarifa passaram a registrar | — |
| 3 | Migration 295 | **Alto** — abre escrita em massa; a verificação de 2.3 é o freio |
| 4 | Frontend (Etapa 3) | Médio — remover gate a mais deixa botão órfão; a mais a menos, tela travada |
| 5 | Documentação (Etapa 4) | Baixo |
| 6 | Testes (Etapa 5) | — |

Passos 1 e 3 em migrations separadas mesmo indo ao ar juntos: se a abertura
precisar de rollback, o rastro não volta junto.

## Verificação

- `npm run docs:check` — obrigatório (Markdown, ADRs, rotas).
- `npm run lint`, `npm test`, `npm run build`.
- Migrations validadas contra Supabase Preview antes do merge, conforme
  `WORKFLOW.md`.
- Checagem manual em preview: um usuário de cada departamento altera uma tarifa
  e confere o próprio nome e departamento na tela de auditoria.
