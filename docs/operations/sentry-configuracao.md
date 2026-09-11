# Guia de Configuração e Uso do Sentry no Transhipping Desk

Este documento orienta a equipe sobre a integração do **Sentry** com o Transhipping Desk, explicando como os erros são capturados, classificados e como configurar o painel web para receber alertas didáticos e objetivos.

---

## 1. Visão Geral da Observabilidade

O sistema captura falhas em três camadas principais:
1. **Consultas e Ações de Dados (TanStack Query):** Toda busca (`query`) ou gravação (`mutation`) que falha é interceptada e enriquecida com o nome da tela, módulo e tarefa em português.
2. **Erros de Renderização da Tela (React Error Boundary):** Se uma página quebrar ou travar, o Sentry registra o nome da tela e a rota afetada.
3. **Falhas em Segundo Plano (Best-Effort):** Notificações, logs de auditoria e emissões auxiliares que falham sem travar a navegação do usuário.

### Proteção de Dados (LGPD e Privacidade)
Antes do envio para o Sentry, todo payload passa por sanitização automática em [`src/lib/telemetry.ts`](../../src/lib/telemetry.ts):
* Padrões de **CNPJ**, **CPF** e **e-mails** são redigidos.
* Tokens de recuperação e autenticação contidos em URLs são removidos.
* O usuário é identificado apenas por seu ID interno e papel (`user_role`, ex: `administrativo`, `financeiro`).

---

## 2. Ajustes Recomendados no Painel Web do Sentry

Para que as notificações por e-mail e canais de alerta reflitam a identidade do sistema:

### A. Renomear o Projeto de `javascript-react` para `transhipping-desk`
1. Acesse [sentry.io](https://sentry.io) e entre na sua organização.
2. No menu lateral esquerdo, clique em **Settings** > **Projects**.
3. Selecione o projeto atual (que está com o nome padrão `javascript-react`).
4. Em **General Settings** > **Project Name**, altere para: `transhipping-desk`.
5. Clique em **Save Changes**.
* **Impacto imediato:** O assunto dos próximos e-mails virá com `[TRANSHIPPING-DESK]` em vez de `JAVASCRIPT-REACT-XX`.

### B. Configurar Regras de Alerta Inteligentes (Evitar Spam em Testes)
No Sentry, alertas disparados para todo e qualquer erro durante homologação podem sobrecarregar a caixa de entrada. Recomendamos criar uma regra de alerta focada:
1. No menu lateral, acesse **Alerts** > **Create Alert**.
2. Escolha **Issues** (alerta de novas falhas).
3. Em **Set Conditions**:
   * **When:** *A new issue is created* (quando surgir um novo tipo de erro).
   * **If:** *The issue's environment matches `production`* (apenas erros em ambiente produtivo).
   * **And (opcional):** *The event's tags `modulo` is not empty*.
4. Em **Set Actions**:
   * Enviar e-mail para a equipe técnica ou notificação em canal integrado (Slack / Microsoft Teams).
5. Defina um limite de frequência (ex: *Send a notification if an issue occurs more than 5 times in 1 hour* para problemas intermitentes).

---

## 3. Estrutura das Novas Tags Didáticas

A partir desta atualização, todo erro reportado pelo Transhipping Desk inclui tags padronizadas que aparecem tanto no resumo do e-mail quanto no painel do Sentry:

| Tag | Exemplo | Descrição |
|---|---|---|
| `modulo` | `Financeiro`, `Faturamento`, `Operações`, `Viagens`, `Demurrage` | Área do sistema onde ocorreu o problema |
| `tela` | `Conciliação PIX`, `Faturas Locais`, `Painel de BLs` | Nome humanizado da tela em uso |
| `tarefa` | `Listar pendências PIX`, `Listar faturas`, `Buscar candidatos` | Ação ou consulta exata que estava em andamento |
| `categoria_falha` | `Banco de Dados / Regra de Negócio`, `Conectividade / Rede`, `Erro de Código / Runtime` | Natureza técnica simplificada da falha |
| `diagnostico` | Mensagem amigável traduzida (ex: *"Sem permissão para esta ação"*) | Explicação didática do motivo do erro |
| `user_role` | `administrativo`, `financeiro`, `operacoes` | Papel operacional do usuário que disparou a ação |
| `rota` | `/reconciliacao`, `/invoices` | Endereço URL no navegador |

---

## 4. Como Ler um Alerta Após a Atualização

### Exemplo Comparativo:

#### Como chegava antes:
* **Título:** `JAVASCRIPT-REACT-12 - TypeError: Cannot read properties of undefined (reading 'rest')`
* **Tags:** `context: TanStack Query`, `browser: Chrome`
* **Usuário:** *(vazio)*
* **Dificuldade:** Não era possível saber qual tela, qual ação e qual usuário sofreu a falha sem abrir o código minificado.

#### Como chega agora:
* **Tags em Destaque:**
  * `modulo = Financeiro`
  * `tela = Conciliação PIX`
  * `tarefa = Listar pendências PIX`
  * `categoria_falha = Erro de Código / Runtime`
  * `user_role = administrativo`
* **Resumo Didático no evento:** *"Falha ao executar 'Listar pendências PIX' na tela 'Conciliação PIX' (Financeiro)."*
* **Rastreabilidade de Código:** Graças ao `sourcemap: 'hidden'` habilitado no Vite, o Sentry mapeia o arquivo TypeScript original (ex: `Reconciliacao.tsx`) em vez de arquivos compactados.
