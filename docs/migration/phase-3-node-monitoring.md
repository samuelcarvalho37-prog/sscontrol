# Fase 3 — Monitoramento operacional e indicadores técnicos

Status: bloco 3.5 concluído tecnicamente

Data: 04/08/2026

## Escopo concluído

O backend Node.js passou a controlar, em paralelo ao Apps Script, os eventos que alimentam a operação e o Centro Técnico:

1. registro de ocorrência por ativo e componente;
2. abertura automática ou explícita de parada técnica;
3. sincronização do estado operacional do ativo e componente;
4. ciclo controlado da parada até o retorno operacional;
5. análise técnica rastreável enviada ao Administrador;
6. reconhecimento de alertas e conversão em ocorrência;
7. central de notificações persistente por destinatário;
8. leitura, dispensa e leitura em lote sem reaparecimento indevido;
9. indicadores de disponibilidade, MTTR, MTBF, SLA, ocorrências e execuções;
10. ranking de ativos por indisponibilidade e criticidade.

O módulo não calcula OEE. Sem quantidades produzidas, tempo de ciclo ideal e rejeições, o indicador seria tecnicamente inválido.

## Ciclo de parada protegido

O PostgreSQL aceita somente estas transições:

```text
OPEN
 ├─ WAITING_MAINTENANCE ─ IN_MAINTENANCE
 ├─────────────────────── IN_MAINTENANCE
 └─ CANCELLED

IN_MAINTENANCE ─ WAITING_OPERATIONAL_RETURN ─ COMPLETED
```

Estados terminais não podem ser reabertos. Os tempos de espera, manutenção, retorno e indisponibilidade são calculados no banco. Uma restrição única impede duas paradas abertas simultaneamente para o mesmo ativo.

## Notificações

Cada notificação possui entidade e identificador de origem, rota de ação exata, prioridade, chave de deduplicação, audiência declarada, destinatários materializados e datas de entrega, leitura e dispensa por usuário.

Marcar uma notificação como lida atualiza `workflow.notification_recipients`. O contador é calculado a partir desse registro persistente; abrir novamente o sistema não recria a pendência.

## Capacidades

| Capacidade | Uso |
| --- | --- |
| `maintenance.occurrences.read` | consultar ocorrências e análises |
| `maintenance.occurrences.report` | registrar ocorrência operacional |
| `maintenance.occurrences.triage` | emitir análise técnica |
| `maintenance.stops.read` | consultar paradas e tempos |
| `maintenance.stops.manage` | abrir e movimentar paradas |
| `maintenance.alerts.read` | consultar alertas técnicos |
| `maintenance.alerts.manage` | reconhecer e transformar alertas |
| `workflow.notifications.read` | operar a central de notificações |
| `analytics.technical.read` | consultar indicadores e ranking |

O Administrador recebe todas as capacidades do bloco. O Gestor recebe análise e monitoramento completos. O Operador registra ocorrências, consulta paradas e recebe suas notificações, sem ganhar poderes de tratamento técnico.

## Teste integrado

O teste `monitoring.integration.test.ts` verifica pela API real:

- ocorrência crítica registrada pelo Operador;
- parada aberta e ativo alterado para `STOPPED`;
- notificação recebida pelo Gestor;
- leitura persistente e contador zerado;
- análise técnica enviada ao Administrador;
- passagem controlada por manutenção e retorno operacional;
- ativo restabelecido como `OPERATING`;
- ocorrência e alerta resolvidos junto da parada;
- alerta reconhecido e convertido em nova ocorrência;
- indicadores e ranking sem campo de OEE;
- rejeição de transição posterior ao encerramento.

## Garantia de não perda

Nenhum arquivo do Apps Script, frontend ou planilha foi removido ou substituído. A migração `0012_monitoring_runtime.sql` é aditiva. O Node.js permanece paralelo ao ambiente atual até a carga reconciliada, a homologação dos três perfis e o aceite do procedimento de corte e rollback.

## Próximo bloco

A Fase 4 implementa extração, transformação, carga idempotente e reconciliação entre as exportações das planilhas e o PostgreSQL.
