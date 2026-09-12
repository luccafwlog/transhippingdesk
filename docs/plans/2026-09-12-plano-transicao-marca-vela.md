# 2026-09-12 — Transição de marca: Transhipping Desk → Vela

- **Status:** estudo aprovado para planejamento; execução ainda **não iniciada**.
- **Escopo:** renomear o **sistema interno** para **Vela** e lançar em
  `vela.app.br`.
- **Contexto decisivo:** o sistema **ainda não está em produção**. Nem os
  usuários internos nem o Portal do Cliente estão ativos; o lançamento é
  previsto para algumas semanas. Isto muda a estratégia de execução mais do que
  qualquer detalhe técnico deste documento — ver §4.2.
- **Acoplado, não adiável:** a migração do Portal para `portalfwlog.com.br` e a
  identidade FWLog são de outra sessão, mas têm o **mesmo prazo** (§5.0).
- **Domínios reservados** (pagamento pendente): `vela.app.br` para o sistema
  interno, `portalfwlog.com.br` para o Portal do Cliente. Ver §5.6 sobre a
  escolha de domínio próprio em vez de subdomínio.

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
`portalfwlog.com.br`" não é uma mudança de DNS. É uma decisão de arquitetura
de entrega — ou dois domínios continuam servindo o mesmo app com branding
resolvido por hostname, ou o build é dividido em dois. Essa decisão pertence à
sessão do Portal FWLog, mas **precede** o corte de domínio deste plano, porque
ambos editam `supabase/functions/_shared/cors.ts` e `src/App.tsx`.

### 4.2 Pré-lançamento: a janela em que isto é barato

Uma versão anterior deste estudo recomendava **manter** `transhippingdesk.com.br`
registrado como redirecionador, porque o logo e os links de fatura embutidos em
e-mails já entregues não expiram. Essa recomendação **não se aplica**: o sistema
nunca esteve em produção, nenhum e-mail foi entregue a cliente real e não há
link antigo em circulação. A restrição desaparece junto com a premissa.

A consequência é maior do que "um risco a menos". Ela inverte a estratégia:

| | Renomear com o sistema no ar | Renomear antes do lançamento |
|---|---|---|
| Domínio | Migrar, com 301 preservando path, por prazo indeterminado | **Nunca apontar o domínio antigo para produção** |
| CORS | Janela de origens duplas, remoção posterior | Uma allowlist, já correta |
| E-mails já enviados | Aliases de logo permanentes | Não existem |
| Tokens em circulação | Esperar 48 h | Não existem |
| Ordem das fases | Rígida, corte de domínio por último | Livre |

Portanto: **lançar direto em `vela.app.br`**. O domínio antigo não precisa de
301 nem de sobrevida; basta nunca chegar a servir produção. Isso elimina as
etapas 1, 4 e 7 da antiga Fase 4 e todo o custo de conviver com duas origens.

Uma verificação antes de considerar a premissa fechada: conferir no Resend se
existe qualquer envio a destinatário real (piloto, homologação com cliente,
teste com endereço de colaborador). "Ainda não lançado" às vezes convive com
alguns e-mails já entregues. Se o log estiver limpo, a análise acima vale
integralmente.

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

## 5. Execução

A ordem antiga existia para proteger usuários em produção. Sem eles, a
sequência deixa de ser imposta pelo risco e passa a ser imposta pelo **prazo**:
tudo precisa estar pronto antes do lançamento. O modo correto agora é uma
renomeação única e completa, não uma migração faseada com convivência.

### 5.0 A decisão que virou urgente

No estudo anterior, a separação Vela / FWLog era "outra sessão", adiável. Com o
lançamento em semanas, ela **inverte de prioridade e vira o item mais urgente
do projeto**.

O motivo é o mesmo de §4.2, aplicado ao contrário. Hoje o Portal e o app
interno são o mesmo bundle (§4.1) e separá-los custa uma decisão de arquitetura
e algumas horas. Depois do lançamento, separá-los custa migração de domínio,
janela de CORS duplo, aliases de logo e reemissão de convites — exatamente o
cenário caro que §4.2 acabou de dispensar.

Lançar com Portal e app interno no mesmo domínio "para arrumar depois" converte
uma mudança gratuita na mudança mais cara do projeto. A decisão de entrega —
dois domínios sobre um build com branding por hostname, ou dois builds — precisa
sair **antes** do lançamento, não depois.

### 5.1 Pré-requisitos (fora do código)

1. Concluir o pagamento de `vela.app.br` e `portalfwlog.com.br` — ambos
   reservados no registro.br em 2026-09-12. A exigência de HSTS preload que
   pesa sobre o TLD genérico `.app` **não** se aplica à categoria `app.br` do
   registro.br; não há restrição a planejar aqui.
2. Busca no INPI para a marca nominativa "Vela". É palavra comum, e **este é o
   momento mais barato da vida do projeto para trocar de nome** — nenhum
   usuário, nenhum material impresso, nenhum link em circulação. Depois do
   lançamento, o mesmo achado custa uma segunda renomeação inteira.
3. Decidir a arquitetura de entrega de §5.0.
4. Confirmar no Resend a ausência de envios a destinatários reais (§4.2).

### 5.2 Renomeação (PR única)

Sem produção no ar, dividir em fases só serve à revisão, não à segurança. Uma
PR por assunto continua sendo boa prática de revisão; a convivência entre nomes
antigos e novos, não.

- `index.html:12` — `<title>`.
- `src/lib/pageTitle.ts:8` — `const BASE`, com o teste em
  `src/lib/__tests__/pageTitle.test.ts`.
- `public/site.webmanifest` — `name`, `short_name`.
- `src/components/layout/AppLayout.tsx:130` — logo e `alt` do header interno.
- `src/pages/Login.tsx:61` — logo da tela de login interna.
- `src/pages/LineUpTVDisplay.tsx:199` — logo da tela de TV.
- `src/hooks/useVisualTheme.ts:5` — `storageKey`. Sem usuários, não há
  preferência de tema a preservar: renomeie para `vela_visual_theme` sem
  qualquer cuidado de migração. (Este é um caso em que a análise anterior
  recomendava manter a chave; a razão era proteger preferências existentes,
  que não existem.)
- `package.json`, `opencode.json`, `skills/**`, `.firebaserc`, `firebase.json`.
- `transhipping_test` → `vela_test` em `.github/workflows/ci.yml` e nos 48
  pontos de `src/integration/**` e `src/services/__tests__/**`.

O schema **não** precisa de mudança: o nome do produto não aparece em nenhum
identificador de tabela, coluna, função ou enum — apenas em dois comentários de
cabeçalho das migrations 001 e 002, e nas duas linhas do beneficiário PIX, que
permanecem. Não há motivo para re-baseline de migrations.

Superfície do Portal (`PortalLayout.tsx`, `PortalLogin.tsx`,
`PortalForgotPassword.tsx`, `PortalResetPassword.tsx`,
`PortalConfirmarEmail.tsx`, templates de e-mail) continua sendo da sessão FWLog,
por §5.0 — não porque possa esperar, mas porque tem outro dono.

### 5.3 Documentação viva

21 arquivos em `docs/` fora de `docs/archive/`, mais `CONTEXT.md`, `README.md` e
`WORKFLOW.md` na raiz. Nas ADRs, corrigir onde o texto descreve o sistema no
presente e preservar onde narra contexto histórico. Uma ADR nova registra a
renomeação.

`docs/RASTREABILIDADE.md` não cita o nome e não precisa de alteração.

### 5.4 Stack e domínio

Sem tráfego real, não há ordem obrigatória nem janela de convivência. Resta o
cuidado de §4.3, que é sobre o fluxo de desenvolvimento, não sobre produção:

1. Trocar as origens de `supabase/functions/_shared/cors.ts` para `vela.app.br`
   diretamente — sem manter as antigas. Remover também as entradas
   `*.web.app`/`*.firebaseapp.com`, marcadas como rollback de um cutover de
   hosting já concluído.
2. Renomear o projeto Vercel e **atualizar `VERCEL_PREVIEW_ORIGIN` no mesmo
   commit** (§4.3). Este continua sendo o único passo que quebra algo de
   verdade — o fluxo de PRs da equipe.
3. Renomear o repositório GitHub e revalidar a integração de branching do
   Supabase, que referencia `luccafwlog/transhippingdesk` (ADR 0056).
4. Renomear o projeto no Supabase (cosmético, §4.3) e no Resend, verificando
   SPF/DKIM do domínio novo antes do primeiro envio real.
5. Apontar `vela.app.br` para o Vercel. `transhippingdesk.com.br` nunca chega a
   servir produção.

### 5.5 Identidade visual Vela

Entregáveis: logo horizontal (claro e escuro), símbolo isolado, `favicon.svg`,
`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png` (180×180), `android-chrome-192x192.png`,
`android-chrome-512x512.png`.

Restrições herdadas de `src/index.css`, que **não mudam** — a identidade Vela é
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

Depende do INPI (§5.1.2) apenas para virar definitiva; explorações de forma
podem começar antes.

### 5.6 Domínio próprio em vez de subdomínio: o que isso implica

`portalfwlog.com.br` é um domínio de segundo nível independente, não
`portal.fwlog.com.br`. Se a escolha foi deliberada — por exemplo, por não haver
`fwlog.com.br` sob controle —, ela é viável, mas cobra três coisas que um
subdomínio daria de graça. Vale conferir antes do pagamento, porque depois do
lançamento trocar o domínio do Portal é a migração cara de novo.

**Reputação de envio.** Um domínio recém-registrado envia e-mail sem histórico.
Provedores tratam remetente novo com desconfiança, e as primeiras mensagens do
Portal são justamente convite de ativação e cobrança — as que não podem cair em
spam. Um subdomínio de um domínio já estabelecido herda parte dessa reputação;
um domínio novo começa do zero e exige aquecimento. SPF, DKIM e DMARC precisam
ser configurados e verificados no Resend antes do primeiro envio real, e o
aquecimento deve começar semanas antes do lançamento, não no dia.

**Reconhecimento pelo cliente.** O cliente que conhece `fwlog.com.br` recebe um
link para `portalfwlog.com.br` pedindo login e exibindo fatura. Esse é
exatamente o padrão que treinamento antifraude ensina a desconfiar: o nome da
empresa presente, mas fora do domínio dela. Com subdomínio o problema não
existe. Com domínio próprio, mitiga-se comunicando o endereço pelos canais que
o cliente já usa antes do primeiro envio automático.

**Isolamento — a vantagem.** `vela.app.br` e `portalfwlog.com.br` não
compartilham domínio registrável, então não há como cookie ou storage de um
vazar para o outro. Para um sistema em que o Portal é superfície pública e o
app interno é operação, essa separação é positiva e vale registrar como
decisão, não como acidente.

## 6. Riscos

O risco dominante deixou de ser técnico. Não há produção para quebrar; há um
prazo para cumprir, e uma janela que fecha no lançamento.

| Risco | Gravidade | Mitigação |
|---|---|---|
| **Lançar com a separação Vela/FWLog por fazer** | **Alta** | §5.0 — decidir a arquitetura de entrega antes do lançamento; depois, o custo multiplica |
| **INPI reprovar "Vela" após a identidade pronta** | **Alta** | Busca antes de §5.5 virar definitiva |
| Lançar meio renomeado, com os dois nomes convivîndo | Média | Renomeação única (§5.2), não faseada |
| Regex de preview do Vercel desatualizado derruba os Previews | Média | Renomear projeto e regex no mesmo commit; afeta a equipe, não o cliente |
| Nome Vela vazar para o Portal do Cliente | Média | Teste que falha se `Vela` aparecer em rotas `/portal/*` ou templates de e-mail |
| Domínio novo do Portal sem reputação derruba entregabilidade de convite e cobrança | Alta | §5.6 — SPF/DKIM/DMARC e aquecimento semanas antes do lançamento |
| Cliente ler `portalfwlog.com.br` como phishing | Média | §5.6 — comunicar o endereço pelos canais já conhecidos antes do primeiro envio |
| Premissa de "nenhum e-mail enviado" estar errada | Baixa | Conferir o log do Resend (§5.1.4) |

Riscos que a versão anterior listava e que **deixam de existir**: quebra de
e-mails históricos, perda de preferência de tema e conflito de convivência entre
domínios.

## 7. Validação

- §5.2 e §5.4: `npm run lint`, `npm run test`, `npm run build`, mais os gates de
  banco do `WORKFLOW.md` §11 para a renomeação do banco de teste.
- §5.3: `npm run docs:check` e `git diff --check`.
- Antes do lançamento: login interno, um envio de e-mail e uma fatura com QR
  PIX — o QR deve exibir `TRANSHIPPING AGENCIAMENTO MARITIMO` como
  beneficiário. Sem produção no ar, esta verificação vale mais do que qualquer
  cuidado de cutover: é a única prova de que a separação das três marcas
  sobreviveu à renomeação.
- Teste novo sugerido: asserção de que nenhuma string `Vela` alcança
  `portalEmailTemplates.ts`, `customerCommunicationTemplates.ts` ou os
  componentes de documento fiscal.
