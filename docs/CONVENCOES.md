# Convenções da documentação

## Formato e estilo

- Arquivos em `kebab-case.md`, prosa em **português técnico**, termos de domínio em inglês (BL, invoice, manifest, demurrage, ledger, PIX).
- Diagramas em **Mermaid**.
- Caminhos de código escritos como `src/services/billing.ts` (clicáveis).
- Links internos **relativos**.
- Datas só no nome de arquivos em `archive/` e nos ADRs.

## Estrutura dos módulos

Cada doc de módulo usa estes sete blocos nesta ordem:

1. `## Propósito e escopo`
2. `## Anatomia das telas`
3. `## Catálogo de ações`
4. `## Estado e dados`
5. `## Fluxos e invariantes`
6. `## Testes e validação`
7. `## Notas e divergências`

## Labels de evidência

Afirmações técnicas são calibradas por tipo de prova, da mais forte para a mais fraca:

| Label | Quando usar |
|---|---|
| **Código** | A afirmação é verificável por leitura estática do código-fonte |
| **Teste** | Existe um teste automatizado que cobre a afirmação |
| **Runtime** | A afirmação foi verificada em ambiente real (produção ou staging) |
| **Suspeita** | A afirmação não foi verificada — é uma hipótese ou risco conhecido |

Inspeções textuais de migrations devem ser nomeadas **Teste de contrato SQL**, não `Teste`.

## Catálogo de ações

Toda ação catalogada num módulo deve expor esta estrutura de tabela:

```
| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
```

## Histórico vs arquivo

- Arquivos em `docs/` são **documentação viva** — devem refletir o estado atual do sistema.
- Arquivos em `docs/archive/` são **registros históricos** — não devem ser alterados, apenas consultados.
- Plans e specs concluídos vão para `docs/archive/superpowers/plans/` e `docs/archive/superpowers/specs/`.
