# CONTEXT.md

Glossário de domínio do Transhipping Desk. Apenas definições — sem implementação.

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

**Flags Operacionais**
Campos que o Baplie pode sobrescrever no `bl_containers`: `is_imo`, `imo_class`, `un_number`, `is_oog`, `status` (full/empty). Dados financeiros (consignatário, peso para billing) são protegidos — só o manifesto os define.

**CNTR**
Container. Abreviação de domínio usada no sistema.

**IMO**
Carga perigosa classificada pela International Maritime Organization. Flag `is_imo` + classe + número ONU.

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO. Flag `is_oog`.
