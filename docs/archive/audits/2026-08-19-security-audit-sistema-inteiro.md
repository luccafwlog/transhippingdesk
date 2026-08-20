# Auditoria de segurança do sistema inteiro

Data: 2026-08-19
Escopo: repositório local `/Users/luccajuliatti/Downloads/transhippingdesk`
Método: análise estática, scan de dependências e testes locais não destrutivos.

## Resumo executivo

Não foi encontrada evidência de vulnerabilidade crítica, segredo versionado,
SQL injection, RCE ou quebra direta de autenticação. Foram confirmados **3
achados**: **1 alto**, **1 médio** e **1 baixo**. A postura existente é boa nas
fronteiras centrais (RLS/RPC, Portal Auth, CORS, tokens e headers), mas o sistema
não deve ser considerado totalmente mitigado enquanto as dependências e as
operações privilegiadas não forem corrigidas e retestadas.

| ID | Severidade | Achado | Estado |
|---|---|---|---|
| SEC-001 | Alto | Dependências npm com advisories corrigíveis | Aberto |
| SEC-002 | Médio | Operações Portal com `service_role` podem concluir parcialmente | Aberto |
| SEC-003 | Baixo | Gate de lint falha ao incluir `.worktrees/` | Aberto |

## Achados

### SEC-001 — Dependências npm vulneráveis

**Evidência:** Scanner (`npm audit`, 2026-08-19).

O lockfile instala `react-router@7.17.0`, `brace-expansion@5.0.6`,
`nanoid@3.3.12`, `postcss@8.5.15` e `undici@7.28.0`. O scanner reportou 6
pacotes vulneráveis, com 5 ocorrências classificadas como high e 1 como
moderate. Há correção disponível para todos.

Impacto calibrado: `react-router` é dependência de runtime, embora os advisories
de RSC/SSR não se apliquem diretamente à SPA estática; o advisory de matching e
o open redirect continuam relevantes até prova focada. Os demais pacotes estão
na cadeia de build/teste (`vite`, `eslint`, `jsdom`), reduzindo a exposição em
produção, mas preservando risco de supply chain e CI com entrada não confiável.

**Recomendação:** atualizar `react-router-dom`/`react-router` para versão sem os
advisories e atualizar o lockfile para versões corrigidas de `brace-expansion`,
`nanoid`, `postcss` e `undici`; executar testes, build e `npm audit` novamente.

### SEC-002 — Escritas privilegiadas do Portal não são atômicas

**Evidência:** Código.

Em `supabase/functions/portal-invite-activate/index.ts`, o convite é consumido e
o usuário Auth é criado antes da atualização de `customer_portal_accounts`. O
erro dessa atualização não é tratado; a função pode responder
`{ activated: true }` deixando usuário órfão, convite consumido e conta não
ativada. Em `supabase/functions/portal-account-suspend/index.ts`, updates e
registro de auditoria com `service_role` também não têm seus erros verificados,
permitindo resposta de sucesso após persistência parcial.

Não é bypass de autorização: os endpoints continuam protegidos por token de
convite ou papel interno. O impacto é integridade e disponibilidade do ciclo de
identidade, com divergência entre Auth, conta e trilha de auditoria.

**Recomendação:** mover a transição de estado e auditoria para RPC transacional;
tratar explicitamente todos os erros; compensar a criação Auth quando a
persistência falhar; deixar teste executável cobrindo falha em cada etapa.

### SEC-003 — Gate de lint não isola o repositório principal

**Evidência:** Teste.

`npm run lint` incluiu `.worktrees/codex-bloco-522-financeiro` e falhou com
1.619 erros de resolução de `tsconfigRootDir`. Assim, o gate não chegou a
validar confiavelmente o código em escopo. A existência do worktree não é uma
vulnerabilidade, mas a falha reduz a capacidade de detectar regressões e torna
o resultado local dependente do estado da máquina.

**Recomendação:** ignorar `.worktrees/**` no ESLint (e outros artefatos locais
equivalentes) ou fixar explicitamente o diretório raiz do parser; adicionar uma
checagem pequena que prove que o lint do checkout principal é reproduzível.

## Controles positivos verificados

- CSP e headers defensivos configurados no hosting.
- Sessões interna e Portal isoladas por `storageKey`.
- CORS com allowlist exata; previews exigem configuração explícita.
- Login e recuperação mitigam enumeração e brute force.
- Tokens de convite/recuperação são aleatórios, armazenados por hash e possuem
  expiração/consumo condicional.
- `service_role` permanece nas Edge Functions e não no bundle Vite.
- Webhooks sem JWT validam assinatura/segredo dedicado.
- Migrations recentes endurecem grants de RPCs e `search_path`.
- Nenhuma chave privada ou secret real foi encontrada entre arquivos
  versionados pelos padrões examinados.

## Plano de remediação — requer aprovação explícita

1. **SEC-001:** atualizar dependências e lockfile; criar/ajustar teste focado de
   navegação; validar `npm audit`, testes e build.
2. **SEC-002:** criar fronteira transacional para estados do Portal, adicionar
   compensação Auth e testes de falha; atualizar documentação de arquitetura e
   segurança conforme o contrato do repositório.
3. **SEC-003:** excluir worktrees do lint ou fixar `tsconfigRootDir`, mantendo o
   checkout principal como único escopo; validar o gate completo.
4. Reexecutar a auditoria e, em ambiente descartável autorizado, fazer replay
   das migrations e testes de autorização anon/Portal/interno.

Nenhuma dessas remediações foi aplicada nesta fase.

## Validação executada

| Comando | Resultado |
|---|---|
| `npm run docs:check` | Passou — 386 Markdown, 47 rotas |
| `npm run typecheck` | Passou |
| `npm run lint` | Falhou — escopo incluiu `.worktrees/` |
| `npm test` | Passou — 433 arquivos, 2.108 testes; 4/34 skipped |
| `npm run build` | Passou |
| `npm audit --json` | Falhou — 6 vulnerabilidades abertas |

## Status final da fase

Mitigação: **0/3 achados aplicados**. Auditoria e plano concluídos; testes de
penetração antes/depois e relatório de mitigação final dependem da aprovação do
plano acima.
