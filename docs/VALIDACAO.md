# Validacao do Sistema

Roteiro de validacao do estado atual em 2026-04-11.

Este roteiro cobre os modulos que hoje ja existem como produto operacional:

- Login
- Viagens
- Manifestos CNTR
- Containers
- Manifestos BB
- Veiculos
- Revisao Manual
- Clientes
- CE Mercante

## 1. Validacao tecnica local

Execute na raiz do projeto:

```powershell
npm install
npm test
npm run lint
npm run build
```

Resultado esperado:

- `npm test` finaliza com todos os testes passando.
- `npm run lint` finaliza sem erros.
- `npm run build` finaliza sem erros.
- O build mostra chunk separado de `xlsx`, confirmando o carregamento sob demanda.

Observacao:

- `xlsx` pode aparecer em auditorias com vulnerabilidade conhecida sem fix disponivel no ecossistema atual.

## 2. Preparar o ambiente Supabase

1. Crie o projeto no Supabase.
2. Rode as migrations de `supabase/migrations` na ordem correta.
3. Crie um usuario em Authentication.
4. Crie ou atualize o perfil em `user_profiles`.
5. Confirme que o usuario esta `active = true`.

## 3. Configurar o app

Crie `.env` a partir de `.env.example`:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

Rode:

```powershell
npm run dev
```

## 4. Fluxo de validacao - Login e Painel

1. Acesse `/login`.
2. Faca login com usuario ativo.
3. Confirme que `/painel` abre sem erro.
4. Confirme que o header, menu principal e submenu `Importacao` funcionam.

## 5. Fluxo de validacao - Viagens

1. Acesse `/viagens`.
2. Crie uma nova viagem.
3. Edite a viagem criada.
4. Confirme:
   - armador padrao
   - SCAC padrao
   - card da viagem visivel
   - filtros por navio e viagem funcionando
5. Verifique os blocos:
   - `Container`
   - `Container de Carga Geral`
   - `Carga solta`
   - `Veiculos`
6. Ajuste ETD em um POL.
7. Ajuste ETA e ATA em um POD.
8. Exclua a viagem apenas se ela estiver sem vinculos operacionais.

## 6. Fluxo de validacao - Manifestos CNTR

1. Acesse `/manifestos`.
2. Clique em `Importar Manifesto CNTR`.
3. Selecione uma viagem existente.
4. Envie um manifesto real ou fixture de validacao.
5. No preview, confirme:
   - quantidade de B/Ls
   - `Ocorrencias CNTR`
   - `Containers distintos`
   - pendencias de revisao
   - trecho detectado
6. Conclua a importacao.
7. Verifique na grade:
   - filtros
   - exportacao
   - abertura do detalhe do B/L
   - coluna de CE Mercante
8. Importe planilha complementar de:
   - IMO/OOG
   - CE Mercante

## 7. Fluxo de validacao - Containers

1. Acesse `/containers`.
2. Confirme filtros por:
   - texto
   - viagem
   - POL
   - POD
   - perfil
3. Confirme cards:
   - registros filtrados
   - containers distintos
   - B/Ls envolvidos
   - OOG distintos
   - IMO distintos
4. Confirme resumo por tipo.
5. Abra um B/L a partir da tela de containers.

## 8. Fluxo de validacao - Manifestos BB

1. Acesse `/carga-solta`.
2. Clique em `Importar Manifesto BB`.
3. Vincule a uma viagem.
4. Envie arquivo no layout operacional atual.
5. Confirme:
   - importacao concluida
   - B/Ls listados
   - campos de maquinas, packages, packages total, weight e CBM
   - CE Mercante importavel por planilha
6. Teste exportacao da grade.

## 9. Fluxo de validacao - Veiculos

1. Acesse `/veiculos`.
2. Confirme filtros de visualizacao:
   - navio
   - viagem
   - busca por chassi
   - container
   - BL
3. Clique em `Importar Veiculos`.
4. Selecione a viagem no modal.
5. Envie planilha modelo.
6. Confirme preview e resultado:
   - total processado
   - sucessos
   - erros
7. Abra um B/L CNTR que tenha veiculos e confirme a secao `Veiculos vinculados`.

## 10. Fluxo de validacao - Revisao Manual

1. Acesse `/revisao`.
2. Confirme listagem de B/Ls pendentes.
3. Abra um B/L pendente.
4. Edite os campos necessarios.
5. Salve.
6. Confirme que o B/L sai da fila quando estiver regularizado.

## 11. Fluxo de validacao - Clientes

1. Acesse `/clientes`.
2. Importe uma base mestre de clientes.
3. Confirme:
   - CNPJ/CPF obrigatorio
   - Razao Social obrigatoria
   - emails multiples por cliente
4. Crie cliente manualmente.
5. Abra a ficha do cliente.
6. Edite dados gerais e contatos.
7. Exclua um cliente apenas se a regra operacional permitir.

## 12. Fluxo de validacao - CE Mercante

1. Gere planilha simples com colunas:
   - `BL`
   - `CE MERCANTE`
2. Importe em `Manifestos CNTR`.
3. Importe em `Manifestos BB`.
4. Confirme que o campo aparece:
   - na grade
   - no detalhe do B/L

## 13. Consultas SQL de apoio

Use no SQL Editor do Supabase:

```sql
select count(*) from voyages;
select count(*) from bls;
select count(*) from containers;
select count(*) from vehicles;
select count(*) from customers;
select count(*) from import_batches;
```

Conferencias adicionais:

```sql
select cargo_mode, count(*)
from bls
group by cargo_mode
order by cargo_mode;

select status, count(*)
from user_profiles
group by status
order by status;
```

## 14. O que ainda nao entra na validacao operacional

Os itens abaixo ainda existem apenas como placeholder, estrutura inicial ou area em aberto:

- Taxas Locais
- Faturamento
- Alertas
- Relatorios
- Line up TV
- Admin - Usuarios
- Admin - Tarifas
