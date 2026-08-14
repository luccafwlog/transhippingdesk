# Rate limit do Portal: voltar ao normalizador compartilhado e cobrir a troca de email

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Fazer o rate limit do Portal usar o mesmo normalizador canônico de CNPJ
do resto do sistema, e estender a trava de tentativas à verificação de senha da
troca de Email de Recuperação.

**Origem:** grilling de 2026-08-14 sobre o fluxo de login/recuperação (PR #539).
Os dois achados foram verificados contra o banco de produção; nenhum deles é
regressão da #539, que trata de mensagens de tela.

**Escopo deliberadamente fora da PR #539:** exige migration, cujo risco de deploy
é diferente do restante daquele diff.

---

## Contexto

### Achado A — o hash do rate limit apaga as letras do CNPJ

As três funções de rate limit calculam a chave assim:

```sql
regexp_replace(coalesce(p_login,''), '\D', '', 'g')
```

`\D` remove tudo que não é dígito, **inclusive as letras do CNPJ alfanumérico**.
Verificado em produção:

| Entrada | Chave gerada |
|---|---|
| `12ABC34501DE35` | `123450135` |
| `12XYZ34501FG35` | `123450135` |

Dois CNPJs distintos compartilham o balde de tentativas. Cinco falhas em um
bloqueiam o login do outro por 15 minutos — negação de serviço cruzada entre
clientes que não têm relação.

**Causa.** A migration `040` chamava o normalizador compartilhado
(`normalize_document_text` → `normalize_cnpj`). A `183` substituiu a chamada por
um `regexp_replace` inline; a `191` copiou o mesmo trecho para a recuperação.
Quando o CNPJ alfanumérico chegou (migration `293`), `normalize_cnpj` foi
corrigida para preservar letras — mas o rate limit já não a chamava, então a
correção passou ao lado.

`public.normalize_cnpj` **já está correta** e é o alvo da volta:

```sql
upper(regexp_replace(p_value, '[^0-9A-Za-z]', '', 'g'))
```

Este é o caso literal da convenção do `CLAUDE.md`: *"Fix a bug at the shared
function after checking its callers, not one guard per call site."* A correção
não deve escrever um quarto regex — deve remover os três que existem.

**Urgência.** Baixa e datada: os 40 clientes atuais têm CNPJ numérico, para o
qual apagar letras não muda o resultado. O defeito está armado e ainda não
disparou; dispara no primeiro cliente alfanumérico.

### Achado B — a troca de Email de Recuperação verifica senha sem trava

`portal-login` e `portal-password-recovery` consultam o rate limit.
`portal-recovery-email-change` (`action: 'request'`) recebe `current_password`,
chama `signInWithPassword` e **não consulta trava nenhuma**.

Quem tiver uma sessão do Portal aberta (navegador compartilhado, notebook
emprestado) testa senha sem limite por esse caminho, contornando as 5 tentativas
do login.

Efeito colateral do mesmo trecho: cada verificação bem-sucedida cria uma sessão
do Supabase Auth que nunca é encerrada — o cliente `verifier` não faz `signOut`.

---

### Task 1: Rate limit volta ao normalizador compartilhado

**Arquivos:** nova migration `supabase/migrations/<n>_rate_limit_portal_normalize_cnpj.sql`

- `CREATE OR REPLACE` nas cinco funções que hoje inlinam o regex:
  `portal_login_check_rate_limit`, `portal_login_register_failure`,
  `portal_login_register_success`, `portal_recovery_check_rate_limit`,
  `portal_recovery_register_failure`.
- Cada uma passa a chamar `public.normalize_cnpj(coalesce(p_login,''))` no lugar
  do `regexp_replace(...,'\D',...)`. Nenhum regex novo.
- Preservar `SECURITY DEFINER`, `search_path` e os `REVOKE` existentes.
- Não alterar as migrations `183`/`191` (arquivo histórico e protegido por hook).

**Nota de dados:** os hashes gravados antes da mudança foram calculados pela
regra antiga e deixam de casar com os novos. Na prática isso zera os contadores
em curso; como a janela é de 15 minutos e o volume atual é nulo, não há
migração de dados a fazer. Registrar isso no corpo da migration.

### Task 2: Trava de tentativas na troca de email

**Arquivos:** `supabase/functions/portal-recovery-email-change/index.ts`

- Antes de `signInWithPassword`, resolver o `login_cnpj` da conta e consultar
  `portal_login_check_rate_limit`; bloqueado devolve 429 sem verificar a senha.
- Falha de verificação chama `portal_login_register_failure`; sucesso chama
  `portal_login_register_success`.
- Reusar o contador de **login**, não criar um terceiro: o objetivo é justamente
  que este caminho não seja uma porta paralela à trava do login.
- Encerrar a sessão criada na verificação (`verifier.auth.signOut()`) para não
  deixar refresh token pendurado a cada troca.

### Task 3: Testes

**Arquivos:** `supabase/functions/__tests__/` (ou equivalente do projeto),
`src/services/__tests__/`

- Contrato da migration: dois CNPJs alfanuméricos que só diferem nas letras
  produzem hashes **diferentes**; CNPJ com e sem máscara produz o **mesmo** hash.
- Troca de email: requisição bloqueada pelo rate limit não chega a verificar
  senha; falha registra tentativa.

### Task 4: Documentação

**Arquivos:** `docs/modules/portal-cliente.md`, `docs/CHANGELOG.md`,
`docs/plans/README.md`

- Catálogo de ações: registrar a trava na troca de email.
- Ao concluir, mover este plano para `docs/archive/plans/` e remover a linha da
  tabela de planos vivos.

---

## Riscos

- **Zerar contadores em curso** (Task 1): aceito, janela de 15 minutos.
- **Reuso do contador de login** (Task 2): um cliente que erre a senha atual na
  troca de email passa a consumir tentativas do próprio login. É o
  comportamento desejado — é a mesma senha e o mesmo alvo —, mas precisa estar
  claro na mensagem de tela.
