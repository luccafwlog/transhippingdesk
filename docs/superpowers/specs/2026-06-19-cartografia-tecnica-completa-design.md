# Cartografia Técnica Completa do Sistema — Design

**Data:** 2026-06-19  
**Status:** aprovado pelo usuário em 2026-06-19

## Contexto

O Transhipping Desk cresceu para 34 páginas de produto, 57 serviços, 24 hooks,
129 migrations e mais de 100 arquivos de teste TypeScript/TSX. A aplicação
possui interações que atravessam rotas, componentes, React Query, serviços,
RPCs, tabelas, triggers e integrações externas.

Os documentos vivos atuais explicam arquitetura, módulos, regras e fluxos
canônicos. Eles ainda não oferecem uma cartografia uniforme que permita
responder rapidamente, para cada tela ou ação:

- onde a interação começa;
- quais condições habilitam ou bloqueiam a ação;
- qual handler, hook ou serviço é executado;
- quais RPCs, tabelas, funções e integrações são envolvidas;
- quais estados e caches são alterados;
- quais efeitos colaterais ocorrem;
- quais testes sustentam o comportamento;
- se a conclusão foi apenas inferida do código ou comprovada em execução.

O objetivo desta revisão não é substituir a documentação reconstruída em
2026-06-18 e 2026-06-19. É aprofundá-la até o nível necessário para manutenção,
diagnóstico e avaliação de comportamento por desenvolvedores.

## Objetivo

Criar uma cartografia técnica completa e navegável do comportamento atual do
sistema, incorporada aos documentos vivos em `docs/modules/`, com:

1. anatomia das telas e seus estados;
2. catálogo rastreável das ações relevantes;
3. fluxos entre módulos e fronteiras de persistência;
4. invariantes, gates e efeitos colaterais;
5. cobertura de testes e evidência de runtime;
6. divergências e comportamentos suspeitos encontrados durante a revisão;
7. índice transversal para localizar rapidamente o caminho de uma interação.

Ao final, um desenvolvedor deve conseguir partir de uma rota, aba, modal,
drawer, botão ou ação e seguir o caminho até o contrato de dados e a evidência
que sustenta o comportamento documentado.

## Público

A documentação é voltada a desenvolvedores e agentes que mantêm o repositório.

Ela não será um manual de treinamento operacional. Elementos visuais e termos de
interface serão descritos apenas quando necessários para identificar a origem de
uma interação ou explicar seu comportamento técnico.

## Princípios

### Código executável como evidência final

Quando documentos históricos, comentários ou nomes divergirem do caminho
executado, prevalecem:

1. rotas, componentes e handlers atuais;
2. hooks, serviços e utilitários chamados;
3. migrations, RPCs, triggers, grants e policies vigentes;
4. testes automatizados;
5. comportamento observado em ambiente de execução.

Uma divergência documental não deve ser corrigida por suposição. O texto deve
registrar a evidência e o grau de comprovação.

### Organização por tela e ação

O eixo principal será a rota ou superfície de interface. Essa estrutura responde
à pergunta mais comum durante manutenção: “o que esta tela ou ação faz?”.

Fluxos que atravessam várias telas serão explicados por diagramas Mermaid e
referências entre módulos. Um índice transversal permitirá o caminho inverso,
partindo de hook, serviço, RPC, tabela ou teste.

### Mudanças documentais, não correções de produto

Esta tarefa revisa, documenta e aponta divergências. Ela não corrige código,
migrations, políticas, dados ou comportamento do produto.

Se um problema for encontrado, ele será registrado no módulo correspondente com
evidência, impacto e estado de validação. Qualquer correção futura exige uma
tarefa própria.

### Profundidade proporcional ao risco

Todas as rotas e ações relevantes recebem rastreamento estático. Fluxos críticos
recebem também validação prática quando houver ambiente e dados seguros:

- autenticação interna e Portal;
- imports e conciliação Baplie × manifesto;
- revisão e reconciliação de cliente;
- taxas locais, faturamento, ledger e PIX;
- demurrage;
- superfícies críticas do Portal do Cliente.

## Arquitetura documental

### Documentos vivos por módulo

Cada arquivo em `docs/modules/` seguirá o mesmo contrato:

1. **Propósito e escopo**
   - responsabilidade;
   - rotas;
   - guards, perfis e pontos de entrada;
   - limites em relação a outros módulos.

2. **Anatomia das telas**
   - páginas e componentes principais;
   - abas, modais, drawers e documentos imprimíveis;
   - estados de loading, vazio, erro e indisponibilidade;
   - parâmetros de rota, busca e seleção.

3. **Catálogo de ações**
   - ação identificável pelo desenvolvedor;
   - pré-condições e permissões;
   - componente e handler de origem;
   - hook, mutation ou serviço;
   - RPC, tabela, Edge Function ou integração;
   - escritas, auditoria e efeitos colaterais;
   - query keys e invalidações;
   - tratamento de sucesso e falha;
   - evidência disponível.

4. **Estado e dados**
   - queries e query keys;
   - mutations;
   - estado local relevante;
   - dados derivados;
   - ownership e fonte da verdade;
   - riscos de stale data ou duplicação.

5. **Fluxos e invariantes**
   - sequências entre telas e módulos;
   - gates;
   - transições de estado;
   - atomicidade e idempotência;
   - condições que não podem ser violadas.

6. **Testes e validação**
   - testes unitários, de componente, de contrato SQL e de integração;
   - caminhos importantes sem cobertura;
   - cenários comprovados em runtime;
   - limitações do ambiente de validação.

7. **Notas e divergências**
   - diferença entre intenção documentada e execução;
   - comportamento possivelmente incorreto;
   - inconsistência de nomenclatura ou ownership;
   - risco de manutenção;
   - grau de comprovação e próximo passo recomendado.

### Índice transversal

Será criado `docs/RASTREABILIDADE.md`, documento vivo de referência técnica que
relacione:

```text
rota/superfície
  → ação
  → componente/handler
  → hook ou serviço
  → RPC/função/tabela/integração
  → efeito colateral
  → teste/evidência
```

O índice não duplicará a explicação completa dos módulos. Ele funcionará como
mapa de navegação e apontará para a seção canônica correspondente.

`docs/README.md` continuará como índice principal e apontará para
`docs/RASTREABILIDADE.md`. O novo documento apontará de volta para as seções
canônicas em `docs/modules/`.

## Unidade de documentação de uma ação

Cada ação relevante usará uma linha ou subseção equivalente a:

| Campo | Conteúdo |
|---|---|
| Tela / ação | Rota, superfície e nome visível ou técnico da ação |
| Pré-condições | Perfil, seleção, estado, gate e dados exigidos |
| Origem | Página, componente e handler |
| Orquestração | Hook, mutation, serviço e regras intermediárias |
| Persistência | RPC, tabela, trigger, Edge Function ou integração |
| Efeitos | Escritas, auditoria, emissão, recálculo, navegação e notificações |
| Cache | Query keys atualizadas ou invalidadas |
| Falhas | Erros de negócio, transporte e feedback para o usuário |
| Evidência | Código, teste, runtime ou suspeita |

Nem todo clique puramente visual exige uma linha. Entram no catálogo ações que:

- consultam ou alteram estado remoto;
- alteram estado de negócio;
- iniciam import, exportação, impressão ou download;
- navegam com contexto relevante;
- abrem uma superfície que contém lógica própria;
- executam cálculo, validação, reconciliação ou transição;
- podem falhar ou produzir efeitos colaterais relevantes.

## Classificação de evidência

Cada afirmação comportamental importante receberá um ou mais selos:

- **Código:** confirmada por rastreamento estático do caminho executável.
- **Teste:** sustentada por teste automatizado identificado.
- **Runtime:** comprovada em navegador e, quando necessário, por leitura segura
  do banco ou resposta da API.
- **Suspeita:** comportamento potencialmente incorreto ou inconsistente, ainda
  não confirmado por evidência suficiente.

Os selos não representam níveis crescentes absolutos. Um teste de contrato SQL,
por exemplo, comprova a presença de texto numa migration, não o comportamento de
um banco remoto. A documentação deve explicar o limite da prova quando isso
afetar a interpretação.

## Processo de revisão

### 1. Baseline e inventário

- registrar commit e estado da árvore;
- derivar rotas de `src/App.tsx`;
- inventariar páginas, componentes, hooks, serviços, testes, migrations e Edge
  Functions;
- mapear os documentos vivos existentes;
- estabelecer famílias de query keys, RPCs, tabelas e integrações.

### 2. Varredura por subsistema

A revisão será dividida em frentes independentes e read-only:

- navegação, autenticação, layout e suporte;
- viagens, schedules e operação;
- manifestos, containers, veículos, Baplie e vazios;
- revisão, clientes e Portal;
- taxas locais, faturamento, ledger e PIX;
- demurrage e Granito;
- banco, migrations, RLS, RPCs, triggers e Edge Functions;
- testes, CI, observabilidade e documentação.

Agentes paralelos podem produzir inventários candidatos, mas toda afirmação
incorporada aos documentos será revisada contra o código pelo agente principal.

### 3. Rastreabilidade estática

Para cada rota e ação:

1. localizar a renderização;
2. identificar o handler;
3. seguir imports e chamadas;
4. identificar queries, mutations e invalidações;
5. identificar fronteiras de banco ou integração;
6. localizar testes relacionados;
7. registrar efeitos, falhas e invariantes;
8. cruzar com ADRs, arquitetura, regras de negócio e módulo atual.

### 4. Validação automatizada

Serão executados os testes focados relevantes durante cada frente. A suíte
completa e os gates do repositório serão executados ao final.

Um teste será citado apenas quando sua asserção sustentar de fato o comportamento
documentado. Testes que apenas verificam texto de migration serão classificados
como testes de contrato ou drift, não como prova funcional do banco.

### 5. Validação em runtime

A validação prática será read-only sempre que possível. Operações de escrita
usarão somente ambiente e fixtures controlados, se disponíveis e seguros.

Cada cenário registrará:

- ambiente;
- perfil utilizado;
- dados ou fixture;
- ações realizadas;
- resultado observado;
- efeito persistido, quando verificável;
- console ou erro relevante;
- limpeza necessária;
- limitações.

Se credenciais, ambiente ou dados controlados não estiverem disponíveis, o
cenário ficará marcado como não executado, sem transformar inferência estática em
prova de runtime.

### 6. Consolidação

- atualizar cada documento de módulo sem duplicar regras já canônicas;
- criar diagramas somente quando relações ou sequências ficarem mais claras;
- atualizar o índice documental;
- criar o índice transversal;
- registrar divergências no módulo proprietário;
- preservar snapshots históricos em `docs/archive/`.

## Escopo por módulo

Os documentos vivos atuais permanecem como unidades principais:

- `viagens.md`;
- `manifesto-edi.md`;
- `granito.md`;
- `chegadas-saidas.md`;
- `clientes.md`;
- `taxas-locais.md`;
- `faturamento.md`;
- `demurrage.md`;
- `reconciliacao-pix.md`;
- `portal-cliente.md`;
- `operacao-suporte.md`.

Quando um documento cobre várias rotas, sua anatomia e catálogo serão separados
por rota ou superfície, usando sumário e âncoras. Esta tarefa não dividirá os 11
documentos de módulo em novos arquivos.

## Fluxos críticos de runtime

### Autenticação

- login interno;
- perfil inativo ou não autorizado;
- guard administrativo;
- login do Portal por documento e email;
- recuperação de senha;
- isolamento entre as sessões interna e Portal.

### Importação e operação

- criação ou seleção de viagem;
- import de manifesto;
- import de Baplie;
- conciliação Baplie × manifesto;
- CE Mercante;
- import de containers, veículos, carga solta e vazios quando houver fixtures.

### Revisão e faturamento

- pendências do gate canônico;
- reconciliação de cliente;
- cálculo de taxas;
- promoção para faturamento;
- emissão de invoice;
- invoice consolidada quando houver dados controlados;
- pagamento, ledger, parcial, refund e cancelamento quando seguros.

### PIX, Demurrage e Portal

- upload e matching de extrato PIX;
- confirmação e propagação do pagamento;
- cálculo e invoice de demurrage;
- consulta de billing e operação no Portal;
- gates de visibilidade, disputas, notificações e perfil.

## Tratamento de achados

Achados não serão apresentados como bugs sem evidência suficiente.

Cada divergência deve incluir:

- comportamento observado ou inferido;
- comportamento esperado, quando houver fonte explícita;
- arquivos e contratos envolvidos;
- impacto;
- selo de evidência;
- confiança;
- condição necessária para confirmar;
- recomendação de tarefa futura, sem implementação nesta revisão.

Problemas históricos já corrigidos não serão reintroduzidos como achados atuais.
Auditorias antigas serão usadas como pistas, e cada item relevante será
revalidado no estado atual.

## Verificação

Durante a revisão:

- executar testes focados das áreas analisadas;
- conferir links e referências adicionadas;
- validar diagramas Mermaid e tabelas;
- comparar rotas e ações documentadas contra o código.

Antes da conclusão:

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check
```

### Baseline conhecido do gate documental

Na revisão histórica `35495d1`, `npm run docs:check` falhava em dez links sob
`skills/`: dois links relativos ausentes em `skills/grill-me-with-docs/SKILL.md`
e oito links iniciados por `/en/docs/` em
`skills/writing-skills/anthropic-best-practices.md`.

O PR `#253` corrigiu essas dez falhas antes da implementação do redesenho de B/L.
Portanto, o plano de execução deve exigir uma baseline contendo os PRs
`#253`–`#258`, verificar que o gate está limpo antes de adicionar as novas regras
da cartografia e não recriar nem reescrever os arquivos de skill já corrigidos.

Também será feita uma auditoria final de cobertura:

- toda rota executável aparece na cartografia;
- toda ação remota relevante está catalogada;
- todo módulo aponta suas dependências;
- fluxos críticos têm estado de validação explícito;
- divergências têm evidência e não estão misturadas com comportamento confirmado;
- documentos históricos não foram reescritos como fontes atuais.

## Critérios de conclusão

A revisão estará concluída quando:

1. todos os módulos vivos seguirem o contrato documental;
2. todas as rotas e superfícies relevantes estiverem cobertas;
3. as ações remotas e transições críticas tiverem rastreabilidade até dados e
   testes;
4. os fluxos críticos tiverem validação de runtime ou limitação explícita;
5. o índice transversal estiver navegável;
6. divergências encontradas estiverem registradas com evidência;
7. os gates obrigatórios do repositório passarem;
8. não houver alteração de código de produto ou banco.

## Fora de escopo

- corrigir bugs ou refatorar o produto;
- alterar schema, RLS, RPCs, triggers ou Edge Functions;
- aplicar migrations;
- executar o reset suspenso;
- criar documentação de treinamento para usuários finais;
- substituir Markdown por uma plataforma documental;
- reescrever auditorias, specs e planos históricos;
- prometer validação de runtime sem ambiente ou dados seguros.

## Resultado esperado

Os documentos vivos se tornam um mapa técnico do sistema executável. Um
desenvolvedor consegue investigar uma interação sem procurar às cegas por todo o
repositório, distinguir intenção de comportamento comprovado e localizar
rapidamente os pontos em que uma alteração pode afetar outras telas, regras ou
contratos.
