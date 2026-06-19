---
name: Security Audit & Penetration Testing
description: Complete security audit and penetration testing framework with 6 phases, from discovery to final reporting with automated penetration tests and remediation validation.
trigger_phrases:
  - security audit
  - penetration test
  - pentest
  - vulnerability scan
  - security check
  - verifique vulnerabilidades
  - faça uma auditoria
  - teste de penetração
version: "1.0"
category: Security
author: Claude Security Framework
---

# 🛡️ Security Audit & Penetration Testing Framework

## O Que Faz Esta Habilidade

Uma **auditoria de segurança completa e automática** que identifica vulnerabilidades, cria plano de remediação com sua aprovação, executa testes de penetração validando cada fix, e gera relatório profissional.

**Em 6 fases:**
1. 🔍 Discovery - Mapeia projeto automaticamente
2. 📋 Resources - Consolida riscos aplicáveis
3. 🔎 Audit - Inspecciona código profundamente
4. 📊 Plan - Estrutura remediações (aguarda sua aprovação)
5. 🧪 Testing - Testes de penetração antes/depois
6. 📄 Report - Relatório profissional final

---

## Como Usar

### Triggers Automáticos
```
"Faça uma auditoria de segurança do /home/user/projeto"
"Execute penetration test em /path/to/api"
"Vulnerability scan completo"
"Security check do código"
"Verifique vulnerabilidades em /home/user/app"
```

### Exemplo Completo
```
FASE 1: Discovery
├─ Detecta: Node.js, Express, PostgreSQL
├─ Mapeia estrutura do projeto
└─ Identifica riscos preliminares

FASE 2: Resources
├─ Cria audit-resources.md
├─ Consolida riscos por severidade
└─ 🔴 3 CRÍTICOS, 🟠 4 ALTOS, 🟡 5 MÉDIOS

FASE 3: Audit
├─ Análise estática de código
├─ Scan de dependências (CVE)
└─ 12 vulnerabilidades documentadas

FASE 4: Remediation Plan
├─ O QUÊ: correção específica
├─ POR QUÊ: justificativa de segurança
├─ ONDE: localização exata
├─ COMO: passos técnicos
└─ ❓ "Devo prosseguir com 12 mudanças?"

FASE 5: Penetration Testing
├─ Testes ANTES (prova vulnerabilidade)
├─ Aplica remediações
└─ Testes DEPOIS (prova fix funciona) ✅

FASE 6: Final Report
├─ Relatório Markdown profissional
├─ Status de mitigação: 100%
└─ Assinado com timestamp
```

---

## Fluxo de Execução

### ✅ FAZER
- ✅ Usar path absoluto: `/home/user/project`
- ✅ Revisar plano antes de confirmar
- ✅ Testar em staging antes de produção
- ✅ Ler relatório final completamente
- ✅ Manter histórico de auditorias

### ❌ EVITAR
- ❌ Aprovar remediações cegamente
- ❌ Ignorar vulnerabilidades CRÍTICAS
- ❌ Deploy direto em produção
- ❌ Descartar relatórios
- ❌ Deixar dependências velhas

---

## Padrões de Segurança Referenciados

- **OWASP Top 10 2023** - Vulnerabilidades mais críticas
- **CWE/SANS Top 25** - Fraquezas comuns de engenharia
- **CVSS v3.1** - Scoring de severidade
- **NIST Cybersecurity Framework** - Boas práticas
- **ISO/IEC 27001** - Segurança da informação

---

## Severidade (Prioridade)

| Nível | Descrição | Prazo |
|-------|-----------|-------|
| 🔴 CRÍTICO | RCE, SQL Injection, Auth Broken | HOJE |
| 🟠 ALTO | XSS, CSRF, Weak Crypto | DIAS |
| 🟡 MÉDIO | Misconfig, Info Disclosure | SEMANAS |
| 🔵 BAIXO | Headers faltando, deps antigas | MÊS |

---

## Capacidades

### Descoberta Dinâmica
- Detecta automaticamente linguagem/framework
- Identifica riscos relevantes ao tipo de projeto
- Sem necessidade de configuração manual

### Análise Profunda
- Análise estática de código
- Scan de dependências (CVEs)
- Inspeção de configurações
- Validação contra OWASP Top 10

### Aprovação Explícita
- **Nunca muda nada sem sua aprovação**
- Apresenta plano estruturado
- Aguarda confirmação clara: "Sim, prossiga"

### Testes Validados
- Testes de penetração ANTES (prova vulnerabilidade)
- Testes de penetração DEPOIS (prova fix)
- 100% de confiança em mitigação

### Relatório Profissional
- Documento Markdown estruturado
- Cada achado documentado completo
- Assinado com timestamp e hash
- Pronto para compliance

---

## Saídas Esperadas

### Fase 1: Discovery
- Estrutura do projeto
- Linguagens/frameworks detectados
- Riscos preliminares categorizados

### Fase 2: Resources
- `audit-resources.md` criado
- Riscos por severidade (CRÍTICO, ALTO, MÉDIO, BAIXO)
- Documento centralizado para referência

### Fase 3: Audit
- Lista detalhada de vulnerabilidades
- Localização exata (arquivo:linha)
- Descrição técnica completa
- Impacto potencial

### Fase 4: Plan
- **Aguarda sua aprovação explícita**
- Estrutura: O QUÊ, POR QUÊ, ONDE, COMO
- Priorizado por severidade
- Tempo estimado por remediação

### Fase 5: Tests
- ✅ Todos os testes PASSANDO
- Antes: prova vulnerabilidade
- Depois: prova fix funciona
- Funcionalidade legítima preservada

### Fase 6: Report
- Relatório profissional final
- Resumo executivo
- Cada achado documentado
- Status: 100% mitigado ou parcial
- Recomendações contínuas

---

## Restrições & Limitações

- 🔒 Sem acesso a sistemas em produção (análise local)
- 📍 Scope limitado aos arquivos acessíveis
- ✍️ Sem exploit ativo contra produção
- 🔑 Requer aprovação explícita para mudanças
- 🌐 Pesquisas limitadas a dados públicos

---

## Integração Recomendada

### CI/CD Pipeline
```yaml
- name: Security Audit
  run: claude "Security audit do /github/workspace"
```

### Pre-commit Hook
```bash
claude "Verifique segurança dos arquivos staged"
```

### Standalone
```bash
claude "Faça auditoria de segurança em /path/to/project"
```

---

## Tempo Estimado

| Fase | Tempo | Atividade |
|------|-------|-----------|
| 1-3 | 5-10 min | Descoberta & análise |
| 4 | 2 min | Sua aprovação |
| 5 | 10-15 min | Testes & remediação |
| 6 | 2 min | Relatório final |
| **TOTAL** | **20-35 min** | **Fim a fim completo** |

---

## Próximas Versões

- **v1.1:** Integração SonarQube, Dashboard
- **v1.2:** Compliance frameworks (SOC2, HIPAA, PCI-DSS)
- **v2.0:** AI-powered suggestions, Real-time monitoring

---

## Exemplo Prático Resumido

```
👤: "Auditoria de segurança em /home/user/api"

🔍 FASE 1 (Discovery):
   ✓ Node.js/Express detectado
   ✓ PostgreSQL, JWT identificados
   ✓ 12 vulnerabilidades potenciais

📋 FASE 2-3 (Resources & Audit):
   ⚠️ SQL Injection em getUserByName()
   ⚠️ Brute force em login()
   [+ 10 mais achados...]

📊 FASE 4 (Plan):
   "Devo prosseguir com 12 mudanças?"

👤: "Sim"

🧪 FASE 5 (Testing):
   ✅ SQL Injection: ANTES vulnerável → DEPOIS seguro
   ✅ Brute Force: ANTES passável → DEPOIS bloqueado
   [12/12 testes PASSANDO]

📄 FASE 6 (Report):
   SECURITY AUDIT REPORT - maritime-api
   ✓ 12 vulnerabilidades encontradas
   ✓ 12 vulnerabilidades mitigadas
   ✓ 100% de sucesso
   ✓ Pronto para produção
```

---

## Documentação Completa

Para documentação detalhada, veja:
- **security-audit-skill.md** - Habilidade principal (20KB)
- **security-audit-examples.md** - Exemplos práticos (15KB)
- **INTEGRATION-GUIDE.md** - Integração em CI/CD (15KB)
- **README-PT-BR.md** - Sumário executivo (13KB)
- **QUICK-REFERENCE.md** - Card de referência rápida (7KB)

---

## Status

✅ **PRONTO PARA PRODUÇÃO**
- 6 fases completas
- Documentação profissional
- Exemplos práticos
- Testes validados
- Versão: 1.0
- Data: 17 de Maio de 2026

**Uso imediato: Nenhuma configuração necessária.**

---

## 🛡️ Mantenha Seus Sistemas Seguros!

Esta habilidade oferece segurança completa, documentada e validada para qualquer tipo de projeto.

Use agora mesmo!
