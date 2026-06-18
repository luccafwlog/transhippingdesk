# Arquitetura e Governança da Documentação — Design

**Data:** 2026-06-18
**Status:** aprovado pelo usuário em 2026-06-18

## Contexto

O repositório possui documentação abundante e, em grande parte, bem organizada:
README, glossário de domínio, arquitetura, workflow, roadmap, roteiro de
validação, ADRs, auditorias, specs e planos de implementação. A revisão do
estado atual encontrou 47 arquivos Markdown, 127 migrations Supabase e nenhum
link Markdown relativo quebrado.

O problema principal não é falta de documentação. É a ausência de uma hierarquia
explícita de autoridade entre documentos vivos, decisões arquiteturais e
registros históricos. Com isso, textos corretos quando escritos continuam
parecendo normativos depois que o código muda.

Exemplos confirmados:

- o README limita a aplicação de migrations ao intervalo `001`–`053`, embora
  existam 127 migrations e o projeto use nomes sequenciais e timestamps;
- documentos descrevem modelos incompatíveis de autenticação do Portal;
- `WORKFLOW.md` ainda menciona fallback por token legado e `jsPDF`;
- rotas atuais do Portal, Viagens e Chegadas e Saídas não aparecem nos mapas
  canônicos;
- a ADR 0012 continua como proposta depois de sua implementação;
- a ADR 0011 declara allowlist `anon` vazia, mas o resolver pré-login do Portal
  é uma exceção posterior, intencional e limitada;
- os playbooks internos do Claude citam biblioteca e caminhos que não
  correspondem ao código atual;
- o procedimento de reset não cobre tabelas financeiras e operacionais
  adicionadas depois de 2026-06-01.

## Objetivo

Transformar a documentação em um sistema navegável e verificável, no qual:

1. esteja claro qual arquivo responde a cada tipo de pergunta;
2. documentos vivos reflitam o código e a configuração atuais;
3. ADRs preservem a história sem esconder decisões posteriores;
4. auditorias, specs e planos datados sejam reconhecidos como snapshots;
5. instruções para agentes representem práticas reais do repositório;
6. divergências mecânicas comuns sejam detectadas automaticamente.

## Abordagem escolhida

Aplicar uma **reconstrução controlada**.

- Preservar auditorias, specs e planos datados como registros históricos.
- Atualizar documentos canônicos e instruções prescritivas.
- Corrigir registros históricos somente quando um erro factual puder induzir
  execução insegura; nesse caso, preferir uma nota editorial datada em vez de
  reescrever o relato original.
- Não mover ou renomear em massa documentos históricos nesta etapa.
- Não refatorar código de produto para fazê-lo coincidir com documentação
  idealizada; a documentação deve representar o estado real.

Essa abordagem foi escolhida por produzir autoridade e navegação claras sem
quebrar links, referências de commits ou o valor probatório dos registros
históricos.

## Hierarquia documental

### 1. Entrada e navegação

- `README.md`: visão curta do produto, início rápido e portas de entrada.
- `docs/README.md`: índice central e contrato de autoridade documental.

O README raiz deixa de tentar carregar toda a arquitetura. Ele apresenta o
produto e encaminha o leitor ao documento correto.

### 2. Fontes vivas

- `CONTEXT.md`: glossário de domínio, sem detalhes de implementação.
- `docs/ARCHITECTURE.md`: arquitetura, fronteiras, fluxos, módulos e rotas.
- `WORKFLOW.md`: execução local, desenvolvimento, testes, migrations e deploy.
- `docs/ROADMAP.md`: capacidades atuais, trabalho em evolução, backlog e riscos.
- `docs/VALIDACAO.md`: checklists operacionais e evidências exigidas.
- `docs/RESET_AMBIENTE.md`: procedimento seguro de reset, ou aviso explícito de
  suspensão se o script não puder provar cobertura.
- `AGENTS.md` e `CLAUDE.md`: regras para agentes, incluindo precedência dos
  documentos e verificações obrigatórias.
- `.claude/skills/*.skill`: playbooks prescritivos específicos do projeto.

Esses arquivos devem ser atualizados quando a mudança altera o contrato que
descrevem.

### 3. Decisões

- `docs/adr/README.md`: índice com número, título, status, data e relação de
  supersessão.
- `docs/adr/*.md`: decisões e consequências.

ADRs aceitas não são reescritas para fingir que sempre refletiram o estado
atual. Mudanças relevantes geram uma ADR posterior que registra a evolução e
declara quais partes anteriores foram supersedidas.

### 4. Registros históricos

- `docs/TECHNICAL-AUDIT-*.md`
- `docs/QA-AUDIT-*.md`
- `docs/design-audit/`
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/plans/`
- `plans/`

Esses documentos registram um estado, uma investigação ou uma intenção em uma
data/commit. O índice central deve explicar que eles não são fonte canônica do
estado presente.

## Mudanças previstas

### Índices e governança

Criar:

- `docs/README.md`, com mapa por público e por pergunta;
- `docs/adr/README.md`, com catálogo e status das decisões;
- uma ADR para o modelo atual de autenticação do Portal e a exceção limitada de
  `anon` em `portal_resolve_login`.

O novo ADR deve superseder parcialmente:

- ADR 0001, apenas na afirmação de que login é exclusivamente por email;
- ADR 0011, apenas na afirmação de allowlist `anon` vazia.

### Documentos canônicos

Atualizar:

- `README.md`: rotas, migrations, Portal, CI e mapa documental;
- `CONTEXT.md`: manter semântica de domínio e remover formulações ambíguas entre
  conta, identificador de login e autenticação;
- `WORKFLOW.md`: stack real, arquitetura real, rotas, autenticação, CI, impressão
  via navegador, migrations por timestamp e práticas reais de acesso a dados;
- `docs/ARCHITECTURE.md`: fluxo atual, Portal expandido, master-detail de
  Viagens, programação de navios e mapa completo de rotas;
- `docs/ROADMAP.md`: remover riscos já resolvidos, datar o baseline e separar
  trabalho confirmado de ideias;
- `docs/VALIDACAO.md`: incluir os fluxos atuais do Portal, auto-faturamento após
  revisão, gate de CE Mercante, rotas novas e comandos consistentes;
- `docs/RESET_AMBIENTE.md`: não prometer um reset completo enquanto o SQL não
  cobrir com segurança ledger, Granito, Demurrage, Vazios e tabelas de Portal.

### Instruções para agentes

Atualizar `AGENTS.md` e `CLAUDE.md` sem duplicar grandes blocos:

- declarar fontes de verdade;
- exigir leitura de `CONTEXT.md` e ADRs relevantes para mudanças de domínio;
- exigir atualização documental quando contratos, rotas, migrations ou
  procedimentos mudarem;
- indicar arquivos protegidos e verificações aplicáveis;
- manter as regras comportamentais já existentes.

Corrigir os playbooks:

- `import-parser.skill`: usar `@e965/xlsx`, `assertUploadSize` e padrões reais;
- `react-query-pattern.skill`: representar o estado atual sem declarar uma
  separação page→hook→service que o código não aplica universalmente;
- `invoice-pdf.skill`: documentar `window.print()` e os componentes
  compartilhados reais, sem exigir elementos inexistentes;
- `supabase-migration.skill`: preservar default-deny, mas documentar que exceções
  pré-autenticação exigem ADR, grant explícito e teste.

### Verificação automatizada

Adicionar `scripts/check-docs.mjs` e o script npm `docs:check`.

O verificador deve:

- validar links Markdown relativos;
- exigir que todo ADR numerado esteja no índice;
- exigir que rotas canônicas de `src/App.tsx` estejam cobertas em
  `docs/ARCHITECTURE.md`;
- rejeitar referências normativas conhecidamente obsoletas, como intervalo fixo
  até migration `053`, fallback de token legado e `jsPDF`;
- produzir mensagens com arquivo e causa.

Adicionar `npm run docs:check` ao CI antes do build. O verificador não deve
inspecionar snapshots históricos com regras de atualidade, exceto links.

## Segurança do reset

O script atual trunca tabelas antigas, mas não lista explicitamente várias
tabelas introduzidas depois, incluindo ledger, Demurrage, Granito e Vazios.
Como reset é uma operação destrutiva, documentação não deve inferir que cascatas
resolverão tudo.

Nesta entrega:

1. validar as dependências do script contra as migrations;
2. se a ordem e cobertura puderem ser provadas localmente, atualizar o script e
   a documentação;
3. caso contrário, marcar o procedimento como suspenso e fornecer apenas
   consultas de diagnóstico, deixando a correção destrutiva para uma mudança
   separada com banco de teste.

Não executar o reset durante esta revisão.

## Critérios de qualidade

- Cada afirmação operacional importante deve apontar para código, configuração
  ou migration verificável.
- Documentos vivos devem usar data de verificação, não uma vaga “última
  atualização”.
- Contagens voláteis devem ser evitadas quando não agregarem valor; quando
  necessárias, devem ser deriváveis por comando.
- O português deve ser consistente, com acentuação UTF-8.
- Links devem ser relativos e navegáveis no GitHub.
- Tabelas devem ser usadas apenas quando facilitarem comparação.
- Não duplicar descrições extensas em README, arquitetura e workflow.

## Verificação

Antes de concluir:

1. executar `npm run docs:check`;
2. executar `npm run lint`;
3. executar `npm test`;
4. executar `npm run build`;
5. revisar `git diff --check`;
6. confirmar que nenhuma migration, arquivo gerado ou código de produto foi
   alterado sem necessidade;
7. comparar novamente rotas, scripts npm, workflows e migrations com os
   documentos canônicos.

## Fora de escopo

- Reorganizar fisicamente todo o histórico em uma pasta `archive/`.
- Reescrever retrospectivamente auditorias para refletir correções posteriores.
- Corrigir todos os problemas de produto citados por auditorias antigas.
- Aplicar migrations ou executar reset em banco remoto.
- Substituir a infraestrutura documental por Docusaurus, MkDocs ou ferramenta
  equivalente.
- Criar documentação de usuário final completa para cada tela.

## Resultado esperado

Um desenvolvedor ou agente novo deve conseguir responder, sem adivinhação:

- o que o sistema faz;
- qual terminologia usar;
- como o sistema está estruturado;
- como executar, testar e publicar;
- quais decisões continuam válidas;
- quais documentos são históricos;
- como validar que uma mudança também manteve a documentação correta.
