# Glossário de Domínio

Glossário de domínio do Transhipping Desk. Este arquivo define linguagem de
negócio; arquitetura e detalhes técnicos pertencem a `docs/ARCHITECTURE.md` e
aos ADRs.

Verificado em 2026-06-18.

## Operação marítima

**Viagem**
Unidade principal da operação: um navio identificado por número de viagem e
acompanhado em suas escalas, agendas e cargas.

**Escala portuária**
Passagem de uma viagem por um porto ou terminal, com datas operacionais,
identificadores e vínculos documentais próprios.

**Número de Escala do Mercante**
Identificador criado no sistema federal Mercante para uma escala do navio. Uma
viagem com múltiplos terminais pode ter mais de um número de escala.

**Vínculo de Manifestos à Escala**
Confirmação de que os manifestos foram vinculados à escala no Mercante. Não é
sinônimo de o Número de Escala existir.

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento de transporte que agrupa carga sob um consignatário. É a unidade
operacional usada para revisão, cobrança de taxas locais e vínculo com cliente.

**Manifesto**
Arquivo do armador com dados comerciais dos B/Ls, consignatários, documentos,
pesos, cargas e containers. É a autoridade para dados comerciais e financeiros
da carga.

**CNTR**
Abreviação de domínio para container.

**Carga Solta / Breakbulk (BB)**
Carga transportada sem container, representada por itens, peso e volume
vinculados ao B/L.

**RoRo**
Carga rolante, especialmente veículos importados e vinculados a B/L e, quando
aplicável, ao container físico.

**Granito**
Fluxo especializado de importação e cobrança baseado em planilhas COSCO. É
integrado à revisão e ao faturamento, mas mantém regras e registros próprios.

## Baplie e reconciliação

**Baplie EDI**
Arquivo EDIFACT do plano de estiva. É a autoridade para a presença física de
containers, posição a bordo e flags operacionais.

**Staging Baplie**
Estado intermediário dos containers importados do Baplie antes da reconciliação
com o manifesto. Uma reimportação substitui o staging anterior da viagem.

**Conciliação Baplie × Manifesto**
Comparação, dentro da mesma viagem, entre a carga física do Baplie e os dados
comerciais do manifesto.

**Divergência de Existência**
Container presente numa fonte e ausente na outra. Exige visibilidade para o
operador, mas não altera silenciosamente dados comerciais.

**Divergência de Atributo**
Conflito em dado operacional, como status, IMO ou OOG. O operador escolhe qual
fonte prevalece quando a resolução não é automática.

**Estado de Conciliação da Viagem**
Resumo de prontidão dos dados:

- **Divergente:** há conflito ainda não resolvido;
- **Pendente:** falta fonte, CE ou etapa de conciliação;
- **Conciliada:** fontes e CEs necessários estão coerentes.

É um sinal operacional, não autorização financeira isolada.

**Flags Operacionais**
Características físicas da carga, como IMO, classe, número ONU, OOG e status
cheio/vazio. Não incluem consignatário, documento fiscal ou peso de cobrança.

**IMO**
Classificação de carga perigosa segundo a International Maritime Organization.

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO.

## Mercante

**CE Mercante**
Conhecimento Eletrônico registrado por B/L no sistema Mercante. Sua ausência
pode bloquear a visibilidade de dados e documentos no Portal do Cliente.

**CE Master**
Conhecimento agrupador associado ao manifesto. É distinto dos CEs individuais
dos B/Ls.

## Revisão e clientes

**Revisão Operacional**
Etapa humana para resolver cliente, CE, peso, inconsistências de cálculo e
outros dados que impedem o avanço seguro.

**Reconciliação de Cliente**
Vínculo confirmado entre o consignatário importado e o cadastro de Cliente.
Matching automático incerto deve permanecer pendente de decisão humana.

**Cliente**
Pessoa jurídica ou física responsável por cargas e cobranças no sistema.

**Email de Contato**
Canal de comunicação do cliente. Pode coincidir com o email técnico do Portal,
mas os conceitos não são equivalentes.

## Faturamento

**Taxas Locais**
Cobranças ligadas ao B/L, calculadas por tabelas, itens e eventuais regras
específicas do cliente.

**Recebível Local**
Saldo financeiro de taxas locais de um B/L. Pode ser ligado a invoice individual
ou consolidada e liquidado por um ou mais pagamentos.

**Invoice Individual**
Documento financeiro emitido para um único conjunto elegível de cobranças.

**Invoice Consolidada**
Documento que reúne recebíveis de múltiplos B/Ls do mesmo cliente.

**Ledger Local**
Histórico de recebíveis, vínculos com invoices, liquidações e eventos de ciclo
de vida usado para reconstruir saldos de taxas locais.

**Demurrage**
Cobrança pelo período de uso do container além do free time. É calculada a
partir de eventos físicos e permanece em persistência própria.

**Conciliação PIX**
Comparação entre transações recebidas e cobranças emitidas, priorizando TXID e
valor. Casos ambíguos exigem decisão humana.

## Histórico e auditoria

**Histórico (do B/L)**
Linha do tempo completa dos acontecimentos de um B/L: alterações manuais de
campos, mudanças em containers, cálculo e revisão de taxas, e emissão e
pagamento de faturas. É o termo guarda-chuva que abrange a Auditoria — não um
sinônimo dela.

**Auditoria**
Subconjunto do Histórico: as alterações deliberadas registradas com
justificativa (quem mudou o quê, de qual valor para qual, e por quê). Toda
auditoria é um evento do Histórico; nem todo evento do Histórico é uma auditoria
— eventos gerados pelo sistema (ex.: emissão de fatura) não têm justificativa.

## Portal do Cliente

**Portal do Cliente**
Interface externa onde o cliente consulta painel, faturas, B/Ls, containers,
notificações, disputas e perfil.

**Conta de Portal**
Vínculo entre um Cliente e um usuário do Supabase Auth. Um cliente possui no
máximo uma conta ativa provisionada internamente.

**Identificador de Login do Portal**
Valor informado na tela de login: CNPJ, CPF ou email.

**Email Técnico do Portal**
Email associado à conta e usado internamente pelo Supabase Auth. O cliente pode
entrar com documento sem precisar conhecer esse email.

**Sessão do Portal**
Sessão do Supabase Auth isolada da sessão do aplicativo interno no mesmo
navegador.

**Login do Portal**
Resolução do identificador para o email técnico, quando necessário, seguida da
autenticação por senha no Supabase Auth. Não utiliza senha própria em tabela nem
sessão por token legado.

**Dashboard do Portal**
Página inicial com resumo financeiro, indicadores operacionais, programação de
navios e alertas.

**Disputa de Demurrage**
Contestação do cliente sobre valores, dias ou condições de uma cobrança de
demurrage.

**Notificação In-App**
Mensagem exibida no Portal em resposta a eventos financeiros ou operacionais.
