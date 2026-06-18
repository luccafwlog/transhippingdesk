# Validação do Transhipping Desk

Roteiro executável para o estado verificado em 2026-06-18.

O objetivo não é apenas provar que a tela abre. Cada fluxo deve registrar o
ambiente, a identidade usada, os dados de entrada, o resultado e uma evidência
reproduzível.

## 1. Gates técnicos

### Preparação reproduzível

```powershell
npm ci --legacy-peer-deps
```

### Gate padrão

```powershell
npm run docs:check
npm run lint
npm test
npm run build
```

Registre exit code e resumo. Não copie contagens antigas de testes para
documentos vivos.

### Integração Supabase

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Use somente projeto ou branch de banco controlado. A suíte requer as variáveis
`SUPABASE_*` descritas em `.env.example`.

## 2. Níveis de ambiente

### Local sem Supabase real

Adequado para:

- documentação, lint, TypeScript e bundle;
- testes unitários e de componentes;
- parsers e fixtures;
- revisão estática de migrations;
- navegação sem validar persistência.

Não prova Auth, RLS, grants, RPCs, Edge Functions ou email.

### Supabase controlado

Obrigatório para:

- autenticação interna e do Portal;
- RLS e roles;
- migrations e funções;
- imports persistidos;
- faturamento, ledger, PIX e Demurrage;
- notificações, disputas e perfil;
- Edge Functions;
- qualquer teste destrutivo.

Prefira projeto descartável ou branch de banco. Identifique fixtures por prefixo
de QA e não misture com produção.

### Produção

Use apenas para smoke não destrutivo e validação operacional autorizada. Registre
data, usuário e entidades consultadas. Não execute reset, exclusão ampla, seed
ou mudança exploratória.

## 3. Modelo de evidência

Para cada fluxo:

```text
Ambiente:
Commit/build:
Data e hora:
Usuário e perfil:
Dados/fixture:
Passos executados:
Resultado esperado:
Resultado observado:
Evidência:
Limpeza:
```

Falha encontrada deve incluir rota, entidade, mensagem visível, console/rede
quando relevante e condição para reprodução.

## 4. Login interno e permissões

**Ambiente:** Supabase controlado.

1. Entre em `/login` com usuário ativo.
2. Confirme redirecionamento para `/painel`.
3. Valide menu e rotas para cada perfil disponível.
4. Tente abrir `/admin/usuarios` com usuário não administrativo.
5. Desative um usuário de QA e confirme bloqueio de sessão ou novo login.
6. Espere ou simule expiração quando o fluxo de sessão for alterado.

**Esperado:** navegação respeita perfil e o banco não retorna dados proibidos
mesmo quando a API é chamada diretamente.

## 5. Viagens e master-detail

**Ambiente:** Supabase controlado.

1. Crie uma viagem de QA em `/viagens`.
2. Confirme seleção no rail e URL `/viagens/:voyageId`.
3. Recarregue o deep link e confirme a mesma viagem.
4. Abra um ID inexistente e valide estado recuperável.
5. Edite agendas POL/POD, Número de Escala e vínculo de manifestos.
6. Confira CE Master, cards de módulo e linha do tempo.
7. Valide filtros, painel recolhido e viewport estreita.

**Esperado:** rota e seleção permanecem sincronizadas; erro de ID não derruba o
shell; eventos aparecem em ordem coerente.

## 6. Importações

### Ordem integrada recomendada

1. criar viagem;
2. importar Baplie;
3. importar manifesto CNTR;
4. resolver divergências Baplie × Manifesto;
5. importar veículos;
6. importar CE Mercante e datas quando aplicável;
7. revisar B/Ls;
8. calcular e faturar.

Fixtures relacionadas: [`test-fixtures/README.md`](../test-fixtures/README.md).

### Baplie

- arquivo válido cria staging da viagem;
- reimportação substitui somente o staging da mesma viagem;
- IMO/OOG/posição e POL/POD são preservados;
- vazios de importação são criados quando aplicável;
- arquivo vazio, inválido ou grande demais falha antes de persistir.

### Manifesto CNTR

- preview informa B/Ls, containers e erros;
- importação transacional não deixa lote parcial;
- duplicidade e hash seguem o contrato;
- cliente incerto entra em reconciliação;
- bloqueio de cliente não é sobrescrito por “sem tabela”;
- reconciliação com Baplie expõe divergências.

### Carga solta

- itens, peso, volume e B/L são importados;
- cabeçalhos alternativos cobertos por fixture continuam reconhecidos;
- faturamento usa `cargo_mode` correto.

### Veículos

- preview valida chassi, B/L e container;
- importação transacional não deixa linhas parciais;
- reenvio não duplica veículos;
- resultado pós-persistência é visível.

### Granito

- planilha COSCO gera manifesto, B/Ls e cobranças;
- revisão combina Granito com a fila comum sem perder origem;
- invoice e Portal exibem vínculo correto.

### Vazios

- Vazios de Importação aceitam Baplie e planilha;
- Vazios de Exportação importam bookings;
- rotas e viagens corretas são preservadas;
- reimportações não cruzam manifestos.

## 7. Revisão e auto-faturamento

**Ambiente:** Supabase controlado.

Prepare B/Ls com:

- cliente ausente;
- match por nome;
- CE ausente;
- peso ou cobrança pendente;
- B/L elegível completo.

Passos:

1. abra `/revisao`;
2. use filtros e contagens;
3. corrija cliente no modal;
4. salve justificativa quando exigida;
5. confirme tentativa automática de cálculo/emissão;
6. valide mensagem de invoice emitida ou bloqueio restante;
7. recarregue a fila e confira o estado;
8. repita com Granito, que mantém o comportamento próprio.

**Esperado:** nenhum B/L avança silenciosamente com dados incertos; B/L comum
com todos os gates satisfeitos pode emitir automaticamente.

## 8. Guard de faturabilidade

Valide diretamente a RPC e pela UI:

1. tente marcar pronto um B/L sem linha BRL positiva;
2. tente com linhas zeradas, negativas ou inelegíveis;
3. tente com linha positiva elegível;
4. confirme status, motivo de bloqueio e ausência/presença de invoice.

**Esperado:** `ready_for_billing` só é alcançado com valor faturável real.

## 9. Taxas locais e invoices

### Tabelas e overrides

- crie tabela de QA com vigência e POD definidos;
- adicione itens BRL e, quando aplicável, USD;
- valide override de cliente;
- confirme que vigências e prioridades selecionam a tabela esperada.

### Validação financeira

- recalcule B/L selecionado;
- confirme atualização imediata de linhas, subtotal e bloqueio;
- marque cobranças revisadas;
- marque pronto e emita invoice individual;
- emita consolidada com múltiplos recebíveis;
- confira breakdown e vínculo de B/Ls.

### Documento

- abra invoice local com um item;
- abra invoice com itens suficientes para múltiplas páginas;
- confira empresa, cliente, referência operacional, itens, total, vencimento e
  QR PIX;
- use “Imprimir” e valide o preview;
- teste o QR com payload de QA, sem efetuar pagamento real.

## 10. Ledger, pagamentos e reversões

Valide:

- pagamento integral;
- pagamento parcial;
- novo pagamento que liquida saldo;
- valor acima do saldo e tratamento de reembolso;
- reversão com justificativa;
- invoice consolidada obsoleta sem pagamento;
- bloqueio de obsolescência com pagamento;
- reemissão e links antigos marcados corretamente.

Confira `invoices`, `bl_receivables`, `invoice_receivable_links`,
`ledger_settlements`, `payments` e `invoice_lifecycle_events`.

**Esperado:** saldo é reconstituível e estados de B/L, invoice e recebível
permanecem coerentes.

## 11. Demurrage

Prepare containers:

- dentro do free time;
- vencido e ainda não devolvido;
- devolvido com valor;
- devolução anterior à descarga.

Valide:

1. cálculo por equipamento e faixa;
2. rejeição da ordem de datas inválida;
3. desconto e edição controlada;
4. emissão, impressão, cancelamento e pagamento;
5. aparição em `/faturamento` e no Portal.

## 12. Conciliação PIX

Use extrato de QA com:

- TXID e valor exatos;
- valor divergente;
- TXID repetido;
- invoice já paga;
- cobrança local e Demurrage.

Passos:

1. importe em `/reconciliacao`;
2. confira matches e motivos;
3. confirme somente linhas seguras;
4. valide resultado por item;
5. confira propagação em invoice, recebível, B/L e Demurrage;
6. teste reversão quando aplicável.

**Esperado:** ambiguidade não é confirmada automaticamente e falha parcial não
é apresentada como sucesso total.

## 13. Portal do Cliente

### Provisionamento e login

1. provisione conta pela ficha do cliente;
2. entre por email;
3. saia e entre por CNPJ;
4. repita por CPF para cliente compatível;
5. use identificador ou senha inválidos;
6. ultrapasse o limite apenas em ambiente descartável;
7. confirme mensagem genérica e rate limit;
8. valide coexistência com uma sessão interna no mesmo navegador.

### Recuperação de senha

1. abra `/portal/esqueci-senha`;
2. solicite por email e documento;
3. confirme resposta que não enumera conta;
4. abra `/portal/recuperar-senha` pelo link;
5. defina nova senha e entre novamente.

### Dashboard

- saldos e contadores batem com o cliente;
- vencimentos próximos usam dia de calendário;
- alertas e programação de navios carregam;
- cliente não vê dados de outro cliente.

### Faturas

- filtros alteram lista e exportação;
- abas local e Demurrage exportam o conjunto visível;
- detalhe, PIX e consolidada funcionam;
- consolidada sem CEs completos permanece oculta;
- obsolescência respeita propriedade, estado e pagamentos.

### B/Ls e containers

- `/portal/operacao` exibe somente dados do cliente;
- filtro “Todos devolvidos” exige todos os containers devolvidos;
- B/L sem CE Mercante permanece oculto;
- exportações respeitam filtros.

### Notificações, disputas e perfil

- nova invoice gera notificação;
- sino marca leitura e permite fechar quando previsto;
- disputa de Demurrage cria registro e alerta interno;
- resposta aparece ao cliente;
- edição de perfil atualiza somente campos permitidos.

## 14. Programação de navios

Em `/chegadas-saidas`:

1. adicione navio de QA;
2. edite datas e ordem;
3. baixe o modelo;
4. atualize por planilha;
5. confira o widget no Portal;
6. encerre o navio e exporte o histórico;
7. valide exclusão permanente somente com dado de QA.

**Esperado:** ordem e datas persistem e o Portal reflete a programação.

## 15. Admin, alertas, relatórios e Line Up

- `/admin/usuarios`: alterar role/active de usuário de QA e revalidar acesso;
- `/alertas`: reconhecer e fechar alerta sem perder vínculo;
- `/relatorios`: testar abas e arquivos exportados;
- `/line-up-tv`: validar administração;
- `/line-up-tv/display`: validar legibilidade e atualização;
- confirmar ausência de dados técnicos crus em labels.

## 16. Redirecionamentos

Confirme:

- `/vazios` → `/embarquevazios`;
- `/demurrage/invoices` → `/demurrage`;
- `/demurrage/reconciliacao` → `/reconciliacao`;
- rota desconhecida → `/painel`.

## 17. Limpeza

O reset amplo está suspenso. Para fixtures:

- use prefixos de QA;
- registre IDs criados;
- remova pelo produto ou por SQL revisado para a fixture;
- confira dependências financeiras antes de excluir;
- nunca execute `supabase/scripts/reset_operational_data.sql`.

Consulte [`RESET_AMBIENTE.md`](./RESET_AMBIENTE.md).

## 18. Critério de pronto

Uma mudança está pronta quando:

- o teste focado reproduziu e protege o comportamento;
- gates técnicos aplicáveis passaram;
- fluxo com Supabase real foi validado quando necessário;
- evidência e limpeza foram registradas;
- documentação viva e ADRs foram atualizados;
- riscos residuais foram explicitados.
