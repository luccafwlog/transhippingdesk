# Caixa de ferramentas (`scripts/`)

Esta pasta guarda **comandos auxiliares** do projeto — pequenos programas que
automatizam tarefas chatas (sincronizar o Git, montar um banco de dados de
teste, conferir a documentação, etc.). Pense neles como os botões de uma
maquininha: cada um faz uma coisa específica.

> **Como rodar um comando?** Abra o **terminal** na pasta do projeto e cole a
> linha indicada.
> - **Windows:** abra o **PowerShell** (menu Iniciar → digite "PowerShell").
> - **macOS:** abra o **Terminal** (Launchpad → digite "Terminal").
>
> Antes, entre na pasta do projeto (uma vez por terminal):
> - Windows: `cd C:\Users\Lucca\Downloads\transhipping-desk2`
> - macOS: `cd ~/Downloads/transhipping-desk2` *(ajuste para onde o projeto estiver)*

> **Por que sempre dois comandos?** Windows e macOS falam "línguas" diferentes
> no terminal. Programas terminados em `.ps1` são de Windows; os terminados em
> `.sh` são de macOS/Linux. Os terminados em `.mjs`/`.cjs` são feitos em **Node**
> e funcionam igual nos dois — nesses casos o comando muda só a barra do caminho
> (`\` no Windows, `/` no macOS).

---

## 1. Sincronizar com o repositório (`sync-git`)

**O que faz:** puxa as novidades do projeto que estão no servidor (GitHub),
atualiza a sua cópia e limpa referências de branches que já não existem mais.
É o "baixar as últimas alterações" do dia a dia.

**Quando usar:** ao começar a trabalhar, para garantir que está com a versão
mais recente.

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\sync-git.ps1
```
```bash
# macOS (Terminal)
bash scripts/sync-git.sh
```
> Atalho que funciona igual nos dois: `npm run sync`

---

## 2. Conferir a documentação (`check-docs`)

**O que faz:** varre a documentação do projeto procurando problemas — como links
que apontam para arquivos que não existem mais. É um "corretor" dos documentos.

**Quando usar:** depois de mexer em textos, rotas, ADRs ou playbooks (o próprio
projeto pede isso no `CLAUDE.md`).

```powershell
# Windows (PowerShell)
node scripts\check-docs.mjs
```
```bash
# macOS (Terminal)
node scripts/check-docs.mjs
```
> Atalho igual nos dois: `npm run docs:check`

---

## 3. Ambiente de testes local — banco + site na sua máquina (`design-audit/win/local-stack`)

**O que faz:** monta um **banco de dados de mentira dentro do seu computador**,
com dados de teste, para você abrir o site e ver as telas funcionando **sem
mexer no sistema real dos clientes**. Ele instala/liga o banco, coloca os dados
e liga o "tradutor" que faz o site conversar com esse banco.

**Quando usar:** quando quiser conferir visualmente uma mudança de tela (por
exemplo, revisar as melhorias da tela Viagens).

```powershell
# Windows (PowerShell) — PRIMEIRA VEZ (ou para zerar os dados de teste):
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1 -Rebuild

# Windows (PowerShell) — no dia a dia (só religa o tradutor):
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1
```
```bash
# macOS (Terminal) — AINDA NÃO EMPACOTADO NUM COMANDO ÚNICO.
# O equivalente para Mac/Linux é montar o banco com o script abaixo (item 4)
# e depois ligar o "tradutor" à mão:
bash scripts/setup-local-pg.sh
node scripts/design-audit/sb-shim.cjs
```
Depois, em **outro** terminal, abra o site com `npm run dev` e acesse
<http://localhost:5173> (login de teste: `auditor@local.test` / `audit-local`).

> Detalhes e observações: veja [`design-audit/win/README.md`](design-audit/win/README.md).
> O "tradutor" é o arquivo `design-audit/sb-shim.cjs`; os arquivos `.sql`,
> `pg_cron.control` e `pg_cron--1.0.sql` são peças de apoio usadas pelo script —
> você não roda nenhum deles diretamente.

---

## 4. Banco de dados descartável para testar migrations (`setup-local-pg`)

**O que faz:** cria um banco de dados **temporário e descartável** com a
estrutura completa do sistema, para testar alterações de banco ("migrations")
sem tocar na produção. É uma bancada de laboratório.

**Quando usar:** ao criar ou revisar mudanças na estrutura do banco de dados.

> ⚠️ Este script foi feito para **Linux/macOS** (terminal `.sh`). No macOS ele
> exige um PostgreSQL instalado (por exemplo via Homebrew). **Não há versão
> Windows**; no Windows, use o item 3 acima, que cumpre o mesmo papel.

```powershell
# Windows (PowerShell) — não disponível; use o item 3 (local-stack.ps1 -Rebuild).
```
```bash
# macOS (Terminal)
bash scripts/setup-local-pg.sh
# para apagar e recriar do zero:
bash scripts/setup-local-pg.sh --reset
```

---

## 5. Medir a "leveza" das páginas (`perf/measure-page-load`)

**O que faz:** calcula quanto "peso" (código) cada tela precisa carregar para
abrir. Serve para garantir que o site continua rápido.

**Quando usar:** ao investigar ou controlar a performance de carregamento.

```powershell
# Windows (PowerShell)
node --experimental-vm-modules scripts\perf\measure-page-load.mjs
```
```bash
# macOS (Terminal)
node --experimental-vm-modules scripts/perf/measure-page-load.mjs
```

---

## 6. Gerar a planilha da especificação (`build-behavioral-spec`)

**O que faz:** transforma a lista de comportamentos esperados do sistema (um
arquivo de texto/CSV) numa **planilha Excel** organizada, mais fácil de ler.

**Quando usar:** depois de atualizar a especificação de comportamento em
`docs/spec/`.

```powershell
# Windows (PowerShell)
node scripts\build-behavioral-spec.mjs
```
```bash
# macOS (Terminal)
node scripts/build-behavioral-spec.mjs
```

---

## 7. Instalar as "skills" do projeto (`skills/install-skills`)

**O que faz:** copia as habilidades (skills) guardadas no projeto para as pastas
que o assistente de IA (Claude/Codex) lê ao iniciar. É o que deixa os
"playbooks" disponíveis nas sessões.

**Quando usar:** normalmente roda sozinho ao abrir uma sessão; rode à mão só se
precisar reinstalar.

```powershell
# Windows (PowerShell)
node scripts\skills\install-skills.mjs
```
```bash
# macOS (Terminal)
node scripts/skills/install-skills.mjs
```

---

## 8. Portão de segurança do Git (`no-mistakes/setup`)

**O que faz:** instala uma proteção que verifica os comandos de Git antes de
executá-los, para evitar erros perigosos (como apagar coisas sem querer). Ele
baixa uma versão fixa e confere a "impressão digital" do arquivo antes de usar.

**Quando usar:** para ligar essa proteção no ambiente. É "melhor esforço": se
não conseguir baixar, simplesmente não ativa (não trava nada).

```powershell
# Windows (PowerShell) — feito para terminal .sh; no Windows use o Git Bash:
bash scripts/no-mistakes/setup.sh
```
```bash
# macOS (Terminal)
sh scripts/no-mistakes/setup.sh
```

---

### Resumo rápido

| Ferramenta | Para quê serve |
|---|---|
| `sync-git` | Baixar as últimas alterações do projeto |
| `check-docs` | Conferir a documentação (links quebrados) |
| `design-audit/win/local-stack` | Subir banco + site de teste na sua máquina (Windows) |
| `setup-local-pg` | Banco descartável para testar migrations (macOS/Linux) |
| `perf/measure-page-load` | Medir a leveza/velocidade das telas |
| `build-behavioral-spec` | Gerar a planilha Excel da especificação |
| `skills/install-skills` | Instalar as skills do assistente de IA |
| `no-mistakes/setup` | Ligar a proteção contra erros de Git |
