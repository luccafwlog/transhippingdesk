# Rate limit do Portal: voltar ao normalizador compartilhado e cobrir a troca de email

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Fazer o rate limit do Portal usar o mesmo normalizador canônico de CNPJ
do resto do sistema, estender a trava de tentativas à verificação de senha da
troca de Email de Recuperação, parar de consumir o convite de confirmação antes
de saber se há troca pendente para aplicar, fechar a janela em que a sessão
antiga sobrevive à troca de senha, e dar saída à lista de bloqueio de emails —
que hoje só abre para dentro.

**Origem:** grilling de 2026-08-14 sobre o fluxo de login/recuperação (PR #539).
Os achados foram verificados contra o código e o banco de produção; nenhum deles
é regressão da #539.

**Escopo deliberadamente fora da PR #539:** exige migration, cujo risco de deploy
é diferente do restante daquele diff.

---

## Contexto

### Achado A — o hash do rate limit apaga as letras do CNPJ

As cinco funções de rate limit calculam a chave assim:

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

### Task 3: Confirmação não consome o convite antes de saber se há o que confirmar

**Achado C.** Em `action: 'confirm'`, a ordem hoje é: validar o convite → marcar
como `consumido` → ler a conta → devolver 410 se `pending_recovery_email` for
nulo. O convite é queimado no passo 2 para descobrir no passo 3 que não havia
nada a aplicar, e a mensagem devolvida ("Link inválido ou expirado") é falsa: o
link estava válido, quem o destruiu foi a própria chamada.

O caminho que produz isso: `portal_assisted_email_change` (migration `195`)
zera `pending_recovery_email` mas **não invalida os convites
`confirmacao_email` pendentes**. Depois de uma troca assistida, o link
self-service do cliente segue vivo por até 48h e cai exatamente nessa ordem.

**Severidade: baixa, e não é brecha.** A checagem de `pending_recovery_email`
nula é justamente o que impede um convite em trânsito de aplicar troca indevida
— a troca assistida neutraliza o link ao zerar o campo, e um pedido novo
invalida os anteriores. O prejuízo é o cliente pedir a troca de novo sem
entender o porquê.

**Arquivos:** `supabase/functions/portal-recovery-email-change/index.ts`,
nova migration (a mesma da Task 1 ou uma própria)

- Ler a conta e checar `pending_recovery_email` **antes** do UPDATE que consome
  o convite. A corrida continua protegida pelo update condicional
  (`.eq('status','pendente')`), que segue sendo o ponto de serialização — só um
  chamador vence, e o perdedor não queima nada.
- Quando não houver `pending_recovery_email`, devolver mensagem verdadeira
  ("este pedido de troca já foi resolvido"), distinta de link inválido/expirado.
- `portal_assisted_email_change` passa a marcar os convites
  `confirmacao_email` pendentes da conta como `invalidado_por_reenvio`, no mesmo
  UPDATE que zera `pending_recovery_email`. Não deixa link solto em trânsito.

**Amarra ausente, registrada e não corrigida:** o `confirm` nunca compara o
`sent_to_email` do convite com o `pending_recovery_email` que vai aplicar —
aplica o que estiver no campo, venha de qual convite vier. Não foi encontrado
caminho de exploração (o campo sempre guarda o último endereço pedido pelo
próprio cliente), então fica anotado como endurecimento possível, fora deste
plano.

### Task 4: A troca de senha só encerra a sessão antiga depois de até 1 hora

**Achado D.** `portal_revoke_sessions` (migration `194`) apaga `auth.sessions` e
`auth.refresh_tokens`. Isso tira do titular da sessão antiga o direito de
**renovar** o access token, mas não invalida o access token que ele já tem em
mãos: um JWT é aceito pela assinatura, sem consulta ao banco. A janela é o TTL
do token — 1 hora no padrão do Supabase, e este projeto não o altera.

A tela promete encerramento imediato; o banco entrega com atraso.

**Metade disso já está resolvida, e por acidente feliz.** Na *suspensão* a
janela não existe: as RPCs do Portal releem `active` da conta a cada chamada
(`044:44`, `084:40`, `115`), então token válido não serve para nada quando a
conta está desativada. O guard de estado no ponto de leitura é o padrão certo —
falta só um estado a mais para ele vigiar.

Na troca de senha e de email, `active` continua `true` e nada relê "quando esta
credencial mudou", então o token antigo passa em todos os guards até vencer.

**Arquivos:** nova migration, RPCs de leitura do Portal

- Gravar em `customer_portal_accounts` o instante da última invalidação de
  credencial (`credentials_revoked_at`), preenchido por `portal_revoke_sessions`
  ou por quem a chama.
- O guard de sessão do Portal passa a rejeitar token cujo `iat` seja anterior a
  esse marco, no **mesmo ponto** onde hoje checa `active` — não um guard novo por
  RPC. Se o `iat` não estiver acessível via `auth.jwt()` no contexto da RPC,
  registrar a limitação em vez de espalhar checagens.
- Alternativa descartada: reduzir o TTL do access token. Encolhe a janela sem
  fechá-la e cobra tráfego de refresh em todas as telas.

**Urgência: baixa e verificada.** Não há cliente usando o Portal — a única conta
`ativo` é ficha de QA. O defeito está armado e ainda não tem a quem prejudicar.

**Achado E, anexo (higiene de dados, sem correção proposta).** Duas das sessões
vivas em produção pertencem a usuários do Auth com email técnico
`@portal-interno...` que **não têm mais linha em `customer_portal_accounts`**.
Não há vazamento: a RPC busca por `auth_user_id`, não encontra e nega. Mas
desfazer uma conta do Portal não remove o usuário do Auth nem as sessões dele.
Fica registrado; a limpeza não pertence a este plano.

### Task 5: A lista de bloqueio de emails não tem saída

**Achado F.** Sete pontos do código **consultam** `portal_suppressed_emails`
(`portalEmail.ts:30`, `portal-password-recovery:33`, `portal-invite-send:24`,
`portal-recovery-email-change:20`, e as RPCs `187`/`192`/`195`). **Nenhum a
apaga.** Não há rota, RPC nem tela que remova um endereço. O bloqueio é
definitivo, e nem o operador o desfaz.

**Por que isso importa mais do que parece.** Hoje, para resgatar um cliente cujo
endereço foi bloqueado indevidamente, o operador só pode cadastrar um endereço
**diferente**. Para contornar um sinalizador errado, ele grava um dado errado no
cadastro. O sistema empurra o operador a mentir para o registro — o que é pior
que o bloqueio.

E o bloqueio é opinião de terceiro sobre um fato que muda: quem decidiu
"definitivo" foi o Resend, olhando uma tentativa num instante. Caixa cheia,
servidor em manutenção e domínio em migração produzem o mesmo sintoma de
endereço morto.

**Arquivos:** nova migration, console de provisionamento do Portal

- RPC administrativa que remove o endereço da lista, restrita a operador,
  gravando **quem liberou e por quê** via `_portal_log_event`. Desbloquear
  reexpõe o domínio a bounces; se virar hábito, o registro é o que mostra.
- Ação correspondente no console, ao lado do cliente afetado.
- **Alternativa descartada — expirar o bloqueio sozinho após N dias.** O sistema
  não tem como saber que a caixa voltou; só pode chutar um prazo e voltar a
  enviar para o vazio, gastando reputação do domínio. Quem sabe que voltou é o
  operador, porque o cliente ligou. Falta o lugar de registrar, não o prazo.

### Task 6: Conta ativa com Email de Recuperação quebrado não mostra sinal

**Achado G.** O webhook só rebaixa a situação da conta quando ela está em
`convite_pendente` (`portal-email-webhook:29`). Uma conta **ativa** cujo Email de
Recuperação sofre bounce permanente continua `ativo`, e a recuperação de senha
devolve `accepted()` em silêncio ao ver o endereço bloqueado
(`portal-password-recovery:33`) — correto contra enumeração, mas o cliente lê
"enviamos um link" e espera por um email que o sistema já sabia que não sairia.
O único sinal é um alerta na fila.

**O sinal precisa de campo próprio, não do `account_situation`.**
`account_situation` é enum de valor único e `ativo`/`falha_no_envio` são
excludentes (`178:11`). Marcar `falha_no_envio` numa conta ativa afirmaria que
ela não está ativa — e está: o cliente continua entrando com a senha. Além
disso, o console oferece "Revisar email e reenviar" para esse estado
(`PortalReviewPanel.tsx:132`), ação de convite, errada para quem já é cliente.
São dois fatos independentes — *a conta funciona* e *o email de recuperação
quebrou* — e a coluna única faz um apagar o outro.

**Arquivos:** nova migration, `portal-email-webhook`, console de provisionamento

- Coluna própria em `customer_portal_accounts` (`recovery_email_status`, ou
  equivalente) marcada pelo webhook em bounce permanente, **sem** tocar em
  `account_situation`.
- Console mostra o sinal junto do cliente, não só na fila de alertas.
- **Anexo, achado H:** `alerts` não tem restrição de unicidade (`001:24`) e o
  webhook insere sem checar, então cada bounce do mesmo endereço abre mais um
  alerta. Deduplicar por `type` + `entity_id` + `status='open'`.

### Task 7: Testes

**Arquivos:** `supabase/functions/__tests__/` (ou equivalente do projeto),
`src/services/__tests__/`

- Contrato da migration: dois CNPJs alfanuméricos que só diferem nas letras
  produzem hashes **diferentes**; CNPJ com e sem máscara produz o **mesmo** hash.
- Troca de email: requisição bloqueada pelo rate limit não chega a verificar
  senha; falha registra tentativa.
- Confirmação sem `pending_recovery_email` **não** consome o convite e devolve a
  mensagem de pedido já resolvido; o convite segue `pendente` depois da chamada.
- Troca assistida invalida os convites `confirmacao_email` pendentes da conta.
- Token emitido antes da última troca de credencial é recusado pelo guard de
  sessão do Portal; token emitido depois passa.
- Liberar um endereço da lista de bloqueio permite envio de novo e deixa rastro
  de quem liberou.
- Bounce permanente em conta **ativa** marca o sinal do email sem alterar
  `account_situation`, e um segundo bounce do mesmo endereço não abre um
  segundo alerta.

### Task 8: Documentação

**Arquivos:** `docs/modules/portal-cliente.md`, `docs/CHANGELOG.md`,
`docs/plans/README.md`

- Catálogo de ações: registrar a trava na troca de email e a nova mensagem de
  "pedido já resolvido" na confirmação.
- Ao concluir, mover este plano para `docs/archive/plans/` e remover a linha da
  tabela de planos vivos.

---

## Riscos

- **Zerar contadores em curso** (Task 1): aceito, janela de 15 minutos.
- **Reordenar o consumo do convite** (Task 3): a proteção contra confirmação
  dupla deixa de vir da ordem e passa a vir só do update condicional, que já era
  o ponto de serialização real. Cobrir com teste antes de mudar.
- **Reuso do contador de login** (Task 2): um cliente que erre a senha atual na
  troca de email passa a consumir tentativas do próprio login. É o
  comportamento desejado — é a mesma senha e o mesmo alvo —, mas precisa estar
  claro na mensagem de tela.
- **Liberar endereço bloqueado** (Task 5): reenviar para uma caixa que de fato
  morreu gasta reputação de envio do domínio. O rastro de quem liberou é o que
  torna o custo visível; sem ele, o botão vira hábito.
- **Guard por `iat`** (Task 4): relógios do emissor e do banco precisam estar
  alinhados, senão a comparação derruba sessão legítima recém-criada. Dar folga
  de alguns segundos no marco e cobrir com teste o token emitido logo depois da
  troca.
