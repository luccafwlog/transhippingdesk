# ADR 0057 — Perfil Equipamentos ganha sua primeira permissão

Status: aceito — 2026-08-27

## Contexto

`roleHasPermission` (`src/hooks/useAuth.tsx`) hoje retorna `false` para
`equipamentos` em toda permissão: o perfil existe, tem leitura interna global
pela ADR 0044 e escrita com rastro pela ADR 0046, mas nenhuma permissão
nomeada.

A cobrança de Demurrage é responsabilidade de Equipamentos na operação, e o
canal de Comunicado (ADR 0055) coloca essa cobrança dentro do sistema. Sem
permissão, Equipamentos não alcançaria a tela que executa o próprio trabalho.

Considerou-se recortar a permissão por categoria de comunicado — Documentação e
Administrativo em Operacional, Financeiro–taxas locais e Institucional;
Equipamentos apenas em Financeiro–Demurrage. O produto decidiu que os três
perfis disparam qualquer comunicado, e a trilha responde quem fez.

## Decisão

- Nasce a permissão `customer_communications`, concedida a `administrativo`,
  `documentacao` e `equipamentos`.
- Ela governa o acesso ao módulo de Comunicação e a execução de Disparo de
  Comunicado, sem recorte por categoria.
- Todo disparo registra autor, momento e recorte.
- `portal_provisioning` **não** é reaproveitada: amarrar comunicação
  operacional à governança do Portal recriaria o acoplamento que a ADR 0055
  desfaz.

## Consequências

`equipamentos` deixa de ser um perfil sem permissões. O `switch` de
`roleHasPermission` passa a ter um ramo real para ele, e o teste
`src/hooks/__tests__/roleHasPermission.test.ts` precisa cobrir a nova matriz.

Como não há recorte por categoria, um usuário de Documentação pode disparar
cobrança de Demurrage e um de Equipamentos pode disparar Aviso de Chegada.
Isso é escolha consciente do produto: a conferência obrigatória e a trilha por
autor são as guardas, não a permissão. Se o recorte por categoria vier a ser
necessário, ele entra como refinamento desta permissão, não como permissão
nova.

Não altera a ADR 0044 (leitura interna global) nem a 0046 (escrita interna
global com rastro). Especificação funcional em
[`../spec/2026-08-27-comunicacao-email-clientes-design.md`](../spec/2026-08-27-comunicacao-email-clientes-design.md).
