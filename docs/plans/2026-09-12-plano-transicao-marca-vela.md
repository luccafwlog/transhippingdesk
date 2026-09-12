# 2026-09-12 — Transição de marca: Transhipping Desk → Vela

- **Status:** estudo aprovado para planejamento; execução ainda **não iniciada**.
- **Escopo:** renomear o **sistema interno** para **Vela** e migrar o domínio
  para `vela.app.br`.
- **Fora de escopo (tratado em outra sessão):** a migração do Portal do Cliente
  para `portal.fwlog.com.br` e a identidade visual FWLog.

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
regra de arquitetura, não apenas uma preferência estética: nenhuma string
`Vela` pode alcançar rotas `/portal/*`, templates de e-mail ao cliente ou
documentos fiscais.

## 2. O que NÃO muda

Confirmado pelo usuário: a Transhipping continua responsável por receber os
pagamentos. Portanto, permanecem intocados:

- `src/config/company.ts` — razão social, CNPJ `06.352.972/0001-21`, dados
  bancários, `pixMerchantName`, `pixCity`.
- `src/lib/pix.ts` e o nome do beneficiário embutido em
  `supabase/migrations/002_business_logic_and_security.sql:2858` e
  `supabase/migrations/034_pix_static_payload_normative_fixes.sql:16`.
  O nome do beneficiário no payload PIX é conferido contra o CNPJ pelo arranjo
  de pagamento; alterá-lo quebraria a cobrança.
- Documentos com logo Transhipping: `src/components/billing/InvoiceDocumentLocal.tsx`,
  `src/components/demurrage/InvoiceDocument.tsx`,
  `src/components/demurrage/CustomerSummaryReport.tsx`,
  `src/components/voyages/AgencyReportDocument.tsx`.
- Os arquivos `public/branding/transhipping-logo*.png` e `tr-logo.png`
  continuam existindo e sendo servidos.
- `docs/archive/**` — registro histórico, preservado conforme o contrato de
  documentação do `CLAUDE.md`. São 69 dos 90 arquivos de documentação que
  citam o nome antigo.

## 3. Inventário

191 arquivos, 420 ocorrências (`grep -ri transhipping`, excluindo
`node_modules`). Distribuição por natureza da mudança:

| Classe | Ocorrências | Tratamento |
|---|---|---|
| Nome do produto "Transhipping Desk" | 158 | Renomear para Vela |
| Domínio `transhippingdesk.com.br` | 42 | Migrar para `vela.app.br` (fase 4) |
| Banco de teste `transhipping_test` | 48 | Renomear (isolado, sem risco externo) |
| Identidade jurídica / PIX | 23 | **Não tocar** |
| Documentação arquivada | ~69 arquivos | **Não tocar** |

## 4. Descobertas críticas

Três achados alteram a ordem de execução. Nenhum é bloqueante, mas ignorar
qualquer um deles produz um incidente.

### 4.1 O Portal e o app interno são a mesma SPA

`src/App.tsx` registra as rotas `/portal/*` e as rotas internas (`/painel`,
`/viagens`, `/manifestos`, …) no mesmo bundle Vite. Hoje
`transhippingdesk.com.br` e `portal.transhippingdesk.com.br` servem **o mesmo
build**; o que separa os dois é o hostname, não o artefato.

Consequência: a separação "Vela em `vela.app.br`" e "FWLog em
`portal.fwlog.com.br`" não é uma mudança de DNS. É uma decisão de arquitetura
de entrega — ou dois domínios continuam servindo o mesmo app com branding
resolvido por hostname, ou o build é dividido em dois. Essa decisão pertence à
sessão do Portal FWLog, mas **precede** o corte de domínio deste plano, porque
ambos editam `supabase/functions/_shared/cors.ts` e `src/App.tsx`.

### 4.2 Desligar `transhippingdesk.com.br` quebra e-mails já entregues

Esta é a recomendação em que discordo do que foi dito ("o domínio deixará de
existir"). O domínio deve ser **mantido registrado como redirecionador**, não
extinto. O que depende dele hoje, já fora do nosso controle, na caixa de
entrada dos clientes:

| Dependência | Prazo até parar de importar |
|---|---|
| Logo `…/branding/tr-logo.png` embutido em **todo** e-mail já enviado | Nunca expira |
| Link de fatura `…/portal/billing` (`demurrage-dunning/index.ts:104`, `send-customer-communication/index.ts:119`) | **Sem token, sem expiração** |
| Convite de ativação do Portal (`portal-invite-send/index.ts:32`) | 48 horas |
| Recuperação de senha (`portal-password-recovery/index.ts:55`) | 1 hora |

Os tokens se resolvem em 48 horas. O logo e o link de faturas, não: são
permanentes. Manter o domínio registrado apontando um 301 custa a anuidade do
registro.br e evita que todo o histórico de comunicação com o cliente exiba
imagem quebrada e link morto. Recomendo manter por prazo indeterminado, e no
mínimo 12 meses.

### 4.3 O `project_ref` do Supabase é imutável

Renomear o projeto no Supabase altera apenas o rótulo no painel. A URL da API
(`VITE_SUPABASE_URL`) continua com o ref atual. Isso é uma boa notícia: a
renomeação é gratuita e sem risco, mas também não deve ser confundida com uma
migração. O `project_id = "Transhipping_Desk"` em `supabase/config.toml:6` é
metadado local e pode ser atualizado livremente.

Atenção correlata: o regex de preview em `cors.ts:18`
(`transhippingdesk(?:-[a-z0-9-]+)?-luccafwlogs-projects\.vercel\.app`) está
acoplado ao **nome do projeto Vercel**. Renomear o projeto Vercel sem atualizar
esse regex derruba o CORS de todos os Previews e, com ele, a validação de PRs
descrita na ADR 0056.

## 5. Fases

A ordem é deliberada: tudo que não depende de DNS primeiro, o corte de domínio
por último, depois que a decisão do Portal FWLog estiver tomada.

### Fase 0 — Pré-requisitos (fora do código)

1. Concluir a aquisição de `vela.app.br`. Confirmar no registro.br que a
   categoria `app.br` aceita o registro pretendido e verificar exigência de
   HTTPS/HSTS antes de apontar produção.
2. Decidir a arquitetura de entrega de 4.1 (um build por hostname, ou dois
   builds). Sem isso, a Fase 4 não pode começar.
3. Confirmar a marca nominativa "Vela" — é palavra comum em português;
   vale uma busca no INPI antes de investir na identidade visual.

### Fase 1 — Identidade visual Vela

Entregáveis, todos derivados da paleta atual, que **não muda**:

- Logo horizontal (app header, ~32px de altura útil), em claro e escuro.
- Símbolo isolado para ícone.
- `favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`.
- `apple-touch-icon.png` (180×180), `android-chrome-192x192.png`,
  `android-chrome-512x512.png`.

Restrições herdadas de `src/index.css` — a identidade Vela é construída
*dentro* delas, não contra elas:

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
chama compartilham a silhueta; a constelação entra como pontuação (as estrelas
podem virar os pontos de um símbolo geométrico). Recomendo explorar essa
convergência em vez de escolher um dos três sentidos, porque o navy `#152238`
sobre o dourado `#d4882e` já sugere céu noturno e chama sem nenhum esforço
adicional.

### Fase 2 — Renomeação interna (sem efeito externo)

Arquivos e mudanças, todos de baixo risco e verificáveis por teste:

- `index.html:12` — `<title>`.
- `src/lib/pageTitle.ts:8` — `const BASE`. Há teste em
  `src/lib/__tests__/pageTitle.test.ts` que precisa acompanhar.
- `public/site.webmanifest` — `name`, `short_name`.
- `src/components/layout/AppLayout.tsx:130` — logo e `alt` do header interno.
- `src/pages/Login.tsx:61` — logo da tela de login interna.
- `src/pages/LineUpTVDisplay.tsx:199` — logo da tela de TV (uso interno).
- `src/hooks/useVisualTheme.ts:5` — `storageKey`. **Atenção:** mudar a chave
  descarta a preferência de tema de todos os usuários. Ou manter a chave
  antiga, ou migrar o valor na leitura. Recomendo manter — é invisível e
  renomeá-la só gera perda.
- `package.json` `name`, `opencode.json` (5 descrições de skill),
  `skills/**`, `.firebaserc`, `firebase.json`.

**Não** alterar nesta fase: `PortalLayout.tsx`, `PortalLogin.tsx`,
`PortalForgotPassword.tsx`, `PortalResetPassword.tsx`,
`PortalConfirmarEmail.tsx` — são superfície do cliente e pertencem à sessão
FWLog.

### Fase 3 — Documentação viva

21 arquivos em `docs/` fora de `docs/archive/`, mais `CONTEXT.md`,
`README.md` e `WORKFLOW.md` na raiz. Os principais: `docs/ARCHITECTURE.md`,
`docs/README.md`, `docs/ROADMAP.md`, `docs/setup/deploy.md`,
`docs/setup/development.md`, `docs/operations/*` e as ADRs 0003, 0010, 0012,
0014, 0047, 0056, 0062.

`docs/RASTREABILIDADE.md` não cita o nome e não precisa de alteração.

Nas ADRs, o nome antigo é **registro de uma decisão datada**. A regra: corrigir
onde o texto descreve o sistema no presente; preservar onde narra o contexto
histórico. Uma ADR nova deve registrar a própria renomeação.

### Fase 4 — Corte de domínio e stack

Somente após a Fase 0.2. Ordem obrigatória, porque `cors.ts` precisa aceitar a
origem nova **antes** de qualquer tráfego chegar por ela:

1. Adicionar `https://vela.app.br` ao `FIXED_ALLOWED_ORIGINS` em
   `supabase/functions/_shared/cors.ts`, mantendo as origens antigas. Publicar
   as Edge Functions.
2. Renomear o projeto Vercel e **atualizar `VERCEL_PREVIEW_ORIGIN`** no mesmo
   commit (ver 4.3). Sem isso, todos os Previews quebram.
3. Apontar `vela.app.br` para o projeto Vercel; validar em produção.
4. Configurar 301 de `transhippingdesk.com.br` → `vela.app.br`, **preservando o
   path** (para os links `/portal/billing` históricos continuarem chegando ao
   destino correto até o Portal migrar para FWLog).
5. Renomear o repositório GitHub. O GitHub mantém redirect de git, mas a
   integração de branching do Supabase (ADR 0056) referencia
   `luccafwlog/transhippingdesk` explicitamente — revalidar.
6. Renomear o projeto no Supabase e no Resend. No Resend, verificar o domínio
   novo (SPF/DKIM) **antes** de trocar o remetente; domínio não verificado
   derruba entregabilidade.
7. Só depois de tudo verde: remover as origens antigas de `cors.ts`. Manter as
   entradas `*.web.app`/`*.firebaseapp.com`, já marcadas como rollback.
8. `transhipping_test` → `vela_test` em `.github/workflows/ci.yml` e nos 48
   pontos de `src/integration/**` e `src/services/__tests__/**`.
   Puramente local, pode ir em PR separado a qualquer momento.

## 6. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Domínio antigo extinto quebra e-mails históricos | Alta | Manter registrado com 301 preservando path (4.2) |
| Regex de preview do Vercel desatualizado derruba CORS dos Previews | Alta | Renomear projeto e regex no mesmo commit |
| Nome Vela vazar para o Portal do Cliente | Média | Teste automatizado que falha se `Vela` aparecer em rotas `/portal/*` ou templates de e-mail |
| Conflito com a sessão do Portal FWLog | Média | `cors.ts`, `App.tsx` e templates são de propriedade da sessão FWLog; este plano não os edita fora da Fase 4.1 |
| Renomear `storageKey` descarta preferência de tema | Baixa | Manter a chave atual |
| PR único com 420 alterações fica irrevisável | Média | Uma PR por fase; Fases 2 e 3 podem ser paralelas |

## 7. Validação

- Fases 2 e 4.8: `npm run lint`, `npm run test`, `npm run build`, mais os gates
  de banco do `WORKFLOW.md` §11 para a renomeação do banco de teste.
- Fase 3: `npm run docs:check` e `git diff --check`.
- Fase 4: verificação manual em produção de login interno, um envio de e-mail
  ao cliente e uma fatura com QR PIX — o QR deve continuar exibindo
  `TRANSHIPPING AGENCIAMENTO MARITIMO` como beneficiário.
- Teste novo sugerido: asserção de que nenhuma string `Vela` alcança
  `portalEmailTemplates.ts`, `customerCommunicationTemplates.ts` ou os
  componentes de documento fiscal.
