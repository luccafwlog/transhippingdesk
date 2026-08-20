# Recursos da auditoria de segurança do sistema

Escopo: repositório local completo do Transhipping Desk, sem acesso nem testes
ativos contra produção. Auditoria executada em 2026-08-19.

## Superfície avaliada

- SPA React/Vite e configuração Vercel;
- autenticação interna e Portal do Cliente via Supabase Auth;
- RLS, grants, RPCs `SECURITY DEFINER` e migrations Supabase;
- 12 Edge Functions e utilitários compartilhados;
- importações, impressão, links externos, armazenamento no navegador e telemetria;
- dependências npm, arquivos versionados e configuração de CI/testes.

## Classes de risco aplicáveis

| Área | Riscos principais | Referência |
|---|---|---|
| Autenticação | enumeração, brute force, sessão cruzada, reset de senha | OWASP A07 / CWE-307 |
| Autorização | IDOR, RLS incompleta, RPC privilegiada sem guarda | OWASP A01 / CWE-862 |
| Banco | grants excessivos, `search_path`, escrita parcial privilegiada | OWASP A01/A05 |
| Edge Functions | segredo ausente, CORS permissivo, webhook forjado | OWASP A05/A07 |
| Frontend | XSS, open redirect, exposição de token e clickjacking | OWASP A03/A04 |
| Supply chain | pacote vulnerável e dependência transitiva | OWASP A06 |
| Operação | gate de segurança inoperante e configuração divergente | OWASP A05 |

## Evidências coletadas

- **Código:** nenhum segredo real ou arquivo de chave privada está versionado;
  somente `.env.example` corresponde aos padrões inspecionados.
- **Código:** CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `nosniff`, Referrer Policy e Permissions Policy existem em `vercel.json`.
- **Código:** clientes interno e Portal usam chaves de storage separadas; o
  Portal não detecta sessão em URL.
- **Código:** CORS de browser usa allowlist explícita e nega origens ausentes da
  lista sem responder `Access-Control-Allow-Origin: null`.
- **Código:** fluxos públicos de login e recuperação têm resposta genérica,
  rate limit e tokens armazenados por hash.
- **Código:** webhooks e cron sem verificação JWT aplicam segredo ou assinatura
  próprios; funções internas autenticam o JWT do chamador antes de usar
  `service_role`.
- **Teste de contrato SQL:** migrations recentes revogam `PUBLIC`/`anon`,
  restringem `EXECUTE` e controlam `search_path` nas RPCs privilegiadas.
- **Scanner:** `npm audit` encontrou 6 pacotes vulneráveis (5 high, 1 moderate),
  todos com correção disponível.
- **Teste:** 2.108 testes passaram e 34 ficaram skipped.
- **Teste:** documentação, typecheck e build passaram.
- **Teste:** lint não executou de forma válida devido à descoberta de um
  worktree aninhado em `.worktrees/`.

## Limitações

- Não houve acesso a produção, ao histórico remoto de migrations, aos advisors
  do Supabase nem a secrets configurados no ambiente hospedado.
- Não foram enviados emails, alterados usuários, exercitados tokens reais nem
  realizadas escritas em banco.
- Policies/grants foram avaliados pelo estado final expresso nas migrations e
  testes de contrato; a confirmação definitiva exige replay em PostgreSQL
  descartável e/ou inspeção do schema remoto autorizado.
