# Fase 2 — Modelo PostgreSQL

Status: aprovado pelo proprietário em 29/07/2026

Data: 29/07/2026

Banco selecionado: PostgreSQL

Versão local validada: PostgreSQL 18.4

## 1. Decisão

O PostgreSQL foi selecionado como fonte de verdade do Fab Control.

O modelo atual possui 48 abas relacionadas e operações que precisam ser atômicas: ordem de serviço, ação, execução, checklist, evidência, assinatura, parada, ocorrência, notificação e auditoria. O PostgreSQL atende melhor esse cenário porque oferece:

- chaves estrangeiras e restrições transacionais;
- consistência entre equipamento, componente, plano, versão e execução;
- bloqueios concorrentes;
- consultas analíticas;
- índices compostos, parciais, GIN, BRIN e trigramas;
- JSONB para snapshots imutáveis;
- Row-Level Security para isolamento multiempresa;
- portabilidade entre execução local e provedores gerenciados.

Firestore/Firebase continua útil como serviço complementar de push mobile por FCM, mas não será a fonte principal dos dados do CMMS.

Referências oficiais:

- [PostgreSQL 18](https://www.postgresql.org/docs/18/)
- [Políticas de segurança por linha](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [Índices e estratégias de consulta](https://www.postgresql.org/docs/18/indexes.html)
- [Busca aproximada com pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html)

## 2. Regra de implantação

O novo banco nasce em paralelo.

```text
Apps Script + Planilhas
        │
        │ permanece operacional
        ▼
Snapshot autenticado ──► Migrador de ensaio ──► PostgreSQL de homologação
                                                    │
                                                    ▼
                                         reconciliação e testes E2E
                                                    │
                                                    ▼
                                      aprovação explícita para o corte
```

Nenhuma planilha, implantação ou arquivo do Drive foi alterado nesta fase. Nenhum dado foi copiado.

## 3. Organização dos esquemas

| Esquema | Responsabilidade |
|---|---|
| `platform` | tenants, identidade da empresa, assinatura comercial, configuração, arquivos, idempotência e outbox |
| `iam` | usuários, credenciais, sessões, papéis, capacidades, áreas, cargos e escopos |
| `cmms` | estrutura fabril, ativos, componentes, materiais, parâmetros, faixas e leituras |
| `maintenance` | checklists, planos, OS, ações, execuções, evidências, paradas, ocorrências e produção |
| `workflow` | SLA, demandas técnicas, requisitos, tramitações, assinaturas, análises e notificações |
| `governance` | documentos, revisões, importações, backups e quarentena |
| `audit` | trilha administrativa imutável |
| `migration` | execuções do migrador, snapshots, mapa de IDs, resultado por linha e reconciliação |

## 4. Decisões estruturais

### 4.1 Multiempresa

Cada registro operacional possui `tenant_id`.

Todas as tabelas multiempresa têm RLS habilitada e forçada. O backend não poderá consultar dados de outro tenant mesmo que uma consulta esqueça o filtro.

O Node.js deverá definir, dentro de cada transação autenticada:

```sql
SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
SELECT set_config('app.user_id', '<user-uuid>', true);
```

O usuário do backend será separado do proprietário do banco e não terá `SUPERUSER`, `CREATEDB`, `CREATEROLE` nem `BYPASSRLS`.

### 4.2 IDs legados

O destino usa UUID como chave técnica. O identificador atual permanece em `legacy_id`.

`migration.legacy_id_map` registra:

- origem;
- ID legado;
- tabela de destino;
- UUID criado;
- hash da linha de origem.

Assim, um ensaio pode ser repetido sem perder rastreabilidade.

### 4.3 Planos e checklists

Foram separados:

- identidade do modelo de checklist;
- versão do checklist;
- etapas;
- identidade do plano;
- versão do plano;
- OS;
- ação;
- execução;
- fotografia das etapas executadas.

Uma OS não pode ser liberada se:

- a versão do plano não estiver publicada;
- o checklist não estiver publicado;
- o checklist não possuir etapas ativas;
- houver assinatura obrigatória pendente.

Uma ação não entra na fila do Operador antes da liberação da OS.

### 4.4 Tipos de resposta

Os nove tipos usados pelo contrato atual foram preservados:

1. `CONFIRMACAO`;
2. `OK_NOK`;
3. `NUMERO`;
4. `PARAMETRO`;
5. `TEXTO`;
6. `SELECAO`;
7. `EVIDENCIA`;
8. `LEITURA_OPERACIONAL`;
9. `INSTRUCAO`.

O banco valida opções, limites, parâmetros e evidências conforme o tipo.

### 4.5 Parâmetros

O acoplamento anterior entre limite e item do plano foi substituído por:

- `cmms.parameter_definitions`: o que é medido e em qual equipamento/componente;
- `cmms.parameter_policies`: faixa versionada, vigência, aprovador e hash;
- `cmms.parameter_readings`: valor real, política aplicada, origem, classificação e horário;
- `maintenance.operational_alerts`: alerta deduplicado e tratável.

Isso permite histórico de mínimo/máximo, tendência, alerta e auditoria sem alterar leituras antigas.

### 4.6 Assinaturas

`workflow.technical_signatures` é imutável e vincula:

- demanda;
- entidade;
- versão;
- usuário;
- área e cargo;
- declaração;
- hash do conteúdo;
- hash da assinatura;
- data.

Encaminhar o documento não apaga nem substitui a assinatura. Uma revogação gera um novo registro em `technical_signature_revocations`.

As políticas suportadas são:

- Qualidade ou Segurança;
- apenas Qualidade;
- apenas Segurança;
- Qualidade e Segurança;
- validadores personalizados.

### 4.7 Notificações

A notificação e o estado por destinatário foram separados:

- `workflow.notifications`;
- `workflow.notification_recipients`.

Cada usuário possui `delivered_at`, `read_at` e `dismissed_at`. Clicar em uma notificação persiste a leitura, e a rota de ação leva à entidade correta.

O `platform.outbox_events` permitirá atualização automática confiável por WebSocket ou SSE na Fase 3.

### 4.8 Arquivos

`platform.storage_objects` abstrai Google Drive, armazenamento S3 compatível ou serviço gerenciado.

Evidências, documentos, revisões, importações e backups referenciam o arquivo por chave, tamanho e checksum. A migração de linhas não será considerada concluída sem reconciliação dos arquivos.

### 4.9 Auditoria

Assinaturas, tramitações, histórico, revisões e eventos administrativos têm proteção contra `UPDATE` e `DELETE`.

O banco registra dados antes/depois, usuário, entidade, origem, trace, campos ocultados e horário.

## 5. Mapeamento das 48 abas

| Aba atual | Destino principal |
|---|---|
| `config` | `platform.configuration_versions`, `platform.configuration_drafts` e secrets externos |
| `usuarios` | `iam.users`, `iam.credentials`, `iam.user_roles`, `iam.user_technical_assignments`, `iam.user_scope_assignments` |
| `sessoes` | `iam.sessions`; sessões antigas serão arquivadas, não reutilizadas |
| `plantas` | `cmms.plants` |
| `setores` | `cmms.sectors` |
| `linhas` | `cmms.lines` |
| `ativos` | `cmms.assets` |
| `componentes` | `cmms.components` |
| `materiais` | `cmms.materials` |
| `planos_manutencao` | `maintenance.checklist_templates`, `maintenance.maintenance_plans` e suas versões |
| `plano_itens` | `maintenance.checklist_items` e `cmms.parameter_policies` |
| `plano_controle` | `maintenance.plan_trigger_state` |
| `ordens_servico` | `maintenance.work_orders` |
| `os_acoes` | `maintenance.work_order_actions` |
| `execucoes` | `maintenance.executions` |
| `checklist_execucao` | `maintenance.execution_checklist_items` |
| `evidencias` | `maintenance.evidence` e `platform.storage_objects` |
| `materiais_uso` | `maintenance.material_usage` |
| `parametros` | `cmms.parameter_definitions` e `cmms.parameter_readings` |
| `paradas_equipamento` | `maintenance.equipment_stops` |
| `paradas_manutencao` | `maintenance.maintenance_stops` |
| `ocorrencias_operacionais` | `maintenance.operational_occurrences` e `maintenance.operational_alerts` |
| `areas_tecnicas` | `iam.technical_areas` |
| `cargos_tecnicos` | `iam.technical_roles` |
| `demandas_tecnicas` | `workflow.technical_demands` e `workflow.demand_validator_requirements` |
| `demanda_tramitacoes` | `workflow.demand_events` |
| `assinaturas_tecnicas` | `workflow.technical_signatures` e `workflow.technical_signature_revocations` |
| `analises_tecnicas` | `workflow.technical_analyses` |
| `notificacoes` | `workflow.notifications` e `workflow.notification_recipients` |
| `turnos` | `maintenance.shifts` |
| `apontamentos_producao` | `maintenance.production_entries` |
| `sla_politicas` | `workflow.sla_policies`, `workflow.service_calendars`, janelas e feriados |
| `historico` | `maintenance.history_events` |
| `execucao_locks` | `maintenance.execution_locks` |
| `telemetria_sessoes` | `maintenance.telemetry_sessions` |
| `audit_log` | `audit.events` |
| `checklist_modelo_validacoes` | `maintenance.checklist_model_reviews` |
| `checklist_tipos_item` | `maintenance.checklist_item_types` |
| `checklist_validacao_regras` | `maintenance.checklist_validation_rules` |
| `modelo_checklist_auditoria` | `maintenance.checklist_model_audit` |
| `dashboard_cache` | não migra; será regenerado pelo backend |
| `configuracao_versoes` | `platform.configuration_versions` |
| `configuracao_rascunhos` | `platform.configuration_drafts` |
| `importacao_lotes` | `governance.import_batches` |
| `importacao_registros` | `governance.import_records` |
| `documentos_tecnicos` | `governance.technical_documents` |
| `documento_revisoes` | `governance.document_revisions` |
| `legado_quarentena` | `governance.legacy_quarantine` |

## 6. Estratégia de busca

- B-tree composto para filas por tenant, status, prioridade e data;
- índices parciais para ações abertas, alertas ativos, notificações não lidas e outbox pendente;
- GIN com `pg_trgm` para nome, matrícula, ativo, componente, documento, checklist e OS;
- BRIN para leituras, auditoria, telemetria, histórico e produção por data;
- view `cmms.v_asset_search` para busca por TAG, nome, localização e hierarquia;
- paginação por cursor na API, sem carregar todo o catálogo no mobile.

## 7. Hospedagem

### Desenvolvimento

PostgreSQL 18.4 local, porta isolada `55432`.

### Homologação

PostgreSQL gerenciado em projeto separado. Um plano gratuito pode ser usado para ensaio funcional, sem dados pessoais reais e com backup externo próprio.

### Produção

Plano gerenciado pago com:

- backups automáticos;
- restauração pontual;
- alta disponibilidade conforme volume;
- criptografia em trânsito e repouso;
- métricas e alertas;
- região definida;
- pool de conexões;
- política de retenção validada.

O plano gratuito do Supabase pode pausar por inatividade e não oferece backup automático; portanto, não é destino de produção. Referências: [preços](https://supabase.com/pricing) e [pausa de projetos gratuitos](https://supabase.com/docs/guides/platform/free-project-pausing).

## 8. Validação executada

O esquema foi aplicado do zero em PostgreSQL 18.4 real.

Contrato aprovado:

```text
PASS — RLS, catálogo, vínculos, publicação, assinatura,
fila e notificações validados
```

Foram testados:

- aplicação sequencial das oito migrações;
- RLS entre dois tenants;
- os nove tipos de checklist;
- rejeição de componente em equipamento incorreto;
- rejeição de checklist sem etapa;
- rejeição de OS com assinatura pendente;
- assinatura por Qualidade;
- imutabilidade da assinatura;
- liberação válida da OS;
- entrada segura da ação na fila do Operador;
- persistência de leitura da notificação.

## 9. Aprovação e continuidade

Após a aprovação deste modelo:

1. criar o backend Node.js em diretório novo;
2. criar os usuários técnicos do banco e grants mínimos;
3. implementar autenticação, autorização e contexto RLS;
4. recriar os módulos por domínio;
5. manter Apps Script como fonte operacional;
6. só depois construir o migrador e executar carga de ensaio.

Nenhum dado será migrado antes da confirmação do backup, da conclusão dos módulos necessários da Fase 3 e de nova aprovação explícita para a Fase 4.
