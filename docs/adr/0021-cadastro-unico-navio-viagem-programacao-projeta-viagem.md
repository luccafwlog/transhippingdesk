# 0021 — Cadastro único de navio/viagem: Programação de Navios projeta a Viagem

Status: aceito — 2026-07-09 · **proposto** (a implementar)

## Contexto

O operador cadastra o mesmo navio/viagem em dois ambientes distintos e
desconexos:

- **Tela Viagens** — cria a `voyage` (com armador, navio, número de viagem,
  status) e sua **Rota da Viagem**: POL com ETD e POD com ETA/ETB/ATA/ATD,
  persistidos como schedules (`voyage_pol_schedule` / `voyage_pod_schedule`).
  É o registro que alimenta manifestos, B/Ls, Baplie, faturamento e Line-Up TV.
- **Tela Chegadas e Saídas** — grava em `vessel_schedules`, uma tabela isolada
  com **colunas fixas por porto** (ETDs de Qingdao/Shanghai/Taicang/Ningbo/
  Nansha e ETAs de Salvador/Vitória/Pecém) em **texto livre** (`"22/01/2026"`,
  `"22/01"` sem ano, ou `"X"`), ordenação manual e arquivamento em
  `ended_vessels`. Alimenta apenas o widget "Programação de Navios" do Portal.

Não há vínculo entre os dois: nem `voyage_id`, nem navio compartilhado. O mesmo
navio é digitado duas vezes, e os dados podem divergir. A rota que o operador
informa em Chegadas e Saídas é **a mesma rota operacional** que se refletirá em
manifestos e B/Ls — ou seja, é informação de primeira classe sendo desperdiçada
num quadro puramente visual.

## Decisão

**Cadastrar em Chegadas e Saídas passa a ser cadastrar a Viagem.** A
Programação de Navios do Portal deixa de ter fonte própria e passa a **projetar
a Viagem**.

- O formulário de Chegadas e Saídas grava diretamente em `voyages` + POL/POD
  schedules. `vessel_schedules`/`ended_vessels` deixam de ser fonte da verdade.
- **Datas exigidas via seletor (ISO, com ano).** O texto livre e o `"22/01"`
  sem ano são aposentados. O antigo `"X"` vira o estado explícito **"não
  escala"**: porto sem data **não entra na rota** (não gera POL/POD schedule).
- **Identidade e deduplicação:** ao salvar, o sistema procura viagem existente
  por **número da viagem + navio (IMO; fallback nome normalizado)**. Se existir
  (criada na tela Viagens ou nascida de import de manifesto), **anexa** — liga a
  flag "exibir no Portal" e completa POL/POD faltantes — em vez de criar
  duplicata. Se não existir, cria nova.
- **Escopo de sobrescrita:** um salvamento vindo de Chegadas e Saídas toca
  **apenas ETD (por POL) e ETA (por POD)**. ATA, ATD, RTW, status de CE e
  `linked` — dados reais/operacionais e do manifesto — **nunca** são
  sobrescritos. Em conflito de ETD/ETA, a digitação nova vence.
- **Quadro do Portal:** mantém **colunas-vitrine fixas** dos portos conhecidos,
  definidos por uma **constante única compartilhada** (governa colunas do
  Portal, campos do formulário e template do upload em lote). Cada viagem é
  projetada sobre essa grade. Exibe as viagens com a flag **"exibir no Portal"**
  (default ligado para viagens criadas via Chegadas e Saídas; desligado para
  viagens manuais/internas). **Ordenação automática por ETA** (sem setas
  manuais). A viagem **sai do quadro** ao ficar `completed` (todos os ATDs
  preenchidos) ou quando o operador desliga a flag.
- **Armador:** assumido como default (Cosco Shipping Specialized Carriers /
  CSSC) silenciosamente; sem campo no formulário. Viagem de outro armador nasce
  pela tela Viagens.
- A **tela Viagens** ganha os campos de POL/ETD hoje ausentes, para cobrir
  rotas diversas do serviço padrão.
- O **upload em lote por planilha** é mantido, reescrito para alimentar as
  viagens (casar navio+VOY, atualizar ETD/ETA no mesmo escopo).

Não há migração de dados: o conteúdo atual de `vessel_schedules` em produção é
de teste.

## Alternativas consideradas

- **(B) Duas tabelas com vínculo `voyage_id` e botão "Promover".** Chegadas e
  Saídas mantém tabela própria; promover copia os dados para uma viagem. Rejeitada:
  a partir da promoção existem dois registros que divergem (editar ETA no Portal
  não mexe na Viagem), reintroduzindo o retrabalho que a mudança visa eliminar —
  a menos de sincronização bidirecional, complexa e frágil.
- **(C) Chegadas cria a viagem, mas `vessel_schedules` permanece como tabela de
  apresentação espelhada por trigger.** Rejeitada: mantém espelhamento a
  sincronizar sem benefício sobre projetar a viagem diretamente na leitura.
- **Lista de portos-vitrine como tabela configurável no banco.** Rejeitada por
  ora (YAGNI): a rota do serviço é estável; uma constante versionada já elimina a
  duplicação atual (hoje repetida em três lugares).

## Consequências

- **Positivas**: o navio é inserido uma única vez; uma só fonte da verdade,
  sem divergência entre Portal e operação; a rota informada no Portal já habilita
  manifestos/B/Ls; ordenação e ciclo de vida herdados da viagem eliminam a
  curadoria manual (setas, `ended_vessels`) que hoje envelhece o quadro.
- **Negativas / custos**: o widget do Portal precisa ser reprojetado sobre
  `voyages` (leitura), incluindo a projeção sobre a grade de portos fixos e a
  flag "exibir no Portal"; perde-se a ordenação manual do Portal (mitigado pela
  ordenação por ETA); o formulário de Chegadas e Saídas passa a exigir datas
  completas, um passo a mais para o operador; a deduplicação por VOY+IMO precisa
  tratar o fallback por nome com cuidado para não anexar à viagem errada.
