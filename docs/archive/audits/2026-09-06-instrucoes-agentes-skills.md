# Simplificação das instruções de agentes

## Referência e escopo

Aplicação do artigo [Rethinking skills and prompts for GPT-6 Astra, de Eric
Provencher](https://x.com/pvncher/status/2095991462416490862), lido integralmente
na publicação original. O escopo é a orientação versionada do Transhipping Desk:
entrada dos agentes, seleção de skills, fluxos de implementação e referências.

Foram examinadas as descrições das 50 skills e revisados os fluxos com gatilhos
amplos, pausas artificiais ou carregamento excessivo. Foram alteradas 38 skills.
Os playbooks especializados de domínio mantêm seus contratos operacionais;
essa revisão não é uma auditoria de regras de negócio ou de segurança do app.

## Alterações

**Código — inspeção documental:**

- `AGENTS.md` mantém `CLAUDE.md` como fonte única e deixa a consulta das demais
  fontes condicionada à tarefa. `CLAUDE.md` explicita conclusão, continuidade e
  limites de autorização.
- Skills de planejamento, execução, TDD, revisão e worktrees passam a orientar
  resultados e decisões concretas, sem menus obrigatórios ou confirmação de
  escolhas locais já cobertas pelo pedido. O template de implementação por
  subagente acompanha esse contrato.
- As descrições passam de 10.065 para 4.106 caracteres, redução de 59,2%.
  A soma dos 50 `SKILL.md` passa de 362.850 para 195.492 bytes UTF-8, redução
  de 46,1%. Essas medidas descrevem texto, não consumo de tokens em runtime.
- `emil-design-eng` divide detalhes em cinco referências por assunto;
  `ui-ux-pro-max`, em quatro. O segundo deixa de exigir um script de busca não
  incluído na cópia versionada e de declarar React Native como stack do projeto.
- `WORKFLOW.md` distingue validação documental de gates de aplicação e corrige
  três caminhos antigos de playbooks. O catálogo registra as adaptações locais
  e o alcance do instalador.

As proteções de arquivos, migrations existentes, RLS, reset suspenso e acesso à
produção permanecem. Hooks, instalador, aplicação, CI e configurações globais
não foram alterados. Nomes, licenças e metadados de invocação das skills foram
preservados, inclusive os que restringem invocação automática.

## Verificação

**Teste — validação estrutural:**

- `npm run docs:check`: aprovado, incluindo links das referências novas.
- `git diff --check`: aprovado.
- Parsing YAML das 50 skills e comparação com `HEAD`: aprovado; nomes,
  licenças e políticas de invocação preservados.
- `quick_validate.py` da skill `skill-creator`: 35 skills aprovadas e 15 com as
  mesmas incompatibilidades preexistentes de frontmatter; nenhuma falha nova.
  O validador genérico não aceita extensões como `disable-model-invocation`,
  `argument-hint` e os campos do playbook de segurança. Esses metadados não
  foram apagados para satisfazer um validador de outro formato.

**Código — cenários de leitura revisados:** uma correção de texto usa os checks
documentais; uma implementação com requisitos definidos continua até validar;
uma mudança de migration continua sujeita às proteções de banco; uma correção
de interação carrega a referência de UI pertinente, sem gerar outro design
system. Trata-se de revisão estática das instruções, não de experimento de
comportamento de modelos.

Testes e build da aplicação não foram executados: a alteração contém apenas
Markdown. Não foi medida melhora de comportamento, latência ou custo em sessões
reais; isso exige observar uso posterior.

## Instalação

A fonte versionada é `skills/`. O instalador existente sincroniza as cópias
globais de Claude Code, Codex e Antigravity quando executado; não foi executado
nesta revisão, para manter a mudança no repositório solicitado. Sessões abertas
conservam seu catálogo carregado. Cópias em `~/.agents/skills/` e skills de
plugins não são geridas por esse instalador e podem continuar sobrepostas.
