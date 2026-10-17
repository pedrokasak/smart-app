# Observabilidade (TRA-222)

OpenTelemetry Collector, Prometheus, Loki, Tempo e Grafana na VPS do Coolify. Arquitetura: https://claude.ai/artifact/RQ5YGUfKH71UHAkJSPKBDz

```text
server / trackerr-ia --OTLP--> otel-collector --> prometheus (métricas, 15 dias)
                                              --> loki       (logs, 14 dias)
                                              --> tempo      (traces, 7 dias)
                               grafana lê os três; só ele sai para fora, com login
```

## Subir no Coolify

1. Confira a RAM livre da VPS. Os limites somam cerca de 1,8 GB, e a VPS já caiu por falta de memória.
2. **New Resource → Docker Compose** a partir deste repositório:
   - branch `release`;
   - base directory `/infra/observability`;
   - compose `docker-compose.yml`.
3. Em **Settings**, ligue **Connect to Predefined Network**. É ela que coloca o Collector na rede `coolify`, onde a API e o trackerr-ia o alcançam como `trackerr-otel-collector`.
4. Defina o domínio do serviço `grafana` (ex.: `https://grafana.trackerr.com.br`). O Coolify gera `SERVICE_USER_GRAFANA` e `SERVICE_PASSWORD_GRAFANA`; a senha fica só no Coolify.
5. Deploy. O Collector recusa configuração inválida e para na inicialização; se ele reiniciar em loop, o motivo está no log dele.
6. Remova o serviço Grafana antigo que está parado no Coolify, para não haver dois.

## Ligar as aplicações

Na API (server), em **Environment Variables**:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://trackerr-otel-collector:4318
OTEL_DEPLOYMENT_ENVIRONMENT=production
```

Ligue também **Connect to Predefined Network** na API. No Coolify, ative "Include Source Commit in Build" para a versão (`SOURCE_COMMIT`) aparecer nos traces.

Sem `OTEL_EXPORTER_OTLP_ENDPOINT`, o server não inicia o SDK e funciona como antes. Para desligar sem remover a variável, use `OTEL_SDK_DISABLED=true`.

## O que fica fora

O Collector apaga, antes de gravar:

- cabeçalhos de autenticação e cookies;
- e-mail, CPF e CNPJ em atributos e no corpo dos logs;
- segredos na URL (`token`, `key`, `api_key`, `code`, `signature` e afins) em qualquer chamada, como a chave da Brapi, e a query inteira das rotas de autenticação.

A instrumentação do MongoDB não grava os valores das consultas.

## Segurança

- Nenhum serviço publica porta no host; só o Grafana é exposto, pelo proxy do Coolify.
- O Collector monta o socket do Docker como somente leitura, para medir CPU e memória por container. Isso ainda dá acesso ao daemon, então ele não recebe nada além de OTLP pela rede interna.
- O Grafana não aceita cadastro nem acesso anônimo.

## Painéis e alertas (F1d)

Versionados em `grafana/provisioning` e somente leitura no Grafana (mudança é por PR):

- **Trackerr · APIs**: requisições/s, taxa de 5xx, latência p50/p95/p99, p95 por rota, respostas por status e a lista de chamadas de LLM (spans `gen_ai` do trackerr-ia, pelo Tempo).
- **Trackerr · VPS e containers**: CPU e memória por container (base para os limites do F1e), memória e disco da VPS, carga e logs com erro.

Alertas (pasta Trackerr):

| Alerta | Condição |
|---|---|
| API com mais de 5% de 5xx | 5 min, por serviço (crítico) |
| API com p95 acima de 2s | 10 min, por serviço |
| VPS com menos de 10% de memória livre | 5 min (crítico) |
| Disco da VPS acima de 85% | 15 min |
| Container acima de 90% da memória | 10 min |

**Ponto de contato:** sem configuração, os alertas só aparecem no Grafana. Em **Alerting → Contact points**, cadastre o destino (e-mail via SMTP do Resend, Telegram ou Discord) e deixe-o como padrão na política de notificação. A credencial fica só no Grafana, nunca neste repositório.

Os nomes das métricas seguem a tradução do receptor OTLP do Prometheus: `http.server.duration` em ms (server e trackerr-ia) vira `http_server_duration_milliseconds_*`; métrica de unidade `1` do `docker_stats` pode ganhar o sufixo `_ratio`, por isso as consultas aceitam os dois nomes. Depois do primeiro deploy, confira em **Explore** que os painéis têm dados; painel vazio quase sempre é nome de métrica.
