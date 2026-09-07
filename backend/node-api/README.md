# Fab Control Node API

Backend transacional em Node.js, Fastify e PostgreSQL. Durante a migração, esta API permanece paralela ao Apps Script e não é a fonte operacional de produção.

## Requisitos

- Node.js 24 LTS;
- npm 11;
- PostgreSQL 18;
- banco criado pelas migrações em `database/postgres/migrations`;
- usuário de runtime membro de `fab_control_runtime`, sem privilégios administrativos.

## Instalação

```powershell
npm ci
Copy-Item .env.example .env
```

Preencha `.env` apenas com credenciais locais. O arquivo `.env` é ignorado pelo Git.

## Comandos

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run validate
npm run seed:homologation
```

Validação integral com PostgreSQL local isolado:

```powershell
.\scripts\test-local.ps1
```

## Rotas implementadas

| Método | Rota                    | Finalidade                          |
| ------ | ----------------------- | ----------------------------------- |
| `GET`  | `/health/live`          | processo ativo                      |
| `GET`  | `/health/ready`         | API e PostgreSQL prontos            |
| `GET`  | `/v1/bootstrap`         | versões e capacidades públicas      |
| `POST` | `/v1/auth/login`        | login por matrícula e senha         |
| `POST` | `/v1/auth/first-access` | troca da senha temporária           |
| `POST` | `/v1/auth/recovery`     | solicitação genérica de recuperação |
| `GET`  | `/v1/auth/session`      | identidade, papéis e capacidades    |
| `POST` | `/v1/auth/logout`       | revogação imediata da sessão        |

### Catálogo CMMS

| Método         | Rota                                        | Finalidade                                   |
| -------------- | ------------------------------------------- | -------------------------------------------- |
| `GET`          | `/v1/cmms/structure`                        | árvore de plantas, setores e linhas          |
| `POST`/`PATCH` | `/v1/cmms/plants[/:plantId]`                | cadastro e desativação de plantas            |
| `POST`/`PATCH` | `/v1/cmms/sectors[/:sectorId]`              | cadastro e desativação de setores            |
| `POST`/`PATCH` | `/v1/cmms/lines[/:lineId]`                  | cadastro e desativação de linhas             |
| `GET`/`POST`   | `/v1/cmms/assets`                           | pesquisa paginada e cadastro de ativos       |
| `GET`/`PATCH`  | `/v1/cmms/assets/:assetId`                  | ficha técnica e alteração de ativo           |
| `GET`          | `/v1/cmms/assets/resolve/:code`             | resolução de TAG ou QR Code canônico         |
| `GET`/`POST`   | `/v1/cmms/assets/:assetId/components`       | componentes vinculados ao ativo              |
| `PATCH`        | `/v1/cmms/components/:componentId`          | alteração ou desativação de componente       |
| `GET`/`POST`   | `/v1/cmms/materials`                        | estoque técnico e cadastro de materiais      |
| `PATCH`        | `/v1/cmms/materials/:materialId`            | estoque, cadastro ou situação do material    |
| `POST`/`PATCH` | `/v1/cmms/parameters[/:parameterId]`        | definições técnicas de parâmetros            |
| `POST`         | `/v1/cmms/parameters/:parameterId/policies` | versão imutável de limites                   |
| `GET`/`POST`   | `/v1/cmms/parameters/:parameterId/readings` | histórico e registro idempotente de leituras |

### Checklists e planos de manutenção

| Método                | Rota                                                      | Finalidade                                   |
| --------------------- | --------------------------------------------------------- | -------------------------------------------- |
| `GET`                 | `/v1/maintenance/checklist-item-types`                    | catálogo dos nove tipos de resposta          |
| `GET`/`POST`          | `/v1/maintenance/checklists`                              | pesquisa e criação de modelos versionados    |
| `GET`/`PATCH`         | `/v1/maintenance/checklists/:checklistId`                 | modelo, revisões, etapas e pareceres         |
| `POST`/`PUT`/`DELETE` | `/v1/maintenance/checklists/:checklistId/items[/:itemId]` | composição do rascunho                       |
| `POST`                | `/v1/maintenance/checklists/:checklistId/items/reorder`   | reordenação atômica das etapas               |
| `POST`                | `/v1/maintenance/checklists/:checklistId/submit`          | selagem e envio ao filtro técnico            |
| `POST`                | `/v1/maintenance/checklists/:checklistId/review`          | parecer permanente de Qualidade ou Segurança |
| `POST`                | `/v1/maintenance/checklists/:checklistId/publish`         | publicação de revisão integralmente aprovada |
| `POST`                | `/v1/maintenance/checklists/:checklistId/revisions`       | nova revisão sem alterar a publicada         |
| `GET`/`POST`          | `/v1/maintenance/plans`                                   | pesquisa e criação de planos                 |
| `GET`/`PATCH`         | `/v1/maintenance/plans/:planId`                           | consulta e alteração da revisão editável     |
| `POST`                | `/v1/maintenance/plans/:planId/publish`                   | publicação com checklist executável          |
| `POST`                | `/v1/maintenance/plans/:planId/revisions`                 | nova revisão preservando o histórico         |

### Ordens, validação e execução

| Método       | Rota                                                                  | Finalidade                                                          |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET`/`POST` | `/v1/maintenance/work-orders`                                         | fila administrativa e criação de OS por plano publicado             |
| `GET`        | `/v1/maintenance/work-orders/:workOrderId`                            | OS, conteúdo selado, requisitos, assinaturas e ações                |
| `PATCH`      | `/v1/maintenance/work-orders/:workOrderId`                            | corrige OS devolvida e preserva a revisão anterior                  |
| `POST`       | `/v1/maintenance/work-orders/:workOrderId/submit-review`              | envia conteúdo imutável à validação técnica                         |
| `POST`       | `/v1/workflow/technical-demands/:demandId/sign`                       | assinatura permanente de Qualidade ou Segurança                     |
| `POST`       | `/v1/workflow/technical-demands/:demandId/request-changes`            | devolução rastreável ao Administrador                               |
| `POST`       | `/v1/maintenance/work-orders/:workOrderId/release`                    | libera somente após cumprir plano, checklist e assinaturas          |
| `GET`        | `/v1/maintenance/operator-actions`                                    | fila do Operador sem ações concluídas                               |
| `POST`       | `/v1/maintenance/operator-actions/:actionId/assume`                   | atribui a ação e materializa a revisão publicada do checklist       |
| `GET`        | `/v1/maintenance/executions/:executionId`                             | execução, etapas, respostas e contadores de evidência               |
| `POST`       | `/v1/maintenance/executions/:executionId/start`                       | inicia execução atribuída                                           |
| `PUT`        | `/v1/maintenance/executions/:executionId/items/:itemId/response`      | valida e persiste resposta conforme o tipo da etapa                 |
| `POST`       | `/v1/maintenance/executions/:executionId/items/:itemId/evidence`      | preserva a vinculação legada por referência de objeto               |
| `POST`       | `/v1/maintenance/executions/:executionId/items/:itemId/evidence-file` | recebe foto privada validada e atualiza a suficiência de evidências |
| `GET`        | `/v1/maintenance/evidence-files/:objectId`                            | entrega evidência privada somente para sessão autorizada            |
| `POST`       | `/v1/maintenance/executions/:executionId/complete`                    | conclui sem permitir respostas ou evidências obrigatórias ausentes  |

### Ocorrências, paradas, alertas e notificações

| Método       | Rota                                                           | Finalidade                                      |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------- |
| `GET`/`POST` | `/v1/maintenance/occurrences`                                  | consulta e registro de ocorrências operacionais |
| `GET`        | `/v1/maintenance/occurrences/:occurrenceId`                    | ocorrência, parada, análise e OS relacionadas   |
| `POST`       | `/v1/maintenance/occurrences/:occurrenceId/technical-analysis` | análise técnica enviada ao Administrador        |
| `GET`/`POST` | `/v1/maintenance/stops`                                        | consulta e abertura de paradas rastreáveis      |
| `GET`        | `/v1/maintenance/stops/:stopId`                                | tempos e estado atual da parada                 |
| `POST`       | `/v1/maintenance/stops/:stopId/transition`                     | manutenção, retorno operacional e conclusão     |
| `GET`        | `/v1/maintenance/alerts`                                       | fila deduplicada de alertas técnicos            |
| `POST`       | `/v1/maintenance/alerts/:alertId/acknowledge`                  | reconhecimento do alerta                        |
| `POST`       | `/v1/maintenance/alerts/:alertId/create-occurrence`            | converte alerta em ocorrência                   |
| `GET`        | `/v1/notifications`                                            | central operacional e contadores persistentes   |
| `PATCH`      | `/v1/notifications/:notificationId/read`                       | registra leitura por usuário                    |
| `PATCH`      | `/v1/notifications/:notificationId/dismiss`                    | dispensa uma notificação                        |
| `POST`       | `/v1/notifications/read-all`                                   | registra leitura em lote                        |
| `GET`        | `/v1/analytics/technical-summary`                              | disponibilidade, MTTR, MTBF, SLA e ranking      |

O backend não estima OEE sem dados de produção, ciclo ideal e qualidade.

Todas as rotas de domínio exigem sessão ativa e capacidade específica calculada no servidor.

## Massa controlada de homologação

O seed é bloqueado em produção, exige cinco senhas fornecidas por variáveis de ambiente e pode ser executado repetidamente sem duplicar registros.

```powershell
$env:DEMO_ADMIN_PASSWORD = '<senha-forte>'
$env:DEMO_QUALITY_PASSWORD = '<senha-forte>'
$env:DEMO_SAFETY_PASSWORD = '<senha-forte>'
$env:DEMO_MAINTENANCE_PASSWORD = '<senha-forte>'
$env:DEMO_OPERATOR_PASSWORD = '<senha-forte>'
npm run seed:homologation
```

A carga dos blocos 3.2 a 3.4 inclui cinco perfis, áreas de Qualidade, Segurança e Manutenção, estrutura fabril, quatro estados operacionais de ativos, componentes, materiais, parâmetros, faixas, leituras normais/críticas, alerta operacional, um checklist publicado contendo os nove tipos de etapa, pareceres permanentes de Qualidade e Segurança, dois planos publicados, uma OS aguardando dupla assinatura e uma ação liberada para o Operador.

## Segurança aplicada

- Argon2id com `m=19456`, `t=2`, `p=1` e pepper externo;
- senha mínima de 12 caracteres, com maiúscula, minúscula, número e símbolo;
- token opaco aleatório; somente SHA-256 é persistido;
- sessão revogável com prazo;
- token de primeiro acesso separado e de curta duração;
- bloqueio progressivo por tentativas;
- resposta genérica para recuperação e credenciais inválidas;
- rate limit;
- Helmet e CORS explícito;
- logs com campos sensíveis ocultados;
- auditoria de login, primeiro acesso, recuperação e logout;
- autorização por capacidade em cada rota CMMS;
- paginação por cursor e busca preparada para índices;
- leitura técnica idempotente e classificação no PostgreSQL;
- histórico imutável de ativos e auditoria de todas as mutações;
- ausência de rotas de exclusão física no catálogo;
- contexto RLS definido dentro da transação.
- revisões publicadas de checklists e planos imutáveis;
- hash SHA-256 recalculado antes da publicação;
- dupla validação opcional por Qualidade e Segurança;
- plano impedido de publicar sem checklist publicado e executável.
- OS impedida de nascer sem plano publicado e checklist com etapas ativas;
- conteúdo da OS selado por SHA-256 antes da validação técnica;
- assinaturas permanentes vinculadas à entidade, versão, conteúdo, área e identidade;
- liberação bloqueada no PostgreSQL enquanto houver requisito técnico pendente;
- checklist da execução materializado como snapshot para impedir alteração retroativa;
- conclusão bloqueada no PostgreSQL enquanto faltarem respostas ou evidências;
- evidências novas armazenadas fora da área pública, com MIME validado por assinatura binária, limite estrito, SHA-256 e download autenticado;
- referências legadas do Google preservadas e expostas somente quando usam hosts HTTPS permitidos;
- etapa de parâmetro gera leitura técnica classificada e auditável;
- registros concluídos desaparecem da fila operacional e permanecem no histórico.

## Regra operacional

Não apontar os frontends de Administrador, Gestor ou Operador para esta API antes da conclusão dos módulos de domínio, da Fase 4 de migração e da aprovação formal do corte.
