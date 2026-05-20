# CLAUDE.md

Diretrizes para trabalhar neste repositório. Leia antes de implementar qualquer coisa.

---

## O que é este projeto

**Transhipping Desk** é um sistema interno de gestão de operações portuárias de transhipment. Controla viagens, manifestos, B/Ls (conhecimentos de embarque), containers, veículos, faturamento, demurrage, granito e embarque de vazios. Também tem um portal externo para clientes consultarem faturas.

O sistema está em produção. Mudanças mal feitas afetam operações reais.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Estilo | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Roteamento | React Router v7 |
| Estado servidor | TanStack Query v5 |
| Backend/DB | Supabase (Postgres + Auth + RLS) |
| Validação | Zod v4 |
| Testes | Vitest |
| PDF | jsPDF |
| Excel | xlsx |
| PIX | `src/lib/pix.ts` (geração manual de payload) |

Tipos do banco ficam em `src/types/database.ts` — gerados via Supabase CLI, **não edite manualmente**.

---

## Estrutura

```
src/
  pages/          # Uma página por rota, exportada com nome (sem default export)
  components/
    ui/           # Primitivos reutilizáveis: Button, Input, Modal, Badge, Card, Toast
    layout/       # AppLayout, ProtectedRoute, PortalProtectedRoute
    shared/       # Componentes de domínio compartilhados entre páginas
    billing/      # Documento de fatura (taxas locais)
    demurrage/    # Documento de fatura (demurrage)
    lineup/       # Tabela de line-up
  hooks/          # Custom hooks que encapsulam React Query + lógica de domínio
  services/       # Funções puras de acesso ao Supabase e parsers de arquivo
  lib/            # Utilitários sem dependência de UI (formatação, PIX, contadores)
  config/         # Constantes de configuração (ex: dados da empresa)
  types/          # database.ts (gerado) e tipos de domínio
```

Todas as páginas são lazy-loaded via `lazyPage()` em `App.tsx`.

---

## Domínio (glossário)

- **Viagem**: unidade principal de operação — um navio em uma escala.
- **Manifesto / B/L**: conhecimento de embarque importado de arquivos do armador.
- **CNTR**: container; **BB**: break-bulk (carga solta); **Veículo**: ro-ro.
- **Granito**: módulo dedicado para carga de granito (armador COSCO), com tabela de taxas própria.
- **Vazios Exportação** (`/embarquevazios`): embarque de containers vazios saindo.
- **Vazios Importação** (`/vazios-importacao`): devolução de containers vazios na importação.
- **Taxas Locais**: cobranças portuárias sobre B/Ls (THC, BL fee, etc.).
- **Faturamento**: emissão de notas/faturas para clientes sobre taxas locais.
- **Demurrage**: cobrança por tempo de sobreestadia de container.
- **Reconciliação PIX**: conciliação de pagamentos recebidos via PIX com faturas.
- **Revisão**: fila de B/Ls aguardando aprovação manual antes do faturamento.
- **Portal do cliente**: interface separada (`/portal/login`, `/portal/billing`) com autenticação própria.
- **Line Up TV**: tela de painel para exibição em TV no terminal portuário.

A interface e os nomes de variáveis de domínio são em **português**. Código estrutural (funções utilitárias, nomes de arquivo, props de componentes genéricos) fica em **inglês**.

---

## Comandos

```bash
npm run dev          # servidor de desenvolvimento (Vite)
npm run build        # tsc + vite build
npm run lint         # ESLint
npm run test         # Vitest (testes unitários)
npm run test:integration  # testes de integração contra Supabase real (ver abaixo)
```

---

## Configuração de ambiente

Copie `.env.example` para `.env` e preencha:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Sem essas variáveis a aplicação não inicializa (o cliente Supabase loga erro e retorna cliente vazio).

### Testes de integração

Ficam em `src/integration/supabase.integration.test.ts` e rodam contra o Supabase real. São **opt-in**: só executam se `SUPABASE_RUN_INTEGRATION=1`. Requerem credenciais adicionais no `.env` (ver `.env.example`). Nunca rode em CI sem ambiente isolado.

---

## Convenções

- Páginas: exportação nomeada (ex: `export function Faturamento()`), sem default export.
- Hooks: prefixo `use`, retornam dados + mutações do React Query.
- Services: funções puras que recebem o cliente Supabase (ou o importam diretamente) e retornam dados.
- Componentes UI (`src/components/ui/`): sem lógica de domínio, apenas apresentação.
- CSS: Tailwind classes inline; variáveis CSS custom (`--app-border`, `--app-surface`, etc.) definidas em `src/index.css` para theming consistente.
- Temas: controlados por `useVisualTheme` + classes no `<html>`.

---

## Regras de comportamento

### 1. Pense antes de codar

Não assuma. Não esconda confusão. Exponha tradeoffs.

- Declare premissas explicitamente. Se incerto, pergunte.
- Se houver múltiplas interpretações, apresente-as — não escolha silenciosamente.
- Se uma abordagem mais simples existir, diga. Questione quando necessário.
- Se algo não estiver claro, pare. Nomeie a confusão. Pergunte.

### 2. Simplicidade primeiro

Código mínimo que resolve o problema. Nada especulativo.

- Sem features além do que foi pedido.
- Sem abstrações para código de uso único.
- Sem "flexibilidade" que não foi solicitada.
- Se você escreveu 200 linhas e poderia ser 50, reescreva.

### 3. Mudanças cirúrgicas

Toque apenas o necessário. Limpe apenas sua própria bagunça.

- Não "melhore" código adjacente, comentários ou formatação.
- Não refatore o que não está quebrado.
- Mantenha o estilo existente, mesmo que faria diferente.
- Se notar código morto não relacionado, mencione — não delete.
- Remova imports/variáveis/funções que **suas** mudanças tornaram desnecessários.

### 4. Execução orientada a resultado

Defina critério de sucesso. Execute até verificar.

Para tarefas com múltiplos passos, declare um plano breve:
```
1. [Passo] → verificar: [como]
2. [Passo] → verificar: [como]
```

---

## O que não tocar sem contexto explícito

- `src/types/database.ts` — gerado automaticamente pelo Supabase CLI.
- Políticas RLS no Supabase — qualquer mudança afeta segurança de dados em produção.
- `src/lib/pix.ts` — implementação de spec bancária; mudanças requerem validação cuidadosa.
- Testes de integração — não ative `SUPABASE_RUN_INTEGRATION=1` sem ambiente controlado.

---

## Estado atual do projeto

Ver `docs/ROADMAP.md` para o que está em produção, em evolução e no backlog.
