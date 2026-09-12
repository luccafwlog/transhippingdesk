# 2026-09-12 — Transição de marca: Transhipping Desk → Vela

- **Status:** plano de execução aprovado; execução **não iniciada**.
- **Escopo:** renomear o **sistema interno** para **Vela** e lançar em
  `vela.app.br`.
- **Executor previsto:** Codex, seguindo os blocos do §6 na ordem dada.
- **Fora de escopo:** a marca FWLog e o conteúdo do Portal do Cliente, tratados
  em sessão própria. A **separação técnica** dos dois builds é feita aqui — ver
  §5, decisão D1, e o bloco B6.
- **Contexto decisivo:** o sistema **ainda não está em produção**. Nem os
  usuários internos nem o Portal estão ativos; o lançamento é previsto para
  algumas semanas. Isto muda a estratégia mais do que qualquer detalhe técnico
  deste documento — ver §4.2.
- **Domínios reservados** (pagamento pendente): `vela.app.br` para o sistema
  interno, `portalfwlog.com.br` para o Portal do Cliente.

---

## 0. Como executar este plano

### 0.1 Regras invioláveis

1. **Nunca rode substituição global.** Um `sed -i 's/Transhipping Desk/Vela/g'`
   no repositório inteiro coloca a string `Vela` dentro de e-mails enviados ao
   cliente (`src/services/customerCommunicationTemplates.ts`, linhas 233, 249 e
   440) e reescreve 169 ocorrências em `docs/archive/`, que é registro
   histórico protegido pelo `CLAUDE.md`. Cada bloco do §6 lista os arquivos
   nominalmente; edite apenas esses.
2. **Nada de `Vela` na superfície do cliente.** Nenhuma string `Vela` pode
   alcançar rotas `/portal/*`, `supabase/functions/_shared/portalEmailTemplates.ts`,
   `src/services/customerCommunicationTemplates.ts` ou os componentes de
   documento fiscal. O bloco B5 cria o teste que trava isso.
3. **Nada de identidade financeira.** Ver a lista fechada do §2.
4. **Um bloco por PR.** Sem produção no ar não há risco de convivência; a
   divisão serve à revisão. Se preferir PR única, mantenha os blocos como
   commits separados e na ordem.
5. **Se um arquivo não estiver listado em nenhum bloco, não o edite** — leve a
   dúvida para o autor do plano em vez de decidir sozinho.

### 0.2 Código e console são coisas diferentes

Este plano tem dois executores. O Codex faz o §6 (repositório). O usuário faz o
§7 (painéis web: Vercel, GitHub, Supabase, Resend, Sentry, registro.br). Nenhum
item do §7 pode ser marcado como concluído por quem só tem acesso ao
repositório.

### 0.3 Ordem e bloqueios

```
B1 → B2 → B3 → B4 → B5 → B6 → B7 → §7 (painéis) → B8
                          ▲    ▲                    ▲
                    separação  domínio        identidade
                   dos builds  e CORS            visual
```

As quatro decisões do §5 estão **fechadas**; não há bloqueio externo. B1–B5 são
renomeação e cobrem a maior parte do volume. B6 é o único bloco com risco
arquitetural — leia-o inteiro antes de começar e coordene com a sessão FWLog.

---

## 1. As três marcas

A decisão central deste plano é que `Transhipping` no repositório não é um nome
só. São três identidades distintas que hoje compartilham a mesma palavra, e
tratá-las como uma só é o que tornaria a transição perigosa.

| Marca | O que é | Onde aparece | Muda? |
|---|---|---|---|
| **Vela** | O sistema interno, usado pela equipe | App interno, documentação, repositório, projetos da stack | **Novo nome** |
| **FWLog** | A empresa que atende o cliente | Portal do Cliente, comunicação com o cliente | Outra sessão |
| **Transhipping** | A entidade jurídica e financeira | CNPJ, PIX, faturas, recibos | **Permanece** |

O cliente não deve ter visibilidade do nome Vela. Isso é intencional e vira uma
regra de arquitetura, não uma preferência estética.

---

## 2. O que NÃO pode ser tocado

Lista fechada. Qualquer alteração aqui exige autorização explícita do usuário.

**Identidade jurídica e financeira**

- `src/config/company.ts` — razão social, CNPJ `06.352.972/0001-21`, dados
  bancários, `pixMerchantName`, `pixCity`.
- `src/lib/pix.ts` — protegido por `.claude/hooks/protect-files.sh`.
- O nome do beneficiário em `supabase/migrations/002_business_logic_and_security.sql:2858`
  e `supabase/migrations/034_pix_static_payload_normative_fixes.sql:16`. O nome
  do beneficiário no payload PIX é conferido contra o CNPJ pelo arranjo de
  pagamento; alterá-lo quebraria a cobrança. Migrations existentes também são
  protegidas pelo mesmo hook.
- Documentos com logo Transhipping: `src/components/billing/InvoiceDocumentLocal.tsx`,
  `src/components/demurrage/InvoiceDocument.tsx`,
  `src/components/demurrage/CustomerSummaryReport.tsx`,
  `src/components/voyages/AgencyReportDocument.tsx`.

**Superfície do cliente (pertence à sessão FWLog)**

- `src/pages/PortalLogin.tsx`, `PortalForgotPassword.tsx`, `PortalResetPassword.tsx`,
  `PortalConfirmarEmail.tsx`, `src/components/layout/PortalLayout.tsx`,
  `src/components/portal/DisputeModal.tsx`.
- `supabase/functions/_shared/portalEmailTemplates.ts`,
  `supabase/functions/_shared/portalEmailEventProcessor.ts`.
- `src/services/customerCommunicationTemplates.ts` — **atenção:** as linhas 233,
  249 e 440 contêm hoje a string `Transhipping Desk` em texto que vai para o
  cliente. Isso é um vazamento do nome interno que já existe, e a correção é
  trocá-lo por texto FWLog, **não** por `Vela`. É trabalho da sessão FWLog.
- Os testes que travam essas superfícies:
  `src/services/__tests__/portalEmailTemplatesBranding.test.ts`,
  `src/services/__tests__/customerCommunicationTemplatesVisualIdentity.test.ts`.

**Registro histórico**

- `docs/archive/**` — 169 ocorrências em 68 arquivos, preservadas conforme o
  contrato de documentação do `CLAUDE.md`.
- `supabase/migrations_archive/**` — 5 ocorrências.
- `docs/plans/2026-09-06-plano-remediacao-auditorias-654-660.md` — as linhas
  941, 1038, 1097 e 1099 registram comandos **já executados** contra
  `transhipping_test`. Reescrevê-las falsifica o registro de execução.
- `.claude/settings.local.json` — caminhos da máquina do usuário.
- `scripts/migracao-demurrage/dry-run.mjs:1` e `regras.mjs:1` — descrevem a
  migração histórica "Demurrage Manager → Transhipping Desk", que aconteceu com
  esse nome.

**Assets de marca existentes** — ver §4.4. Nenhum arquivo de
`public/branding/` pode ser sobrescrito ou removido.

---

## 3. Inventário

433 ocorrências em 190 arquivos (`grep -ri transhipping`, excluindo
`node_modules`, `.git` e `package-lock.json`).

| Classe | Ocorrências | Tratamento |
|---|---|---|
| Registro histórico (`docs/archive/`, `migrations_archive/`) | 174 | **Não tocar** (§2) |
| Banco de teste `transhipping_test` | 50 | Renomear — bloco B2 |
| Domínio `transhippingdesk.com.br` | 46 | Blocos B6 e B7 |
| Identidade jurídica / PIX | 13 | **Não tocar** (§2) |
| Nome do produto e metadados de projeto | restante | Blocos B1, B3, B4 |

Fora do registro histórico sobram **259 ocorrências em 118 arquivos**. É esse o
universo dos blocos do §6.

---

## 4. Descobertas críticas

Sete achados alteram a ordem ou o conteúdo da execução. Nenhum é bloqueante,
mas ignorar qualquer um produz um incidente.

### 4.1 O Portal e o app interno são a mesma SPA

`src/App.tsx` registra as rotas `/portal/*` e as rotas internas (`/painel`,
`/viagens`, `/manifestos`, …) no mesmo bundle Vite. Hoje
`transhippingdesk.com.br` e `portal.transhippingdesk.com.br` servem **o mesmo
build**; o que separa os dois é o hostname, não o artefato.

Consequência: a separação "Vela em `vela.app.br`" e "FWLog no domínio do
Portal" não é uma mudança de DNS. É uma decisão de arquitetura de entrega.
**Decidida (D1): dois builds separados.** O bloco B6 executa a separação.

Existe ainda a rota `/clientes/portal/inspecao/:customerId/*`, uma visão de
inspeção do Portal **usada internamente**, que reaproveita os componentes
`PortalBilling`, `PortalOperacao` e `PortalProfile`. Ela vive do lado interno
mas renderiza superfície de Portal — e é ela que impede que "dois builds"
signifique "dois conjuntos disjuntos de arquivos". Ver B6.

### 4.2 Pré-lançamento: a janela em que isto é barato

Uma versão anterior deste estudo recomendava **manter** `transhippingdesk.com.br`
registrado como redirecionador, porque o logo e os links de fatura embutidos em
e-mails já entregues não expiram. Essa recomendação **não se aplica**: o sistema
nunca esteve em produção, nenhum e-mail foi entregue a cliente real e não há
link antigo em circulação. A restrição desaparece junto com a premissa.

A consequência inverte a estratégia:

| | Renomear com o sistema no ar | Renomear antes do lançamento |
|---|---|---|
| Domínio | Migrar, com 301 preservando path, por prazo indeterminado | **Nunca apontar o domínio antigo para produção** |
| CORS | Janela de origens duplas, remoção posterior | Uma allowlist, já correta |
| E-mails já enviados | Aliases de logo permanentes | Não existem |
| Tokens em circulação | Esperar 48 h | Não existem |
| Ordem das fases | Rígida, corte de domínio por último | Livre |

Portanto: **lançar direto em `vela.app.br`**. O domínio antigo não precisa de
301 nem de sobrevida; basta nunca chegar a servir produção.

Verificação que fecha a premissa: conferir no Resend se existe qualquer envio a
destinatário real (piloto, homologação com cliente, teste com endereço de
colaborador). Verificado: houve envio, mas só a endereços internos — ver D3
no §5. A premissa se mantém.

### 4.3 O `project_ref` do Supabase é imutável, e o regex do Vercel não é

Renomear o projeto no Supabase altera apenas o rótulo no painel. A URL da API
(`VITE_SUPABASE_URL`) continua com o ref atual. A renomeação é gratuita e sem
risco — mas não é uma migração. O `project_id = "Transhipping_Desk"` em
`supabase/config.toml:6` é metadado local e pode ser atualizado livremente.

O Vercel é o oposto. O regex de preview em `supabase/functions/_shared/cors.ts:18`
(`transhippingdesk(?:-[a-z0-9-]+)?-luccafwlogs-projects\.vercel\.app`) está
acoplado ao **nome do projeto Vercel**. Renomear o projeto sem atualizar esse
regex derruba o CORS de todos os Previews e, com ele, a validação de PRs da
ADR 0056. O sintoma engana: build passa, deploy passa, e o app só falha no
navegador. Este é o único passo do plano que quebra algo de verdade — o fluxo
da equipe, não o cliente.

### 4.4 Os assets de marca são compartilhados pelas três marcas

Nenhum arquivo de `public/branding/` pertence a uma marca só:

| Asset | Usado pelo app interno | Usado pelo Portal | Usado em documento fiscal |
|---|---|---|---|
| `tr-logo.png` | `AppLayout.tsx:130` | `PortalLayout.tsx:30`, templates de e-mail | `CustomerSummaryReport.tsx:28` |
| `transhipping-logo.png` | `Login.tsx:61` | 5 pontos nas telas de Portal | — |
| `transhipping-logo-cropped.png` | `LineUpTVDisplay.tsx:199` | `PortalLogin.tsx:69` | `InvoiceDocumentLocal.tsx:55`, `InvoiceDocument.tsx:84`, `AgencyReportDocument.tsx:595` |

Consequência prática: **substituir um desses arquivos por um logo Vela colocaria
o logo Vela dentro de faturas e do Portal do Cliente** — violando §2 duas vezes
com uma única operação de arquivo.

A regra é: os assets Vela entram como **arquivos novos**
(`public/branding/vela-*.png`), e apenas as chamadas do lado interno são
repontadas. Os arquivos atuais continuam existindo e sendo servidos.

### 4.5 Os cabeçalhos das migrations 001 e 002 são gerados e verificados no CI

As duas ocorrências do nome antigo em `supabase/migrations/001_initial_schema.sql:1`
e `002_business_logic_and_security.sql:1` não são texto escrito à mão. Saem de
`scripts/build-squash-migrations.mjs`, linhas 15 e 73, e o CI roda
`node scripts/build-squash-migrations.mjs --self-check` em
`.github/workflows/ci.yml:40`. Alterar o cabeçalho exige mexer no gerador **e**
nos arquivos de migration, que são protegidos pelo hook.

**Decisão tomada: não alterar.** Esses cabeçalhos datam o nascimento do schema e
valem como registro histórico, pela mesma lógica que preserva `docs/archive/`.
O custo de mudá-los é desproporcional ao ganho. Está registrado aqui para não
ser redescoberto como pendência.

### 4.6 O sistema Vela não envia e-mail

Todo envio do sistema usa `PORTAL_FROM_EMAIL`: `demurrage-dunning/index.ts:515,623`,
`send-customer-communication/index.ts:508` e `_shared/portalEmail.ts:29`. Não
existe remetente interno.

Consequência: **SPF, DKIM, DMARC e aquecimento de domínio são trabalho do Portal,
não de `vela.app.br`.** Uma versão anterior deste plano atribuía essa verificação
ao bloco de stack daqui; era escopo alheio. No Resend, o que sobra para este
plano é renomear o rótulo do projeto, que é cosmético.

### 4.7 O Sentry é o quinto serviço da stack

A versão anterior deste plano listava quatro serviços (Vercel, GitHub, Supabase,
Resend) e esquecia o Sentry, que tem guia próprio em
[`../operations/sentry-configuracao.md`](../operations/sentry-configuracao.md).
O DSN está fixo em `src/lib/telemetry.ts:9` e **não muda** ao renomear o
projeto — o mesmo caso do `project_ref` do Supabase. O que muda é o nome do
projeto no painel e o texto do guia, que hoje instrui a equipe a nomear o
projeto como `transhipping-desk`.

---

## 5. Decisões tomadas

As quatro decisões que bloqueavam a execução foram fechadas pelo usuário em
2026-09-12. Ficam registradas com a consequência de cada uma, para não serem
reabertas por engano.

| ID | Pergunta | Decisão | Efeito no plano |
|---|---|---|---|
| **D1** | Arquitetura de entrega | **Dois builds separados** | Cria o bloco B6 |
| **D2** | Registro de marca no INPI | **Não haverá** — Vela não é produto comercial | Desbloqueia B8 |
| **D3** | Log do Resend | **Irrelevante** — só houve teste interno | Fecha a premissa do §4.2 |
| **D4** | Firebase Hosting | **Apagar tudo** | Fecha o item 4 do B3 |

**D1 — dois builds.** É a opção mais cara em esforço e a mais barata em risco.
O ganho decisivo, dado o §1: com dois artefatos, "nenhuma string `Vela` alcança
o cliente" deixa de depender de disciplina e passa a depender de o código
simplesmente não estar lá. O bloco B5 continua valendo como rede, mas vira
segunda linha em vez de primeira.

**D2 — sem INPI.** O raciocínio se sustenta para uso interno: sem oferta de
produto ou serviço sob a marca, não há a atividade que o registro protege. Dois
resíduos, registrados aqui e não tratados como pendência: `vela.app.br` é DNS
público, e o nome aparece na aba do navegador de quem vê uma tela. A exposição
não é zero, mas é remota. **O gatilho para reavaliar é a comercialização** — se
o Vela um dia for vendido ou licenciado a terceiros, a busca volta à mesa, e aí
com o custo de uma renomeação com usuários dentro.

**D3 — envios de teste não contam.** Houve envio, mas apenas a endereços
internos. Os e-mails carregam link para o domínio antigo e não expiram; como
nenhum destinatário é cliente, não há consequência. A recomendação de manter
`transhippingdesk.com.br` como redirecionador 301 permanece **retratada**
(§4.2).

**D4 — remover o Firebase.** O ID de projeto Firebase `transhipping-desk` é
imutável no Google, então "renomear" nunca foi opção. Como o cutover para o
Vercel está concluído e `supabase/functions/_shared/cors.ts:7` já marca as
origens como resquício, os arquivos saem.

## 6. Execução (repositório — Codex)

Formato de cada bloco: **Depende de · Arquivos · Ação · Gate**. Só passe ao
bloco seguinte com o gate verde.

### B1 — Nome do produto no app interno

**Depende de:** nada.

**Arquivos e ação:**

| Arquivo | Linha | Ação |
|---|---|---|
| `index.html` | 12 | `<title>Transhipping Desk</title>` → `<title>Vela</title>` |
| `public/site.webmanifest` | 2–3 | `"name": "Vela"`, `"short_name": "Vela"` (hoje `"Desk"`) |
| `src/lib/pageTitle.ts` | 7 | `const BASE = 'Vela'` |
| `src/lib/__tests__/pageTitle.test.ts` | 7–33 | 17 expectativas com o sufixo `· Transhipping Desk` |
| `src/pages/__tests__/rotasDesconhecidas.test.tsx` | 45, 47 | idem |
| `src/components/layout/AppLayout.tsx` | 132 | eyebrow `Desk operacional` → texto Vela |
| `src/hooks/useVisualTheme.ts` | 5 | `storageKey` → `'vela_visual_theme'` |

Sobre o `storageKey`: sem usuários não há preferência de tema a preservar.
Renomeie sem cuidado de migração. (A análise anterior recomendava manter a
chave; a razão era proteger preferências existentes, que não existem.)

**Não faz parte deste bloco:** trocar os `src` e os `alt` dos logos em
`AppLayout.tsx:130`, `Login.tsx:61` e `LineUpTVDisplay.tsx:199`. Enquanto a
imagem for o logo Transhipping, o `alt` "Transhipping" está correto. Os dois
mudam juntos, no bloco B7, quando os assets Vela existirem (§4.4).

**Gate:** `npm run lint && npm run test && npm run build`.

### B2 — Banco de teste `transhipping_test` → `vela_test`

**Depende de:** nada. Isolado, sem efeito externo.

**Arquivos** (50 ocorrências; a lista da versão anterior deste plano esquecia
`scripts/`, o que teria quebrado o setup local e o catálogo de RPC):

- `.github/workflows/ci.yml` — 126, 150, 174, 183, 188
- `scripts/setup-local-pg.sh` — 7, 19 (`DB=`), 37 (também o diretório
  `transhipping-local-pg16` → `vela-local-pg16`)
- `scripts/check-rpc-catalog.mjs` — 7 (default do `DATABASE_URL`)
- `scripts/perf/measure-operational-read-model.mjs` — 7, 16
- `scripts/perf/README.md` — 35
- `scripts/README.md` — 122
- `WORKFLOW.md` — 238
- `src/integration/*.local-pg.test.ts` — 17 arquivos, uma ocorrência cada
- `src/services/__tests__/*Migration.test.ts` — 8 arquivos, uma ocorrência cada

**Não incluir:** `docs/plans/2026-09-06-plano-remediacao-auditorias-654-660.md`
(§2 — registro de comandos já executados) nem `docs/archive/`.

**Gate:** `npm run lint && npm run test`, mais os gates de banco do
[`../../WORKFLOW.md`](../../WORKFLOW.md) §11. Confirme que
`scripts/setup-local-pg.sh` cria o banco novo e que `check-rpc-catalog.mjs`
o encontra sem variável de ambiente explícita.

### B3 — Metadados de projeto

**Depende de:** nada.

1. `package.json:2` — `"name": "transhipping-desk"` → `"vela"`.
2. `supabase/config.toml:6` — `project_id = "Transhipping_Desk"` → `"Vela"`
   (metadado local, §4.3).
3. `opencode.json` — 5 descrições de skill: linhas 38, 90, 102, 146, 178.
4. **Remover o Firebase (D4):** apagar `.firebaserc` e `firebase.json`, e
   retirar as origens `https://transhippingdesk.web.app` e
   `https://transhippingdesk.firebaseapp.com` de
   `supabase/functions/_shared/cors.ts:7–9`, junto com o comentário que as
   justificava, no mesmo commit. Conferir se `src/services/__tests__/edgeFunctionCors.test.ts`
   depende delas.
5. `skills/README.md` — 15, 94; e a linha `description:` de
   `skills/design-audit/SKILL.md`, `skills/import-parser/SKILL.md`,
   `skills/invoice-pdf/SKILL.md`, `skills/react-query-pattern/SKILL.md`,
   `skills/supabase-migration/SKILL.md`.
6. `scripts/design-audit/win/local-stack.ps1:3`, `scripts/README.md:233`,
   `artifacts/design-viagens/kit.mjs:1`, `supabase/scripts/reset_operational_data.sql:7`
   — comentários. Cosméticos, mas baratos.

**Não incluir:** `scripts/README.md:14–15` (caminhos da máquina do usuário) nem
`scripts/build-squash-migrations.mjs` (§4.5).

**Gate:** `npm run lint && npm run build && npm run docs:check`.

### B4 — Documentação viva e ADR de decisão

**Depende de:** nada.

21 arquivos fora de `docs/archive/`, mais três na raiz. Nas ADRs, corrigir onde
o texto descreve o sistema **no presente** e preservar onde narra contexto
histórico — uma ADR de 2026-08 que diz "o Transhipping Desk está em produção"
descreve o passado e fica; uma frase que descreve a arquitetura atual muda.

- Raiz: `README.md` (1, 3), `CONTEXT.md` (3), `WORKFLOW.md` (1, 3)
- `docs/README.md`, `docs/ARCHITECTURE.md` (1, 113–114), `docs/ROADMAP.md`
- `docs/adr/`: 0003, 0010, 0012, 0014, 0047, 0056, 0062
- `docs/agents/issue-tracker.md` (9), `docs/design-audit/README.md` (1)
- `docs/modules/manifesto-edi.md` (7)
- `docs/operations/seguranca.md` (29), `docs/operations/validacao.md` (1)
- `docs/operations/sentry-configuracao.md` (1, 3, 26, 30, 50) — inclusive a
  instrução de nomear o projeto Sentry (§4.7)
- `docs/setup/deploy.md` (74–75, 167, 171, 182, 193–198, 250),
  `docs/setup/development.md` (3)
- `docs/spec/README.md` (34), `docs/plans/README.md` (13)

Menções a `luccafwlog/transhippingdesk` em URLs de PR e de run do GitHub são
**links históricos** e continuam funcionando pelo redirecionamento do GitHub:
não reescreva.

`docs/RASTREABILIDADE.md` não cita o nome e não precisa de alteração.

**Criar:** uma ADR nova registrando a separação das três marcas e a renomeação,
e acrescentar a linha correspondente em `docs/adr/README.md` — o `docs:check`
verifica cobertura do índice.

**Gate:** `npm run docs:check && git diff --check`.

### B5 — Teste de fronteira entre as marcas

**Depende de:** B1.

Criar um teste que falhe se a string `Vela` (case-insensitive) aparecer em:

- `supabase/functions/_shared/portalEmailTemplates.ts`
- `src/services/customerCommunicationTemplates.ts`
- `src/components/layout/PortalLayout.tsx` e as páginas `src/pages/Portal*.tsx`
- `src/components/billing/InvoiceDocumentLocal.tsx`,
  `src/components/demurrage/InvoiceDocument.tsx`,
  `src/components/demurrage/CustomerSummaryReport.tsx`,
  `src/components/voyages/AgencyReportDocument.tsx`

E que falhe se `pixMerchantName` em `src/config/company.ts` deixar de ser
`TRANSHIPPING AGENCIAMENTO MARITIMO`.

Este é o bloco que transforma a regra do §1 em invariante executável, em vez de
combinado entre sessões. Vale mais que qualquer revisão manual.

**Gate:** `npm run test`.

### B6 — Separação em dois builds

**Depende de:** B1–B5. **Combine com a sessão FWLog antes de começar** — este é
o bloco que redesenha o terreno dos dois lados.

**Estado atual.** Uma entrada (`src/main.tsx`), um HTML (`index.html`), um
roteador (`src/App.tsx`), um artefato. O `main.tsx` envolve tudo com
`PortalAuthProvider` **e** `AuthProvider` ao mesmo tempo (linhas 48–50), e
`vercel.json` tem um único rewrite para `/index.html`.

**O que "dois programas" significa aqui.** Duas entradas Vite e dois projetos
Vercel **sobre a mesma base de código**. Não são dois repositórios nem duas
cópias: serviços, tipos, cliente Supabase, hooks e componentes de UI continuam
compartilhados. Separam-se quatro coisas — o HTML de entrada, o ponto de
montagem React, o roteador e o provedor de autenticação — e, no fim, o artefato
publicado.

**Passos:**

1. **Dois HTML.** `index.html` (interno) e `portal.html`, cada um com seu
   `<title>`, seu manifest e seu conjunto de favicons.
2. **Duas entradas.** `src/main.tsx` (interno) e `src/portal-main.tsx`. A
   interna envolve apenas `AuthProvider`; a do Portal, apenas
   `PortalAuthProvider`. Hoje as duas árvores convivem sem necessidade.
3. **Dois roteadores.** `src/App.tsx` se divide em `src/AppInterno.tsx` (rotas
   internas, incluindo `/clientes/portal/inspecao/*`) e `src/AppPortal.tsx` (as
   nove rotas `/portal/*` públicas e autenticadas).
4. **`vite.config.ts`** — declarar as duas entradas em
   `build.rollupOptions.input`.
5. **Dois projetos Vercel**, cada um com seu domínio, seu rewrite e seu
   diretório de saída.

**A armadilha deste bloco.** A rota interna
`/clientes/portal/inspecao/:customerId/*` (`src/App.tsx:162–166`) renderiza
`PortalBilling`, `PortalOperacao` e `PortalProfile`. Essas três páginas ficam
**nos dois builds**. Dois artefatos não são dois conjuntos disjuntos de
arquivos.

Verificado: `PortalBilling.tsx`, `PortalOperacao.tsx`, `PortalProfile.tsx`,
`PortalDashboard.tsx` e `PortalInspection.tsx` hoje **não contêm nenhuma
referência de marca** — sem logo, sem nome, sem cor de marca. Toda a marca do
Portal vive em `PortalLayout.tsx:30` e `PortalLogin.tsx:69`. É isso que faz o
compartilhamento funcionar, e é uma propriedade a preservar, não um acaso:

> **Regra:** as páginas compartilhadas permanecem neutras de marca. A marca
> entra pelo layout que as embrulha. Um logo FWLog dentro de `PortalBilling`
> aparece dentro do sistema interno.

**Efeitos colaterais a tratar no mesmo bloco:**

- `package.json`, bloco `size-limit`: os globs apontam para
  `dist/assets/index-*.js`. Com duas entradas os nomes mudam e o job
  "Build + Bundle size" quebra. Ajustar os padrões e reavaliar o limite de
  250 kB — o build interno deve **encolher**, então o limite antigo deixa de
  medir o que media.
- `scripts/vercel-build.mjs` grava a página de espera apenas em
  `dist/index.html`. Precisa gravar também em `dist/portal.html`, ou o Preview
  do Portal serve 404 durante a janela da ADR 0056.
- `src/lib/pageTitle.ts` mistura rotas internas e `/portal/*` na mesma tabela.
  Separar, junto com os testes correspondentes.
- Dois projetos Vercel produzem **dois padrões de URL de Preview**. O regex do
  bloco B7 precisa cobrir os dois, ou o CORS derruba os Previews do Portal.

**Gate:** `npm run lint && npm run test && npm run build && npm run size-limit`.
E duas verificações manuais que nenhum teste faz sozinho: o bundle interno
**não pode** conter as rotas `/portal/login`, `/portal/ativar`,
`/portal/recuperar-senha`; o bundle do Portal não pode conter `/painel` nem
`/admin`.

**Por que este bloco fica aqui e não na sessão FWLog.** Feita a separação, a
sessão FWLog passa a mexer apenas em `portal.html`, `src/portal-main.tsx`,
`src/AppPortal.tsx` e nas páginas do Portal. O conflito em `src/App.tsx` — hoje
o arquivo mais disputado entre as duas sessões — deixa de existir. Separar
primeiro reduz o atrito em vez de aumentá-lo.

### B7 — Domínio e CORS

**Depende de B6.** Com dois builds há dois projetos Vercel, e este bloco
precisa saber o nome dos dois.

1. `supabase/functions/_shared/cors.ts:5–6` — trocar as origens para
   `vela.app.br` diretamente, sem manter as antigas (§4.2). As origens Firebase
   das linhas 7–9 já saíram no B3.
2. `supabase/functions/_shared/cors.ts:18` — `VERCEL_PREVIEW_ORIGIN` precisa
   agora cobrir **dois** padrões de URL de Preview, um por projeto Vercel
   (§4.3, B6). Atualizar **no mesmo commit** em que os projetos forem
   renomeados no painel. Um regex que cubra só o interno derruba silenciosamente
   os Previews do Portal.
3. `src/services/__tests__/edgeFunctionCors.test.ts:10, 50, 57` — acompanhar.
4. `.env.example:7–8` — `VITE_PORTAL_URL` e `VITE_PORTAL_BILLING_URL`.
   **Arquivo disputado com a sessão FWLog:** combine quem edita antes.
5. `src/lib/__tests__/telemetry.test.ts:108–151` — 11 URLs de exemplo.
6. `scripts/perf/README.md:11` — `PERF_BASE_URL`.

**Fora deste bloco, apesar de conterem o domínio antigo:** os defaults de
`supabase/functions/**` (`demurrage-dunning:104`, `send-customer-communication:119`,
`portal-daily-digest:34`, `portal-invite-send:36`, `portal-invite-activate:31`,
`portal-password-recovery:60`, `portal-recovery-email-change:61`,
`_shared/portalEmailEventProcessor.ts:54–55`). Todos apontam para o **Portal**,
não para o app interno. São da sessão FWLog (§4.6).

**Gate:** `npm run lint && npm run test && npm run build`. E, depois do deploy,
abrir um Preview de PR e confirmar no navegador que uma chamada a Edge Function
recebe `Access-Control-Allow-Origin` — o teste unitário não prova isso.

### B8 — Identidade visual Vela

**Depende de:** B6 (os favicons e o manifest passam a ser dois conjuntos, um
por build). Sem bloqueio de INPI — ver D2 no §5.

**Entregáveis:** logo horizontal (claro e escuro), símbolo isolado,
`favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png` (180×180), `android-chrome-192x192.png`,
`android-chrome-512x512.png`. Os cinco últimos já existem em `public/` e são
substituídos **pelo conjunto Vela**; os arquivos de `public/branding/` **não
são** (§4.4). Depois do B6, `portal.html` referencia o conjunto FWLog, servido
do mesmo `public/` sob nomes próprios — combine a convenção de nomes com a
sessão FWLog para os dois não colidirem.

**Repontar apenas o lado interno**, para os arquivos novos
`public/branding/vela-*.png`, trocando `src` e `alt` juntos:

- `src/components/layout/AppLayout.tsx:130`
- `src/pages/Login.tsx:61`
- `src/pages/LineUpTVDisplay.tsx:199`

**Restrições herdadas de `src/index.css`, que não mudam** — a identidade Vela é
construída dentro delas:

| Token | Valor |
|---|---|
| `--app-navy` | `#152238` |
| `--app-navy-2` | `#1e3050` |
| `--app-topbar` | `#0e1825` |
| `--app-blue` | `#2563a8` |
| `--app-gold` | `#d4882e` |
| `theme_color` (manifest) | `#1a2744` |
| Display | Syne |
| Corpo | DM Sans |

Os três sentidos de "vela" — a vela náutica, a constelação de Vela e a chama —
convergem numa mesma forma: um triângulo apoiado numa vertical. Vela náutica e
chama compartilham a silhueta; a constelação entra como pontuação. Recomendo
explorar a convergência em vez de escolher um dos três sentidos: o navy
`#152238` sobre o dourado `#d4882e` já sugere céu noturno e chama sem esforço
adicional.

**Gate:** `npm run build`, mais inspeção visual do header interno, da tela de
login e da tela de TV. E o gate do B5, que prova que nada disso vazou para o
Portal ou para as faturas.

---

## 7. Execução (painéis — usuário)

Nada aqui é verificável pelo repositório. Cada item precisa de confirmação
manual de quem tem acesso ao painel.

### 7.1 Vercel

Com a decisão D1, passam a existir **dois projetos**: o interno (Vela) e o do
Portal (FWLog). O segundo é criado em coordenação com a sessão FWLog.

1. Renomear o projeto atual para o nome interno e criar o segundo projeto,
   apontando ambos para o mesmo repositório com comandos de build distintos.
2. **Coordenar com o item 2 do bloco B7** — o regex de preview precisa cobrir
   os dois nomes e ir no mesmo commit da renomeação (§4.3).
3. Adicionar `vela.app.br` ao projeto interno e obter o alvo real de DNS com
   `vercel domains inspect`. Não presuma o valor.
4. Conferir as variáveis de ambiente de cada projeto (`VITE_PORTAL_URL`,
   `VITE_PORTAL_BILLING_URL`) — o `.env.example` é documentação, não
   configuração real.
5. Confirmar que a integração de branching do Supabase (ADR 0056) grava as
   variáveis de Preview nos **dois** projetos. Se ela cobrir só um, o Preview do
   outro cai na página de espera de `scripts/vercel-build.mjs` — que o B6
   precisa ter ensinado a gravar `portal.html`.

### 7.2 registro.br

1. Concluir o pagamento de `vela.app.br`. A exigência de HSTS preload que pesa
   sobre o TLD genérico `.app` **não** se aplica à categoria `app.br` do
   registro.br; não há restrição a planejar.
2. Publicar o registro que o Vercel indicar e aguardar a emissão do
   certificado.
3. Saber de antemão: `vercel.json` já envia
   `Strict-Transport-Security: max-age=31536000; includeSubDomains`. No dia em
   que `vela.app.br` servir esse header, **todo subdomínio de `vela.app.br` fica
   preso a HTTPS por um ano**. Não é problema; é irreversível dentro do prazo.
4. `transhippingdesk.com.br` nunca chega a servir produção (§4.2).

### 7.3 GitHub

Renomear o repositório e revalidar a integração de branching do Supabase, que
referencia `luccafwlog/transhippingdesk` (ADR 0056). O GitHub mantém
redirecionamento do nome antigo, então links históricos na documentação
continuam funcionando.

### 7.4 Supabase

Renomear o projeto no painel. Cosmético — o `project_ref` e portanto o
`VITE_SUPABASE_URL` não mudam (§4.3). Conferir que a integração de branching
continua conectada depois do item 7.3.

### 7.5 Sentry

Renomear o projeto no painel, conforme
[`../operations/sentry-configuracao.md`](../operations/sentry-configuracao.md).
O DSN em `src/lib/telemetry.ts:9` **não muda** (§4.7).

### 7.6 Resend

Renomear o rótulo do projeto. **Só isso** — SPF, DKIM, DMARC e aquecimento de
domínio pertencem ao Portal, não a `vela.app.br` (§4.6). D3 já está fechada: os
envios existentes foram testes internos.

---

## 8. Riscos

O risco dominante deixou de ser técnico. Não há produção para quebrar; há um
prazo, e uma janela que fecha no lançamento.

| Risco | Gravidade | Mitigação |
|---|---|---|
| **Lançar com a separação Vela/FWLog por fazer** | **Alta** | Bloco B6 antes do lançamento; depois, o custo multiplica |
| **Marca de terceiro sobre "Vela" caso o sistema vire produto** | Baixa hoje | D2 — reavaliar se houver comercialização; hoje não há oferta sob a marca |
| **B6 quebrar o gate de bundle ou o Preview do Portal** | **Alta** | Ajustar `size-limit` e `scripts/vercel-build.mjs` dentro do próprio B6 |
| **Marca entrar numa página compartilhada e vazar entre os dois builds** | **Alta** | Regra do B6: páginas compartilhadas neutras, marca só no layout |
| **Regex de preview cobrir só um dos dois projetos Vercel** | Média | B7 item 2 — dois padrões, um por projeto |
| **Substituição global levar `Vela` a e-mail de cliente ou fatura** | **Alta** | §0.1 regra 1; bloco B5 como rede |
| **Sobrescrever asset de `public/branding/` e vazar logo Vela para fatura e Portal** | **Alta** | §4.4 — arquivos novos, nunca substituição |
| Regex de preview do Vercel desatualizado derruba os Previews | Média | B6 item 2 e §7.1 item 1 no mesmo commit; afeta a equipe, não o cliente |
| Renomear o banco de teste pela metade e quebrar o CI | Média | Lista completa em B2, inclusive `scripts/` |
| Lançar meio renomeado, com os dois nomes convivendo | Média | Blocos sequenciais com gate, não faseamento com convivência |
| Conflito de merge com a sessão FWLog em `cors.ts`, `App.tsx`, `.env.example` | Média | Combinar a ordem; depois do B6 o conflito em `App.tsx` deixa de existir |

Riscos que as versões anteriores listavam e que **deixam de existir**: quebra
de e-mails históricos, perda de preferência de tema, conflito de convivência
entre domínios, e a premissa de "nenhum e-mail enviado" (D3 dispensou).

---

## 9. Definição de pronto

1. **B1–B5** concluídos, cada um com seu gate verde.
2. `grep -ri "transhipping" .` fora de `docs/archive/`,
   `supabase/migrations_archive/`, `package-lock.json` e da lista do §2 retorna
   **zero** ocorrências do nome do produto — as remanescentes devem ser todas
   identidade jurídica, superfície do Portal ou registro histórico.
3. **B5 verde:** nenhuma string `Vela` alcança o Portal, os templates de e-mail
   ou os documentos fiscais.
4. **B6 concluído:** dois artefatos, e a prova manual de que o bundle interno
   não contém as rotas públicas do Portal e vice-versa. `npm run size-limit`
   verde com os globs novos.
5. **B7 concluído:** allowlist de CORS só com os domínios novos, regex de
   preview cobrindo os dois projetos Vercel, e um Preview real testado no
   navegador — o teste unitário não prova CORS.
6. **§7 concluído** e confirmado item a item por quem tem acesso aos painéis.
7. **B8 concluído:** identidade Vela no app interno, sem tocar em
   `public/branding/`.
8. Antes do lançamento, três verificações manuais: login interno, um envio de
   e-mail e **uma fatura com QR PIX cujo beneficiário leia
   `TRANSHIPPING AGENCIAMENTO MARITIMO`**. Sem produção no ar, esta última vale
   mais do que qualquer cuidado de cutover: é a única prova de que a separação
   das três marcas sobreviveu à renomeação.
