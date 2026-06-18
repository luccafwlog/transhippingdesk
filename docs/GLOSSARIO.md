# Glossário de Domínio

Definições dos termos do Transhipping Desk — apenas conceitos, sem implementação. Para arquitetura ver [ARCHITECTURE.md](ARCHITECTURE.md); para regras ver [operations/regras-de-negocio.md](operations/regras-de-negocio.md).

---

## Termos

**Viagem**
Unidade principal de operação. Um navio em uma escala portuária específica.

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento emitido pelo armador que agrupa containers sob um consignatário. Fonte de dados financeiros: consignatário, CNPJ, peso para billing.

**Baplie EDI**
Arquivo EDI (formato EDIFACT) emitido pelo armador com o plano de estiva da viagem. Fonte primária de containers: lista todos os containers fisicamente a bordo com posição (slot), flags operacionais (IMO, OOG) e referência ao B/L do armador.

**Manifesto**
Arquivo do armador (planilha) com dados comerciais dos B/Ls: consignatário, CNPJ, descrição de carga, pesos para faturamento. No fluxo padrão, importado após o Baplie para conciliar e enriquecer os containers já staged.

**Staging Baplie**
Estado intermediário dos containers após importação do Baplie EDI e antes da conciliação com o manifesto. Persiste na tabela `baplie_containers`. Reimport do Baplie substitui o staging anterior da mesma viagem.

**Conciliação Baplie ↔ Manifesto**
Processo de match entre containers do Baplie e containers do manifesto, dentro de uma viagem. Match key: `container_number` + `voyage_id`. `bl_ref` do Baplie é sinal secundário de divergência, não critério de bloqueio.

**Divergência de Existência**
Container presente no Baplie sem B/L correspondente no manifesto. Resultado: aviso ao operador, sem bloqueio de fluxo.

**Divergência de Atributo**
Container presente em ambas as fontes com valor conflitante em campo operacional (status full/empty, IMO, OOG). Resultado: aviso com opção de aceitar valor do Baplie por linha.

**Estado de Conciliação da Viagem**
Sinal derivado que resume, para uma Viagem, o quão pronta para faturamento está sua conciliação de dados. Três níveis: **Divergente** (existe Divergência de Existência ou de Atributo não resolvida) — exige ação; **Incompleto** (falta manifesto, CE Mercante incompleto, ou Baplie ainda em Staging sem conciliação) — aguardando dado; **Conciliado** (tudo conciliado e CEs completos). É leitura, não bloqueio.

**Flags Operacionais**
Campos que o Baplie pode sobrescrever no `bl_containers`: `is_imo`, `imo_class`, `un_number`, `is_oog`, `status` (full/empty). Dados financeiros (consignatário, peso para billing) são protegidos — só o manifesto os define.

**CE Mercante**
Conhecimento Eletrônico no sistema federal Mercante. Identifica a carga declarada. No sistema, `ce_mercante` é registrado por B/L; sua cobertura (quantos B/Ls de um manifesto têm CE preenchido) compõe o estado "Incompleto" da conciliação.

**CE Master**
Número do CE Mercante master de um manifesto — o conhecimento agrupador da carga daquele manifesto, acompanhado para fins de Mercante. Um por manifesto. Distinto dos CEs por B/L.

**Número de Escala (Sistema Mercante)**
Identificador da escala do navio em um terminal, criado no sistema federal Mercante para cobrir um determinado navio/viagem naquele terminal. Uma Viagem que toca múltiplos terminais pode ter mais de um número de escala. É um dado de registro: existir o número significa que a escala foi **criada** no Mercante.

**Vínculo de Manifestos à Escala**
Afirmação de que os manifestos da viagem foram vinculados à escala no Mercante — distinta de a escala ter sido criada. É o significado do indicador "ESCALA" (SIM/NÃO) exibido no Painel/Line-Up: SIM = manifestos vinculados. Não confundir com a existência do Número de Escala.

**CNTR**
Container. Abreviação de domínio usada no sistema.

**IMO**
Carga perigosa classificada pela International Maritime Organization. Flag `is_imo` + classe + número ONU.

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO. Flag `is_oog`.

**Portal do Cliente**
Interface externa, separada do sistema interno, onde um Cliente consulta suas faturas (taxas locais e demurrage), efetua pagamento (PIX) e pode consolidar B/Ls em aberto numa fatura única. Autenticação própria, isolada do acesso operacional interno.

**Conta de Portal**
Vínculo entre um Cliente e uma credencial de acesso ao Portal do Cliente. A credencial canônica é **CNPJ (ou email) + senha**. Um Cliente tem no máximo uma Conta de Portal. Provisionada internamente por um administrador — não há cadastro público.

**Login de Portal**
O cliente pode autenticar-se informando seu **CNPJ** (14 dígitos) **ou** o **email** cadastrado na Conta de Portal. Ambos resolvem para o mesmo registro `auth.users` do Supabase Auth.

**Email de contato**
Endereço para comunicação financeira de um Cliente. É um dado informativo da Conta de Portal e não deve ser confundido com a credencial de login (embora possam coincidir).

**Disputa de Demurrage**
Contestação aberta pelo cliente sobre valores, dias ou condições de uma fatura de demurrage. A disputa é registrada com texto livre no portal e gera alerta para o operador interno responder.

**Notificação In-App**
Alerta visual exibido no ícone de sino no cabeçalho do Portal do Cliente. Gerada por eventos como: nova fatura emitida, container em demurrage, resposta a disputa.

**Dashboard do Portal**
Página inicial do portal (`/portal`) com resumo financeiro (saldo pendente, faturas em aberto), indicadores operacionais (B/Ls, containers, demurrage) e alertas visuais.

**Demurrage**
Cobrança pela retenção de um container além do *free time* acordado. Calculado sobre containers (não sobre B/L), com tabela de tarifas e faixas de dias próprias. Persistência separada das taxas locais.

**Free time**
Período livre de demurrage concedido a partir da descarga/disponibilização do container, antes de a cobrança começar a contar.

**Taxas Locais (Local Charges)**
Cobranças operacionais por B/L (não demurrage): tabelas de tarifas por POD/modal de carga, com possibilidade de override por cliente.

**Ledger Local**
Livro-razão de taxas locais que mantém o saldo a receber por B/L (`bl_receivables`) e as baixas (`ledger_settlements`), ligando invoices individuais e consolidadas aos receivables. Fonte de verdade do saldo local.

**Invoice Consolidada**
Documento único que agrupa múltiplos receivables/B/Ls em aberto de um mesmo cliente. Distinta da invoice individual, que cobre um B/L.

**ROE (Rate of Exchange) / PTAX**
Cotação de câmbio usada para converter cobranças em moeda estrangeira para BRL. Obtida do Banco Central (olinda) e, no caso de demurrage, congelada na emissão da invoice.

**TXID**
Identificador único de uma transação PIX, usado como chave de conciliação entre o extrato recebido e a invoice paga.

**Conta de Escala encerrada (`ended_vessels`)**
Registro de navios/viagens cujo ciclo operacional foi encerrado, usado em telas de schedule/line-up.

