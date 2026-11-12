import fastifyPlugin from 'fastify-plugin';
import { Type } from '@fastify/type-provider-typebox';
import { AppError } from '../../core/errors/app-error.js';
import { MonitoringService } from '../monitoring/monitoring.service.js';
import { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import { assertSharedAsset, observerArea } from './shared-workflow.js';
import { OperationsRepository } from './operations.repository.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { createOccurrenceBodySchema } from '../monitoring/monitoring.schemas.js';
import type { OccurrenceAssessment } from '../monitoring/occurrence-assessment.js';
import { suggestOccurrencePriority } from '../monitoring/occurrence-assessment.js';

const uuid = Type.String({ format: 'uuid' });
type ListQuery = { busca?: string; pagina?: number; ativo_id?: string; situacao?: string };
const listSchema = Type.Object(
  {
    busca: Type.Optional(Type.String({ maxLength: 160 })),
    pagina: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    ativo_id: Type.Optional(uuid),
    situacao: Type.Optional(
      Type.Union([Type.Literal('ALL'), Type.Literal('OPEN'), Type.Literal('CLOSED')]),
    ),
  },
  { additionalProperties: false },
);
const requestSchema = Type.Object(
  {
    ativo_id: uuid,
    titulo: Type.String({ minLength: 3, maxLength: 240 }),
    descricao: Type.String({ minLength: 10, maxLength: 8000 }),
    tipo: Type.Union(
      ['CORRECTIVE', 'PREVENTIVE', 'LUBRICATION', 'INSPECTION', 'IMPROVEMENT'].map((value) =>
        Type.Literal(value),
      ),
    ),
    qualidade: Type.Boolean(),
    seguranca: Type.Boolean(),
    chave_envio: uuid,
    triagem: createOccurrenceBodySchema.properties.triagem,
    foto: createOccurrenceBodySchema.properties.foto,
  },
  { additionalProperties: false },
);
interface RequestBody {
  ativo_id: string;
  titulo: string;
  descricao: string;
  tipo: string;
  qualidade: boolean;
  seguranca: boolean;
  chave_envio: string;
  triagem?: OccurrenceAssessment;
  foto?: string;
}
const missing = () =>
  new AppError({
    code: 'NOT_FOUND',
    message: 'Registro não encontrado na sua unidade.',
    statusCode: 404,
  });

export const sharedWorkflowPlugin = fastifyPlugin(
  async (app) => {
    const monitoring = new MonitoringService(app.database),
      repository = new OperationsRepository();
    const envelope = (data: unknown) => ({ ok: true, data });
    app.get<{ Querystring: { pagina?: number } }>(
      '/v1/shared/assets',
      {
        schema: {
          querystring: Type.Object(
            { pagina: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })) },
            { additionalProperties: false },
          ),
        },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.request'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const items = await client.query(
                `SELECT a.id,a.tag,a.name AS nome,s.id AS setor_id,s.name AS setor,l.id AS linha_id,l.name AS linha,p.id AS planta_id,p.name AS planta FROM cmms.assets a
        JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id JOIN cmms.sectors s ON s.id=l.sector_id AND s.tenant_id=l.tenant_id
        JOIN cmms.plants p ON p.id=s.plant_id AND p.tenant_id=s.tenant_id
        WHERE a.deleted_at IS NULL AND a.lifecycle_status='ACTIVE' AND maintenance.shared_asset_visible(a.id,$1) ORDER BY a.tag,a.id LIMIT 1001 OFFSET $2`,
                [user.id, ((request.query.pagina ?? 1) - 1) * 1000],
              );
              return {
                itens: items.rows.slice(0, 1000),
                proxima_pagina: items.rows.length > 1000 ? (request.query.pagina ?? 1) + 1 : null,
              };
            },
          ),
        );
      },
    );
    app.get<{ Querystring: { codigo: string } }>(
      '/v1/shared/resolve-code',
      {
        schema: {
          querystring: Type.Object(
            { codigo: Type.String({ minLength: 1, maxLength: 500 }) },
            { additionalProperties: false },
          ),
        },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.request'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const resolved = await new CatalogRepository().resolveCode(
                client,
                request.query.codigo.trim(),
              );
              if (!resolved) throw missing();
              await assertSharedAsset(client, String(resolved.ativo_id), user.id);
              return {
                ativo_id: resolved.ativo_id,
                componente_id: resolved.componente_id,
                nome: resolved.nome,
              };
            },
          ),
        );
      },
    );
    app.post<{ Body: RequestBody }>(
      '/v1/shared/requests',
      {
        schema: { body: requestSchema },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.request'),
      },
      async (request) => {
        const user = request.auth!.user,
          b = request.body;
        return envelope(
          await monitoring.createOccurrence(
            user,
            {
              assetId: b.ativo_id,
              componentId: null,
              occurrenceType: 'SOLICITACAO_OS',
              title: b.titulo,
              description: b.descricao,
              severity: 'LOW',
              equipmentStopped: false,
              stopType: null,
              stopReason: null,
              occurredAt: null,
              ...(b.triagem ? { assessment: b.triagem } : {}),
              ...(b.foto ? { photo: b.foto } : {}),
              sharedRequest: {
                kind: b.tipo,
                quality: b.qualidade,
                safety: b.seguranca,
                submissionKey: b.chave_envio,
              },
            },
            {
              traceId: request.id,
              userAgent: request.headers['user-agent'] ?? null,
              ipAddress: request.ip,
              roleSnapshot: user.roleCodes.join(','),
            },
          ),
        );
      },
    );
    app.get<{ Querystring: ListQuery }>(
      '/v1/shared/requests',
      {
        schema: {
          querystring: listSchema,
        },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.read'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const rows = await client.query(
                `SELECT o.id,o.reported_by=$1::uuid AS minha,o.asset_id AS ativo_id,o.title AS titulo,o.description AS descricao,o.request_kind AS tipo,
        o.requested_quality AS qualidade,o.requested_safety AS seguranca,o.request_returned AS devolvida,
        o.status,o.treatment_decision_note AS parecer,o.treatment_scheduled_for AS agendada_para,o.created_at AS criada_em,
        o.work_order_id AS os_id,w.operational_code AS os_codigo,w.status AS os_status,
        a.tag AS ativo_tag,a.name AS ativo_nome,u.name AS solicitante,p.name AS pcm,
        count(*) OVER()::integer AS total
        FROM maintenance.operational_occurrences o JOIN cmms.assets a ON a.id=o.asset_id AND a.tenant_id=o.tenant_id
        JOIN iam.users u ON u.id=o.reported_by AND u.tenant_id=o.tenant_id
        LEFT JOIN iam.users p ON p.id=o.treatment_decided_by AND p.tenant_id=o.tenant_id
        LEFT JOIN maintenance.work_orders w ON w.id=o.work_order_id AND w.tenant_id=o.tenant_id
        WHERE o.request_kind IS NOT NULL AND maintenance.shared_asset_visible(a.id,$1)
        AND ($2='' OR o.title ILIKE '%'||$2||'%' OR a.tag ILIKE '%'||$2||'%')
        AND ($4::uuid IS NULL OR o.asset_id=$4) AND ($5='ALL' OR ($5='CLOSED')=(o.status IN ('CLOSED','RESOLVED','CANCELLED') OR coalesce(w.status IN ('COMPLETED','CANCELLED'),false)))
        ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET $3`,
                [
                  user.id,
                  request.query.busca ?? '',
                  ((request.query.pagina ?? 1) - 1) * 30,
                  request.query.ativo_id ?? null,
                  request.query.situacao ?? 'ALL',
                ],
              );
              return { itens: rows.rows, total: rows.rows[0]?.total ?? 0 };
            },
          ),
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/v1/shared/requests/:id',
      {
        schema: { params: Type.Object({ id: uuid }) },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.read'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const result = await client.query(
                `SELECT o.id,o.reported_by=$2::uuid AS minha,o.asset_id AS ativo_id,o.title AS titulo,o.description AS descricao,o.request_kind AS tipo,
        o.requested_quality AS qualidade,o.requested_safety AS seguranca,o.request_returned AS devolvida,o.status,o.severity AS prioridade,
        o.treatment_decision_note AS parecer,o.created_at AS criada_em,a.tag AS ativo_tag,a.name AS ativo_nome,
        u.name AS solicitante,p.name AS pcm,s.name AS setor,l.name AS linha,plant.name AS planta,w.operational_code AS os_codigo,w.status AS os_status,
        (SELECT h.payload FROM maintenance.history_events h WHERE h.payload->>'occurrenceId'=o.id::text AND h.event_type IN ('OCCURRENCE_REPORTED','SHARED_REQUEST_CORRECTED') ORDER BY h.occurred_at DESC,h.id DESC LIMIT 1) AS relato
        FROM maintenance.operational_occurrences o JOIN cmms.assets a ON a.id=o.asset_id AND a.tenant_id=o.tenant_id
        JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id JOIN cmms.sectors s ON s.id=l.sector_id AND s.tenant_id=l.tenant_id JOIN cmms.plants plant ON plant.id=s.plant_id AND plant.tenant_id=s.tenant_id
        JOIN iam.users u ON u.id=o.reported_by AND u.tenant_id=o.tenant_id LEFT JOIN iam.users p ON p.id=o.treatment_decided_by AND p.tenant_id=o.tenant_id LEFT JOIN maintenance.work_orders w ON w.id=o.work_order_id AND w.tenant_id=o.tenant_id
        WHERE o.id=$1 AND o.request_kind IS NOT NULL AND maintenance.shared_asset_visible(a.id,$2)`,
                [request.params.id, user.id],
              );
              if (!result.rows[0]) throw missing();
              return result.rows[0];
            },
          ),
        );
      },
    );
    app.put<{ Params: { id: string }; Body: RequestBody }>(
      '/v1/shared/requests/:id',
      {
        schema: { params: Type.Object({ id: uuid }), body: requestSchema },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.request'),
      },
      async (request) => {
        const user = request.auth!.user,
          b = request.body;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id },
            async (client) => {
              const current = await client.query(
                `SELECT * FROM maintenance.operational_occurrences WHERE id=$1 AND reported_by=$2
        AND request_kind IS NOT NULL FOR UPDATE`,
                [request.params.id, user.id],
              );
              const row = current.rows[0];
              if (!row) throw missing();
              await assertSharedAsset(client, row.asset_id, user.id);
              await assertSharedAsset(client, b.ativo_id, user.id);
              if (b.foto) {
                const image = Buffer.from(b.foto.split(',')[1] ?? '', 'base64');
                if (
                  image.length > 315000 ||
                  image[0] !== 255 ||
                  image[1] !== 216 ||
                  image[2] !== 255
                )
                  throw new AppError({
                    code: 'INVALID_PHOTO',
                    message: 'Foto JPEG inválida ou muito grande.',
                    statusCode: 422,
                  });
              }
              if (!row.request_returned || row.work_order_id)
                throw new AppError({
                  code: 'REQUEST_NOT_RETURNED',
                  message: 'Somente um pedido devolvido pelo PCM pode ser corrigido.',
                  statusCode: 409,
                });
              await new MonitoringRepository().writeAudit(
                client,
                user.tenantId,
                user.id,
                {
                  traceId: request.id,
                  userAgent: null,
                  ipAddress: request.ip,
                  roleSnapshot: user.roleCodes.join(','),
                },
                'SHARED_REQUEST_CORRECTED',
                'OPERATIONAL_OCCURRENCE',
                row.id,
                {
                  before: {
                    title: row.title,
                    description: row.description,
                    kind: row.request_kind,
                  },
                  after: b,
                },
              );
              await client.query(
                `UPDATE maintenance.operational_occurrences SET asset_id=$2,title=$3,description=$4,request_kind=$5,
        requested_quality=$6,requested_safety=$7,request_returned=false,status='OPEN',severity=$8,updated_at=clock_timestamp() WHERE id=$1`,
                [
                  row.id,
                  b.ativo_id,
                  b.titulo,
                  b.descricao,
                  b.tipo,
                  b.qualidade,
                  b.seguranca,
                  b.triagem ? suggestOccurrencePriority(b.triagem) : row.severity,
                ],
              );
              await new MonitoringRepository().writeHistory(
                client,
                user.tenantId,
                b.ativo_id,
                null,
                user.id,
                user.roleCodes.join(','),
                'SHARED_REQUEST_CORRECTED',
                'Solicitação corrigida pelo solicitante.',
                { occurrenceId: row.id, triagem: b.triagem ?? null, foto: b.foto ?? null },
              );
              const notifications = new MonitoringRepository();
              const notificationId = await notifications.createNotification(client, user.tenantId, {
                type: 'OCCURRENCE_REPORTED',
                title: b.titulo,
                message: 'Solicitação corrigida e reenviada para análise do PCM.',
                entityType: 'OPERATIONAL_OCCURRENCE',
                entityId: row.id,
                priority: 'LOW',
                actionRoute: `/maintenance/occurrences/${row.id}`,
                actionPayload: { entityId: row.id },
                audience: { roleCodes: ['PCM'] },
                deduplicationKey: `request:${row.id}:corrected:${b.chave_envio}`,
              });
              await notifications.attachNotificationToRoleTypes(
                client,
                user.tenantId,
                notificationId,
                [],
                user.id,
                ['PCM'],
                b.ativo_id,
              );
              return { id: row.id };
            },
          ),
        );
      },
    );
    app.get<{ Querystring: ListQuery }>(
      '/v1/shared/orders',
      {
        schema: {
          querystring: listSchema,
        },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.read'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const rows = await client.query(
                `SELECT w.id,w.operational_code AS codigo,w.title AS titulo,w.status,w.priority AS prioridade,
        w.scheduled_for AS programada_para,w.created_at AS criada_em,w.released_at AS liberada_em,w.completed_at AS encerrada_em,w.work_type AS tipo_trabalho,a.tag AS ativo_tag,a.name AS ativo_nome,s.name AS setor,l.name AS linha,plant.name AS planta,
        requester.name AS solicitante,pcm.name AS pcm,responsible.name AS responsavel,executor.name AS executor,
        x.status AS execucao_status,x.started_at AS iniciada_em,x.completed_at AS conclusao_tecnica_em,
        (SELECT jsonb_agg(jsonb_build_object('area',ob.area,'nome',u.name,'observacao',ob.note,'data',ob.created_at) ORDER BY ob.created_at)
          FROM maintenance.work_order_observations ob JOIN iam.users u ON u.id=ob.user_id AND u.tenant_id=ob.tenant_id WHERE ob.work_order_id=w.id) AS acompanhamentos,
        count(*) OVER()::integer AS total
        FROM maintenance.work_orders w JOIN cmms.assets a ON a.id=w.asset_id AND a.tenant_id=w.tenant_id
        JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id JOIN cmms.sectors s ON s.id=l.sector_id AND s.tenant_id=l.tenant_id
        JOIN cmms.plants plant ON plant.id=s.plant_id AND plant.tenant_id=s.tenant_id
        LEFT JOIN maintenance.operational_occurrences o ON o.work_order_id=w.id AND o.tenant_id=w.tenant_id
        LEFT JOIN iam.users requester ON requester.id=coalesce(o.reported_by,w.requester_id) AND requester.tenant_id=w.tenant_id
        LEFT JOIN iam.users responsible ON responsible.id=w.responsible_id AND responsible.tenant_id=w.tenant_id
        LEFT JOIN iam.users pcm ON pcm.id=w.requester_id AND pcm.tenant_id=w.tenant_id
        LEFT JOIN LATERAL(SELECT * FROM maintenance.executions e WHERE e.work_order_id=w.id ORDER BY e.created_at DESC LIMIT 1) x ON true
        LEFT JOIN iam.users executor ON executor.id=x.operator_id AND executor.tenant_id=w.tenant_id
        WHERE maintenance.shared_asset_visible(a.id,$1) AND ($2='' OR w.title ILIKE '%'||$2||'%' OR a.tag ILIKE '%'||$2||'%' OR w.operational_code ILIKE '%'||$2||'%')
        AND ($4::uuid IS NULL OR w.asset_id=$4) AND ($5='ALL' OR ($5='CLOSED')=(w.status IN ('COMPLETED','CANCELLED')))
        ORDER BY w.created_at DESC,w.id DESC LIMIT 30 OFFSET $3`,
                [
                  user.id,
                  request.query.busca ?? '',
                  ((request.query.pagina ?? 1) - 1) * 30,
                  request.query.ativo_id ?? null,
                  request.query.situacao ?? 'ALL',
                ],
              );
              return { itens: rows.rows, total: rows.rows[0]?.total ?? 0 };
            },
          ),
        );
      },
    );
    app.get<{ Params: { id: string } }>(
      '/v1/shared/orders/:id',
      {
        schema: { params: Type.Object({ id: uuid }) },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.read'),
      },
      async (request) => {
        const user = request.auth!.user;
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id, readOnly: true },
            async (client) => {
              const row = await client.query(
                'SELECT asset_id FROM maintenance.work_orders WHERE id=$1',
                [request.params.id],
              );
              if (!row.rows[0]) throw missing();
              await assertSharedAsset(client, row.rows[0].asset_id, user.id);
              const detail = await repository.getWorkOrderDetail(client, request.params.id);
              const signatures = await client.query(
                `SELECT u.name AS nome,s.role_snapshot AS perfil,s.meaning AS significado,s.signed_at AS data
        FROM workflow.technical_signatures s JOIN iam.users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
        WHERE s.technical_demand_id=(SELECT technical_demand_id FROM maintenance.work_orders WHERE id=$1)
        AND NOT EXISTS(SELECT 1 FROM workflow.technical_signature_revocations r WHERE r.technical_signature_id=s.id) ORDER BY s.signed_at`,
                [request.params.id],
              );
              const history = await client.query(
                `SELECT e.started_at AS inicio,e.completed_at AS conclusao,e.status,e.result AS resultado,u.name AS executor
        FROM maintenance.executions e JOIN iam.users u ON u.id=e.operator_id AND u.tenant_id=e.tenant_id
        WHERE e.work_order_id=$1 ORDER BY e.created_at`,
                [request.params.id],
              );
              const validation = detail?.validacao as Record<string, unknown> | null;
              const report = await client.query(
                `SELECT h.payload FROM maintenance.operational_occurrences o JOIN maintenance.history_events h
              ON h.tenant_id=o.tenant_id AND h.payload->>'occurrenceId'=o.id::text
              WHERE o.work_order_id=$1 AND h.event_type IN ('OCCURRENCE_REPORTED','SHARED_REQUEST_CORRECTED') ORDER BY h.occurred_at DESC,h.id DESC LIMIT 1`,
                [request.params.id],
              );
              return {
                id: request.params.id,
                titulo: detail?.titulo,
                descricao: detail?.descricao,
                status: detail?.status,
                politica_assinatura: validation?.politica_assinatura,
                assinaturas_exigidas: validation?.assinaturas_exigidas,
                assinaturas_realizadas: validation?.assinaturas_realizadas,
                assinaturas: signatures.rows,
                execucoes: history.rows,
                relato: report.rows[0]?.payload ?? null,
              };
            },
          ),
        );
      },
    );
    app.post<{ Params: { id: string }; Body: { area: string; observacao: string } }>(
      '/v1/shared/orders/:id/observations',
      {
        schema: {
          params: Type.Object({ id: uuid }),
          body: Type.Object(
            {
              area: Type.Union([Type.Literal('QUALITY'), Type.Literal('SAFETY')]),
              observacao: Type.String({ minLength: 3, maxLength: 4000 }),
            },
            { additionalProperties: false },
          ),
        },
        preHandler: (r) => app.authorize(r, 'maintenance.shared.read'),
      },
      async (request) => {
        const user = request.auth!.user;
        observerArea(user, request.body.area);
        if (request.body.observacao.trim().length < 3)
          throw new AppError({
            code: 'OBSERVATION_REQUIRED',
            message: 'Descreva o acompanhamento com pelo menos três caracteres.',
            statusCode: 422,
          });
        return envelope(
          await app.database.withTransaction(
            { tenantId: user.tenantId, userId: user.id },
            async (client) => {
              const row = await client.query(
                'SELECT asset_id,status,released_at FROM maintenance.work_orders WHERE id=$1 FOR UPDATE',
                [request.params.id],
              );
              if (!row.rows[0]) throw missing();
              await assertSharedAsset(client, row.rows[0].asset_id, user.id);
              if (!row.rows[0].released_at || row.rows[0].status === 'CANCELLED')
                throw new AppError({
                  code: 'ORDER_NOT_RELEASED',
                  message: 'O acompanhamento só pode ser registrado após liberação.',
                  statusCode: 409,
                });
              const observation = await client.query(
                `INSERT INTO maintenance.work_order_observations(tenant_id,work_order_id,user_id,area,note)
        VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`,
                [
                  user.tenantId,
                  request.params.id,
                  user.id,
                  request.body.area,
                  request.body.observacao.trim(),
                ],
              );
              await new MonitoringRepository().writeAudit(
                client,
                user.tenantId,
                user.id,
                {
                  traceId: request.id,
                  userAgent: null,
                  ipAddress: request.ip,
                  roleSnapshot: user.roleCodes.join(','),
                },
                'WORK_ORDER_OBSERVATION_RECORDED',
                'WORK_ORDER',
                request.params.id,
                {
                  area: request.body.area,
                  observationId: observation.rows[0]?.id,
                  note: request.body.observacao.trim(),
                },
              );
              return observation.rows[0];
            },
          ),
        );
      },
    );
  },
  { name: 'vorqix-shared-workflow', dependencies: ['fab-control-authentication'] },
);
