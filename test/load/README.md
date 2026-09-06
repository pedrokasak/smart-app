# Harness de carga e estresse (k6)

Nada no TrackerInvest e medido hoje. Os numeros de dimensionamento que
existem — concorrencia 20, ~100 jobs/s por instancia, burst de 5 mil
usuarios drenando em ~50s (`src/events/infrastructure/bullmq/queue.config.ts`)
— sao **estimativas, nunca medidas**. Este diretorio existe para
substitui-las por medicao antes do lancamento.

Alvo de dimensionamento: **~5.000 usuarios**. Deploy: **Coolify no VPS
proprio**, com Mongo e Redis como containers sidecar.

---

## Riscos — leia antes de rodar

O harness aponta para **localhost por default**. Atingir qualquer outro host
exige `-e LOAD_ALLOW_REMOTE=i-understand-the-risk`, e a rampa de estresse
exige ainda `-e LOAD_STRESS_REMOTE_ACK=yes`. Isso e proposital: contra
producao, este harness pode

- **esgotar o pool de conexoes do Mongo** e derrubar usuario real junto;
- **encher a fila de eventos** — o Redis do compose roda com
  `maxmemory-policy noeviction`, entao pressao de memoria faz a escrita
  falhar alto, e o `BullmqEventQueueAdapter` degrada para `unavailable`
  (evento publicado, entrega perdida);
- **disparar notificacao real** — apenas no burst com `--event-type` real
  (ver a tabela de efeitos colaterais);
- **saturar a CPU no argon2** e travar o event loop do processo inteiro, nao
  so o login.

**Este harness nunca entra em CI.** Nenhum workflow em `.github/workflows/`
o referencia, e nao deve passar a referenciar: e ferramenta sob demanda, com
alvo escolhido por quem roda.

### Efeitos colaterais por cenario

| Cenario | Escritas | E-mail / push real | Stripe |
|---|---|---|---|
| `01-auth` | **sim**: cada login bem-sucedido grava o hash do refresh token no doc do usuario (`issueSessionTokens`). Nao cria nada; sobrescreve campo do proprio usuario de carga. | nao | nao |
| `02-read-portfolio` | nenhuma — somente GET | nao | nao |
| `03-notifications-read` | nenhuma por default; `PATCH /notifications/read-all` so com `LOAD_NOTIFICATIONS_WRITE=true` | nao | nao |
| `03b queue burst` (tipo sintetico, default) | nenhuma — o evento morre no mapeador | **nao** | nao |
| `03b queue burst` (`--event-type` real) | grava `Notification` no Mongo | **SIM — Resend + push** | nao |
| `04-stress-ramp` | nenhuma — login + GET | nao | nao |

Nenhum cenario toca Stripe, Asaas ou webhooks de pagamento. Isso e
deliberado: nao existe caminho seguro de carga contra um provedor de
pagamento, nem mesmo em sandbox.

---

## Instalar o k6

k6 e um binario standalone, **nao um pacote npm** — nada e adicionado ao
`package.json` por causa dele.

```bash
# Windows (winget ou choco)
winget install k6 --source winget
choco install k6

# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Docker, sem instalar nada
docker run --rm -i -v "$PWD":/app -w /app grafana/k6 run test/load/scenarios/01-auth.js
```

Confirme com `k6 version`.

---

## Dados de teste

O harness precisa de usuarios para logar. **Nenhuma credencial e versionada
neste repo** e nenhum default de senha existe no codigo.

### Semear localmente

```bash
LOAD_SEED_PASSWORD='SenhaDeCarga123@' \
DATABASE_URL='mongodb://root:example@localhost:27017/trackerr?authSource=admin' \
node test/load/seed/seed-load-users.mjs --count 50 --assets 15
```

Cria `loadtest+0001@loadtest.invalid` ... `loadtest+0050@loadtest.invalid`,
cada um com uma carteira e 15 ativos. Idempotente: reexecutar nao duplica.

O seeder escreve **direto no Mongo**, nao pela API, porque
`POST /users/create` dispara `sendWelcomeEmail` — semear 500 usuarios pela
API mandaria 500 e-mails reais pelo Resend. O hash usa exatamente os mesmos
parametros argon2id do `PasswordSecurityService`, entao o custo de login
medido e o custo de producao.

O dominio `.invalid` e reservado pela RFC 6761 e nunca resolve: nenhum
e-mail para estes usuarios pode alcancar uma caixa real.

Para remover tudo o que o seeder criou (e so isso):

```bash
DATABASE_URL='...' node test/load/seed/seed-load-users.mjs --purge
```

### Apontar para um dataset ja semeado

```bash
k6 run -e LOAD_USERS_FILE=/caminho/fora/do/repo/users.json ...
```

Arquivo JSON com `[{ "email": "...", "password": "..." }, ...]`. Mantenha-o
fora do repositorio.

---

## Rodar

Todos os cenarios aceitam as mesmas variaveis base:

| Variavel | Default | Para que serve |
|---|---|---|
| `LOAD_BASE_URL` | `http://localhost:3000` | alvo |
| `LOAD_ALLOW_REMOTE` | (vazio) | `i-understand-the-risk` libera host remoto |
| `LOAD_VUS` | por cenario | VUs do plateau |
| `LOAD_PLATEAU` | por cenario | duracao do plateau (`3m`, `10m`...) |
| `LOAD_USER_PASSWORD` | — | senha dos usuarios semeados |
| `LOAD_USER_COUNT` | `50` | tamanho do pool derivado do padrao |
| `LOAD_USER_EMAIL_PATTERN` | `loadtest+{i}@loadtest.invalid` | `{i}` vira `0001` |
| `LOAD_USERS_FILE` | (vazio) | alternativa ao padrao acima |
| `LOAD_UA_MODE` | `unique` | `fixed` faz o run medir o rate limiter (ver abaixo) |
| `LOAD_TOKEN_POOL` | `20` | quantos usuarios sao autenticados no `setup()` |

### 1. Autenticacao

```bash
k6 run -e LOAD_USER_PASSWORD='SenhaDeCarga123@' -e LOAD_VUS=30 \
  test/load/scenarios/01-auth.js
```

### 2. Leitura de carteira

```bash
k6 run -e LOAD_USER_PASSWORD='SenhaDeCarga123@' -e LOAD_VUS=50 \
  test/load/scenarios/02-read-portfolio.js
```

### 3a. Centro de notificacoes (lado HTTP)

```bash
k6 run -e LOAD_USER_PASSWORD='SenhaDeCarga123@' -e LOAD_VUS=60 \
  test/load/scenarios/03-notifications-read.js
```

### 3b. Burst da fila (o numero da TRA-136)

Nao e k6 — k6 nao fala Redis sem extensao compilada. Usa `bullmq` e
`ioredis`, que ja sao dependencias do servidor.

```bash
# servidor precisa estar no ar com EVENTS_QUEUE_WORKER_ENABLED=true
node test/load/queue/burst.mjs --size 5000
```

O `docker-compose.yml` **nao publica a porta 6379 de proposito** (o Redis so
precisa ser alcancavel pela rede interna). Para rodar do host, ou abra um
tunel temporario, ou rode o script de dentro da rede do compose:

```bash
docker run --rm --network <rede-do-compose> -v "$PWD":/app -w /app node:20 \
  node test/load/queue/burst.mjs --size 5000
```

Saida: taxa de enfileiramento, tempo de drenagem, jobs/s reais e p50/p95/p99
de latencia por job. **Compare o p50 medido com os ~200 ms estimados no
`queue.config.ts`** — e para isso que o script existe.

### 4. Rampa de estresse

```bash
k6 run -e LOAD_USER_PASSWORD='SenhaDeCarga123@' -e LOAD_MAX_VUS=400 \
  test/load/scenarios/04-stress-ramp.js
```

O run **aborta** quando a qualidade de servico se rompe. O resultado nao e
"passou/falhou" — e **o numero de VUs no degrau em que abortou**. Anote-o.

---

## Thresholds e por que estes valores

Um teste de carga que sempre passa nao mede nada. Todo cenario tem
threshold que **quebra o run**.

| Metrica | Valor | Justificativa |
|---|---|---|
| `POST /auth/signin` p95 | **1500 ms** | um login bem-sucedido custa **DUAS** operacoes argon2id (64 MiB, t=3, p=1), nao uma: `verifyPassword` na senha e, em `issueSessionTokens`, `hashPassword` no refresh token antes de gravar. A ~60-120 ms de CPU cada num vCPU de VPS, o piso e ~120-240 ms mais uma escrita no Mongo. 1500 ms e ~6-12x o piso: folga para fila no threadpool do libuv, ainda abaixo do ponto em que o login parece travado. |
| `POST /auth/signin` p99 | 3000 ms | onde a cauda comeca a virar timeout de cliente. |
| `POST /auth/signin` erro | **< 1%** | login que falha e usuario que nao entra. Nao ha degradacao graciosa; 1% e margem para ruido de rede da maquina de carga. |
| `GET /health` p95 (junto com o login) | **250 ms** | `/health` devolve string constante, sem banco. 250 ms significa centenas de ms de trabalho na frente na fila do event loop: a degradacao e do processo, nao so do hashing. |
| `GET /portfolio`, `/portfolio/summary` p95 | **500 ms** | consulta indexada por `userId` (indice dedicado no `portfolioSchema`), Mongo no mesmo host. Deveria ficar em dezenas de ms; 500 ms admite uma ordem de grandeza de fila. Estourar = contencao (pool, IO), nao consulta lenta. |
| `GET /portfolio/assets` p95 | **1200 ms** | 3x mais frouxo de proposito: a rota faz um `TradeModel.find({ userId })` **sem limite** e deriva preco medio em memoria por requisicao. O threshold precisa ser alcancavel com dataset pequeno e estourar com dataset realista — a diferenca entre os dois numeros e o dado. |
| `GET /notifications` p95 | **600 ms** | paginacao por cursor, nao por skip: o custo nao cresce com a profundidade. 600 ms cobre leitura indexada + serializacao de 20 docs com folga. |
| `GET /notifications/unread-count` p95 | **300 ms** | count indexado, pedido em toda navegacao. Acima disso o app inteiro arrasta. |
| Leituras, erro | **< 0,5%** | leitura autenticada nao tem por que falhar. |
| Rampa de estresse, p95 | **2000 ms**, `abortOnFail` | ponto em que o produto deixou de responder em tempo util. Abortar preserva o numero: o run para NO degrau da ruptura. |
| Rampa de estresse, erro | **< 5%**, `abortOnFail` | mais frouxo que o regime estavel de proposito — o objetivo aqui e chegar perto da borda antes de parar. |

`delayAbortEval: '30s'` na rampa evita abortar no aquecimento (pool de
conexao frio, JIT ainda nao aquecido).

---

## O rate limiter, e por que o harness varia o User-Agent

`EndpointRateLimitMiddleware` identifica o cliente por
`sha256(ip | user-agent | accept-language)` e limita `POST /auth/signin` a
**12 por minuto**, com um default de 300/min para o resto.

Uma maquina de carga tem **um IP**. Sem variar o fingerprint, o cenario de
autenticacao para de medir o argon2 na 13a requisicao do minuto e passa a
medir o limitador: tudo vira 429.

Por isso `lib/config.js` da um `User-Agent` distinto por VU, reproduzindo o
que 5 mil usuarios reais com IPs distintos produziriam — buckets separados.
**E uma acomodacao do teste, nao uma mudanca do produto**: nenhuma linha de
`src/` foi alterada.

Para medir o proprio limitador, inverta: `-e LOAD_UA_MODE=fixed`. O cenario
1 tem uma metrica `auth_rate_limited` com threshold de 1% justamente para
que um run acidentalmente estrangulado se denuncie em vez de produzir
numeros bonitos e falsos.

---

## O que observar no servidor enquanto roda

Abra estes tres em terminais separados **antes** de iniciar o run. O
resultado do k6 diz *que* degradou; estes dizem *por que*.

### 1. CPU e memoria dos containers

```bash
docker stats trakker-server mongodb trakker-redis
```

O que procurar:

- **`trakker-server` CPU perto de 100% de um core** durante o cenario 1:
  o argon2 saturou. Cada operacao aloca 64 MiB e ocupa uma thread do pool
  do libuv (`UV_THREADPOOL_SIZE`, default 4). Como cada login faz **duas**
  operacoes (verificar a senha + hashear o refresh token), o teto e ~2
  logins simultaneos por processo, com pico de ~256 MiB so de hashing —
  num VPS de 4 GB isso disputa memoria com o Mongo. Se este cenario for o
  que quebrar primeiro, o candidato numero um a otimizacao e o hash argon2
  do refresh token: e um token aleatorio de alta entropia, nao uma senha
  humana, e nao precisa de funcao de derivacao resistente a GPU.
- **`trakker-server` MEM subindo e nao voltando**: vazamento, ou os buckets
  do rate limiter (teto de 50.000) crescendo com o UA por VU.
- **`mongodb` CPU alta com `trakker-server` ocioso**: o gargalo e consulta,
  nao aplicacao. Prime suspeito: `GET /portfolio/assets`.
- **`trakker-redis` MEM subindo durante o burst**: a fila esta acumulando
  mais rapido do que dreana. Com `noeviction`, chegar ao teto faz a escrita
  falhar — nao descarta job em silencio, mas para de aceitar.

### 2. Profundidade da fila (bull-board)

```
GET /admin/queues        # exige JWT de usuario com role admin
```

`BullBoardController` esta em `@Controller('admin/queues')`, atras de
`RolesGuard` com `@Roles(Role.Admin)`. Duas filas aparecem:
`trackerr.events` e `trackerr.events.dead-letter`.

O que procurar durante o burst:

- **`waiting` subindo sem `completed` acompanhar**: o worker nao esta
  drenando. Confira `EVENTS_QUEUE_WORKER_ENABLED`.
- **`active` travado em 20**: a concorrencia e o gargalo — jobs mais lentos
  que os ~200 ms estimados.
- **`active` bem abaixo de 20 com `waiting` alto**: o gargalo e o limiter
  (`EVENTS_QUEUE_RATE_LIMIT_MAX=200/s`), nao a concorrencia.
- **qualquer coisa na `dead-letter`**: envelope invalido ou 5 tentativas
  esgotadas. Isso e bug, nao carga.

### 3. Logs da aplicacao

```bash
docker logs -f trakker-server
```

Linhas que importam:

- `Conexao Redis (produtor/worker):` — Redis instavel sob carga;
- `Fila indisponivel para <tipo> id=<id>` — enfileiramento degradou; o
  evento foi publicado e a entrega assincrona se perdeu;
- `Job <id> ... falhou na tentativa n/5` — retry em curso;
- `Rate limit excedido` — o limitador entrou no caminho (ver secao acima).

### 4. Conexoes do Mongo

```bash
docker exec mongodb mongosh --quiet --eval 'db.serverStatus().connections'
```

`current` encostando em `available` e o teto real da rampa de estresse na
maioria dos VPS pequenos — antes de CPU e antes de RAM.

---

## Como ler a saida do k6

```
http_req_duration..............: avg=142ms min=8ms med=98ms max=2.1s p(90)=310ms p(95)=487ms
  { endpoint:portfolio_list }..: avg=..." 
http_req_failed................: 0.12% ✓ 14 ✗ 11302
checks.........................: 99.88%
```

- **`p(95)`, nao `avg`.** A media esconde a cauda, e a cauda e o que o
  usuario lembra. Todos os thresholds daqui sao sobre percentil.
- **Linhas `✓` / `✗` ao lado dos thresholds** dizem quais quebraram. Um
  `✗` faz o k6 sair com codigo 99 — util em script, inutil em CI (nao
  coloque em CI).
- **Sub-metricas por tag** (`{ endpoint:... }`) sao onde esta a informacao.
  A metrica agregada mistura `/health` com `/portfolio/assets` e nao
  significa nada.
- **`iterations` e `vus_max`** dizem se a rampa realmente chegou ao alvo. Se
  `vus_max` ficou abaixo de `LOAD_VUS`, a maquina de carga (nao o servidor)
  foi o gargalo — refaca de outra maquina antes de acreditar no numero.

Para guardar o resultado:

```bash
k6 run --summary-export=resultado.json --out json=bruto.json \
  test/load/scenarios/01-auth.js
```

---

## Limitacoes conhecidas deste harness

- **O digest diario de push e semanal de e-mail nao sao modelados
  ponta-a-ponta.** Nao ha rota HTTP que dispare os schedulers
  (`DailyPushDigestScheduler`, `PortfolioDigestScheduler` — ambos so
  `@Cron`), e o harness nao adiciona uma: criar endpoint de disparo so para
  testar seria mudar a aplicacao por conveniencia do teste. O que da para
  medir de fora e a fila (3b) e o que o usuario faz depois (3a).
- **O `DailyPushDigestScheduler` nao passa pela fila.** Ele itera os
  usuarios num `for...of` sequencial dentro do proprio processo do cron.
  Ou seja, `EVENTS_QUEUE_CONCURRENCY=20` **nao governa** o push diario — o
  numero de 3b nao diz nada sobre ele. Medir esse caminho exige instrumentar
  o scheduler ou rodar com `NODE_ENV` e um `now` fixo, fora do escopo deste
  harness.
- **O rate limiter e por processo, em memoria** (`Map` no middleware). Com
  mais de uma instancia atras do Coolify, o limite efetivo de 12/min vira
  12/min *por instancia*. Isso e uma questao de produto, nao do teste, mas
  aparece aqui porque afeta a interpretacao de qualquer numero de login.
- **A maquina de carga precisa ser outra maquina.** Rodar k6 no mesmo host
  do servidor faz os dois competirem por CPU e o resultado nao vale nada.
