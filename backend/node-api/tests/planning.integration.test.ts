import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { PlanningRepository } from '../src/modules/planning/planning.repository.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = '00000000-0000-4000-8000-000000000004';

const ids = {
  admin: '00000000-0000-4000-8000-000000003001',
  quality: '00000000-0000-4000-8000-000000003002',
  safety: '00000000-0000-4000-8000-000000003003',
  maintenance: '00000000-0000-4000-8000-000000003004',
  adminRole: '00000000-0000-4000-8000-000000003011',
  validatorRole: '00000000-0000-4000-8000-000000003012',
  qualityArea: '00000000-0000-4000-8000-000000003021',
  safetyArea: '00000000-0000-4000-8000-000000003022',
  maintenanceArea: '00000000-0000-4000-8000-000000003023',
  qualityTechnicalRole: '00000000-0000-4000-8000-000000003031',
  safetyTechnicalRole: '00000000-0000-4000-8000-000000003032',
  maintenanceTechnicalRole: '00000000-0000-4000-8000-000000003033',
  plant: '00000000-0000-4000-8000-000000003041',
  sector: '00000000-0000-4000-8000-000000003042',
  line: '00000000-0000-4000-8000-000000003043',
  asset: '00000000-0000-4000-8000-000000003051',
  component: '00000000-0000-4000-8000-000000003052',
  parameter: '00000000-0000-4000-8000-000000003053',
} as const;

interface TestIdentities {
  readonly adminToken: string;
  readonly qualityToken: string;
  readonly safetyToken: string;
}

function bearer(token: string): { readonly authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function inTenantTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [tenantId, ids.admin],
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sessionToken(): { readonly raw: string; readonly hash: string } {
  const raw = `fcs_${randomBytes(32).toString('base64url')}`;
  return {
    raw,
    hash: createHash('sha256').update(raw, 'utf8').digest('hex'),
  };
}

async function seedPlanningScenario(pool: Pool): Promise<TestIdentities> {
  const admin = sessionToken();
  const quality = sessionToken();
  const safety = sessionToken();

  await inTenantTransaction(pool, async (client) => {
    await client.query(
      `
        INSERT INTO platform.tenants (
          id, legal_name, display_name, slug, environment, status
        )
        VALUES ($1, 'Planejamento Testes', 'Planejamento Testes', $2, 'DEVELOPMENT', 'ACTIVE')
      `,
      [tenantId, `planning-tests-${randomUUID()}`],
    );
    await client.query(
      `
        INSERT INTO iam.roles (
          id, tenant_id, code, name, description, role_type, protected
        )
        VALUES
          ($1, $3, 'PLANNING_ADMIN', 'Administrador', 'Teste integral.', 'ADMIN', true),
          ($2, $3, 'PLANNING_VALIDATOR', 'Validador técnico', 'Teste integral.', 'MANAGER', true)
      `,
      [ids.adminRole, ids.validatorRole, tenantId],
    );
    await client.query(
      `
        INSERT INTO iam.users (
          id, tenant_id, employee_number, name, email, first_access_required
        )
        VALUES
          ($1, $4, 'USR-PLN-ADM', 'Admin Planejamento', 'planning.admin@fabcontrol.local', false),
          ($2, $4, 'USR-PLN-QUA', 'Validador Qualidade', 'planning.quality@fabcontrol.local', false),
          ($3, $4, 'USR-PLN-SEG', 'Validador Segurança', 'planning.safety@fabcontrol.local', false)
      `,
      [ids.admin, ids.quality, ids.safety, tenantId],
    );
    await client.query(
      `
        INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
        VALUES
          ($1, $2, $5),
          ($1, $3, $6),
          ($1, $4, $6)
      `,
      [tenantId, ids.admin, ids.quality, ids.safety, ids.adminRole, ids.validatorRole],
    );
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = ANY($3::text[])
      `,
      [
        tenantId,
        ids.adminRole,
        [
          'maintenance.checklists.read',
          'maintenance.checklists.manage',
          'maintenance.checklists.publish',
          'maintenance.plans.read',
          'maintenance.plans.manage',
          'maintenance.plans.publish',
        ],
      ],
    );
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = ANY($3::text[])
      `,
      [
        tenantId,
        ids.validatorRole,
        [
          'maintenance.checklists.read',
          'maintenance.checklists.review',
          'maintenance.plans.read',
          'workflow.notifications.read',
        ],
      ],
    );
    await client.query(
      `
        INSERT INTO iam.technical_areas (
          id, tenant_id, code, name, description, validation_area,
          default_signature_required, created_by
        )
        VALUES
          ($1, $3, 'QUALITY', 'Qualidade', 'Validação de qualidade.', true, true, $4),
          ($2, $3, 'SAFETY', 'Segurança', 'Validação de segurança.', true, true, $4)
      `,
      [ids.qualityArea, ids.safetyArea, tenantId, ids.admin],
    );
    await client.query(
      `
        INSERT INTO iam.technical_roles (
          id, tenant_id, technical_area_id, code, name, description, can_sign, created_by
        )
        VALUES
          ($1, $3, $4, 'QUALITY_INSPECTOR', 'Inspetor de qualidade', 'Assinante de qualidade.', true, $6),
          ($2, $3, $5, 'SAFETY_TECHNICIAN', 'Técnico de segurança', 'Assinante de segurança.', true, $6)
      `,
      [
        ids.qualityTechnicalRole,
        ids.safetyTechnicalRole,
        tenantId,
        ids.qualityArea,
        ids.safetyArea,
        ids.admin,
      ],
    );
    await client.query(
      `
        INSERT INTO iam.user_technical_assignments (
          tenant_id, user_id, technical_area_id, technical_role_id, is_primary, assigned_by
        )
        VALUES
          ($1, $2, $4, $5, true, $6),
          ($1, $3, $7, $8, true, $6)
      `,
      [
        tenantId,
        ids.quality,
        ids.safety,
        ids.qualityArea,
        ids.qualityTechnicalRole,
        ids.admin,
        ids.safetyArea,
        ids.safetyTechnicalRole,
      ],
    );
    await client.query(
      `
        WITH inserted_user AS (
          INSERT INTO iam.users (
          id, tenant_id, employee_number, name, email, first_access_required
          )
          VALUES ($1, $2, 'USR-PLN-MAN', 'Validador Manutencao', 'planning.maintenance@fabcontrol.local', false)
          RETURNING id
        ), inserted_area AS (
          INSERT INTO iam.technical_areas (
          id, tenant_id, code, name, description, validation_area,
          default_signature_required, created_by
          )
          VALUES ($3, $2, 'MAINTENANCE', 'Manutencao', 'Especialidade fora da politica fixa.', false, false, $4)
          RETURNING id
        ), inserted_role AS (
          INSERT INTO iam.technical_roles (
          id, tenant_id, technical_area_id, code, name, description, can_sign, created_by
          )
          VALUES ($5, $2, $3, 'MAINTENANCE_TECHNICIAN', 'Tecnico de manutencao', 'Assinante fora da politica fixa.', true, $4)
          RETURNING id
        )
        INSERT INTO iam.user_technical_assignments (
          tenant_id, user_id, technical_area_id, technical_role_id, is_primary, assigned_by
        )
        VALUES ($2, $1, $3, $5, true, $4)
      `,
      [ids.maintenance, tenantId, ids.maintenanceArea, ids.admin, ids.maintenanceTechnicalRole],
    );
    for (const [userId, tokenHash] of [
      [ids.admin, admin.hash],
      [ids.quality, quality.hash],
      [ids.safety, safety.hash],
    ] as const) {
      await client.query(
        `
          INSERT INTO iam.sessions (
            tenant_id, user_id, token_hash_sha256, environment, scope,
            ip_address, expires_at
          )
          VALUES (
            $1, $2, $3, 'DEVELOPMENT', '{"purpose":"APPLICATION"}'::jsonb,
            '127.0.0.1', clock_timestamp() + interval '1 hour'
          )
        `,
        [tenantId, userId, tokenHash],
      );
    }
    await client.query(
      `
        INSERT INTO cmms.plants (id, tenant_id, tag, name)
        VALUES ($1, $2, 'PLT-PLN', 'Planta Planejamento')
      `,
      [ids.plant, tenantId],
    );
    await client.query(
      `
        INSERT INTO cmms.sectors (id, tenant_id, plant_id, tag, name)
        VALUES ($1, $2, $3, 'SET-PLN', 'Setor Planejamento')
      `,
      [ids.sector, tenantId, ids.plant],
    );
    await client.query(
      `
        INSERT INTO cmms.lines (id, tenant_id, sector_id, tag, name)
        VALUES ($1, $2, $3, 'LIN-PLN', 'Linha Planejamento')
      `,
      [ids.line, tenantId, ids.sector],
    );
    await client.query(
      `
        INSERT INTO cmms.assets (
          id, tenant_id, line_id, tag, qr_payload, name, asset_type,
          criticality, operational_status
        )
        VALUES (
          $1, $2, $3, 'EQ-PLN-001', 'fabcontrol://asset/test',
          'Bomba de Teste', 'PUMP', 'HIGH', 'OPERATING'
        )
      `,
      [ids.asset, tenantId, ids.line],
    );
    await client.query(
      `
        INSERT INTO cmms.components (
          id, tenant_id, asset_id, tag, qr_payload, name, component_type,
          criticality, operational_status
        )
        VALUES (
          $1, $2, $3, 'CMP-PLN-001', 'fabcontrol://component/test',
          'Rolamento de Teste', 'BEARING', 'HIGH', 'OPERATING'
        )
      `,
      [ids.component, tenantId, ids.asset],
    );
    await client.query(
      `
        INSERT INTO cmms.parameter_definitions (
          id, tenant_id, asset_id, component_id, code, name, unit,
          value_type, source_type
        )
        VALUES (
          $1, $2, $3, $4, 'TEMPERATURE', 'Temperatura', '°C',
          'DECIMAL', 'MANUAL'
        )
      `,
      [ids.parameter, tenantId, ids.asset, ids.component],
    );
  });

  return {
    adminToken: admin.raw,
    qualityToken: quality.raw,
    safetyToken: safety.raw,
  };
}

function itemPayload(
  type: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    titulo: `Etapa ${type}`,
    instrucao: 'Instrução controlada de teste.',
    tipo_resposta: type,
    categoria: 'OPERACIONAL',
    obrigatoria: type !== 'INSTRUCAO',
    exige_evidencia: type === 'EVIDENCIA',
    minimo_fotos: type === 'EVIDENCIA' ? 1 : 0,
    bloqueia_conclusao: type !== 'INSTRUCAO',
    parametro_id: type === 'PARAMETRO' || type === 'LEITURA_OPERACIONAL' ? ids.parameter : null,
    valor_esperado: null,
    valor_minimo: type === 'NUMERO' || type === 'PARAMETRO' ? 0 : null,
    valor_maximo: type === 'NUMERO' || type === 'PARAMETRO' ? 100 : null,
    unidade: type === 'PARAMETRO' || type === 'LEITURA_OPERACIONAL' ? '°C' : null,
    opcoes: type === 'SELECAO' ? ['APTO', 'NAO_APTO'] : [],
    regra_validacao: null,
    peso: 1,
    ...overrides,
  };
}

test(
  'fluxo versionado: nove tipos, dupla validação, publicação, imutabilidade e planos',
  { skip: !integrationEnabled, timeout: 60_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const identities = await seedPlanningScenario(pool);
    const app = await buildApp({
      environment: createTestEnvironment(databaseUrl, tenantId),
      logger: false,
    });
    const adminHeaders = bearer(identities.adminToken);

    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const typesResponse = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/checklist-item-types',
      headers: adminHeaders,
    });
    assert.equal(typesResponse.statusCode, 200, typesResponse.body);
    assert.equal(typesResponse.json().data.tipos.length, 9);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/checklists',
      headers: adminHeaders,
      payload: {
        codigo: 'CHK-PLN-001',
        nome: 'Checklist integral de teste',
        ativo_id: ids.asset,
        componente_id: ids.component,
        tipo: 'PREVENTIVE',
        criticidade: 'HIGH',
        area_tecnica_id: ids.qualityArea,
        cargo_tecnico_id: null,
        politica_assinatura: 'QUALIDADE_E_SEGURANCA',
        assinaturas_exigidas: 2,
        segregacao_exigida: true,
        orientacao_gestor: 'Validar segurança e qualidade.',
        requisitos_seguranca: ['Aplicar LOTO'],
      },
    });
    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const checklistId: string = createResponse.json().data.id;

    const invalidSelection = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/items`,
      headers: adminHeaders,
      payload: itemPayload('SELECAO', { opcoes: ['UNICA'] }),
    });
    assert.equal(invalidSelection.statusCode, 422, invalidSelection.body);

    const responseTypes = [
      'INSTRUCAO',
      'CONFIRMACAO',
      'OK_NOK',
      'NUMERO',
      'PARAMETRO',
      'TEXTO',
      'SELECAO',
      'EVIDENCIA',
      'LEITURA_OPERACIONAL',
    ] as const;
    for (const responseType of responseTypes) {
      const itemResponse = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/checklists/${checklistId}/items`,
        headers: adminHeaders,
        payload: itemPayload(responseType),
      });
      assert.equal(itemResponse.statusCode, 200, itemResponse.body);
    }

    const submitResponse = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/submit-configured`,
      headers: adminHeaders,
      payload: {
        politica_assinatura: 'QUALIDADE_E_SEGURANCA',
        comentario: 'Validar segurança, qualidade, riscos e critérios de aceite.',
        exige_segregacao: true,
        responsavel_atual_id: null,
        usuarios_validadores: [],
      },
    });
    assert.equal(submitResponse.statusCode, 200, submitResponse.body);
    assert.equal(submitResponse.json().data.versao_atual.status, 'IN_REVIEW');
    assert.equal(submitResponse.json().data.itens.length, 9);

    const qualityNotifications = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true',
      headers: bearer(identities.qualityToken),
    });
    assert.equal(qualityNotifications.statusCode, 200, qualityNotifications.body);
    assert.equal(qualityNotifications.json().data.contadores.nao_lidas, 1);
    assert.equal(qualityNotifications.json().data.itens.length, 1);
    assert.equal(qualityNotifications.json().data.itens[0].tipo, 'CHECKLIST_VALIDATION_REQUESTED');
    assert.equal(qualityNotifications.json().data.itens[0].entidade_tipo, 'CHECKLIST_MODELO');
    assert.equal(qualityNotifications.json().data.itens[0].entidade_id, checklistId);

    const safetyNotifications = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true',
      headers: bearer(identities.safetyToken),
    });
    assert.equal(safetyNotifications.statusCode, 200, safetyNotifications.body);
    assert.equal(safetyNotifications.json().data.contadores.nao_lidas, 1);
    assert.equal(safetyNotifications.json().data.itens.length, 1);
    assert.equal(safetyNotifications.json().data.itens[0].tipo, 'CHECKLIST_VALIDATION_REQUESTED');
    assert.equal(safetyNotifications.json().data.itens[0].entidade_id, checklistId);

    const submittedVersion = submitResponse.json().data.versao_atual;
    await inTenantTransaction(pool, async (client) => {
      const repository = new PlanningRepository();
      const notificationInput = {
        checklistId,
        versionId: String(submittedVersion.id),
        contentHash: String(submittedVersion.hash_conteudo),
        title: 'Validar checklist: Checklist integral de teste',
        message: 'Reenvio idempotente do mesmo evento.',
        priority: 'HIGH',
        signaturePolicy: 'QUALIDADE_E_SEGURANCA',
      } as const;
      const firstId = await repository.createChecklistValidationNotification(
        client,
        tenantId,
        notificationInput,
      );
      const secondId = await repository.createChecklistValidationNotification(
        client,
        tenantId,
        notificationInput,
      );
      assert.equal(secondId, firstId);
      const coverage = await repository.attachChecklistValidationRecipients(
        client,
        tenantId,
        secondId,
        String(submittedVersion.id),
        'QUALIDADE_E_SEGURANCA',
      );
      assert.equal(coverage.recipientCount, 2);
      assert.deepEqual(new Set(coverage.areaCodes), new Set(['QUALITY', 'SAFETY']));
    });

    const notificationPersistence = await inTenantTransaction(pool, async (client) => {
      const notificationCount = await client.query<{ total: number }>(
        `SELECT count(*)::integer AS total
         FROM workflow.notifications
         WHERE entity_type = 'CHECKLIST_MODELO' AND entity_id = $1`,
        [checklistId],
      );
      const recipientCount = await client.query<{ total: number }>(
        `SELECT count(*)::integer AS total
         FROM workflow.notification_recipients recipient
         JOIN workflow.notifications notification ON notification.id = recipient.notification_id
         WHERE notification.entity_type = 'CHECKLIST_MODELO' AND notification.entity_id = $1`,
        [checklistId],
      );
      return {
        notifications: notificationCount.rows[0]?.total ?? 0,
        recipients: recipientCount.rows[0]?.total ?? 0,
      };
    });
    assert.deepEqual(notificationPersistence, { notifications: 1, recipients: 2 });

    const immutableThroughApi = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/items`,
      headers: adminHeaders,
      payload: itemPayload('TEXTO'),
    });
    assert.equal(immutableThroughApi.statusCode, 409, immutableThroughApi.body);

    const qualityReview = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/review`,
      headers: bearer(identities.qualityToken),
      payload: { decisao: 'APPROVED', justificativa: 'Qualidade aprovada.' },
    });
    assert.equal(qualityReview.statusCode, 200, qualityReview.body);
    assert.equal(qualityReview.json().data.versao_atual.status, 'IN_REVIEW');

    const safetyReview = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/review`,
      headers: bearer(identities.safetyToken),
      payload: { decisao: 'APPROVED', justificativa: 'Segurança aprovada.' },
    });
    assert.equal(safetyReview.statusCode, 200, safetyReview.body);
    assert.equal(safetyReview.json().data.versao_atual.status, 'APPROVED');

    for (const token of [identities.qualityToken, identities.safetyToken]) {
      const resolvedNotifications = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(token),
      });
      assert.equal(resolvedNotifications.statusCode, 200, resolvedNotifications.body);
      assert.equal(resolvedNotifications.json().data.contadores.nao_lidas, 0);
      assert.equal(resolvedNotifications.json().data.itens.length, 0);
    }
    const resolvedNotificationPersistence = await inTenantTransaction(pool, async (client) => {
      const result = await client.query<{ status: string; pending_recipients: number }>(
        `
          SELECT
            notification.status,
            count(*) FILTER (
              WHERE recipient.read_at IS NULL OR recipient.dismissed_at IS NULL
            )::integer AS pending_recipients
          FROM workflow.notifications notification
          JOIN workflow.notification_recipients recipient
            ON recipient.notification_id = notification.id
           AND recipient.tenant_id = notification.tenant_id
          WHERE notification.tenant_id = $1
            AND notification.action_payload ->> 'checklistVersionId' = $2
          GROUP BY notification.status
        `,
        [tenantId, String(submittedVersion.id)],
      );
      return result.rows[0];
    });
    assert.deepEqual(resolvedNotificationPersistence, {
      status: 'RETRACTED',
      pending_recipients: 0,
    });

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200, publishResponse.body);
    assert.equal(publishResponse.json().data.versao_atual.status, 'PUBLISHED');
    const publishedVersionId: string = publishResponse.json().data.versao_atual.id;
    const publishedItemId: string = publishResponse.json().data.itens[0].id;

    await assert.rejects(
      inTenantTransaction(pool, async (client) => {
        await client.query(
          `UPDATE maintenance.checklist_items SET title = 'Mutação proibida' WHERE id = $1`,
          [publishedItemId],
        );
      }),
      /só podem ser alteradas em uma revisão editável/iu,
    );

    const createPlanResponse = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/plans',
      headers: adminHeaders,
      payload: {
        codigo: 'PLN-PLN-001',
        nome: 'Plano periódico integral',
        ativo_id: ids.asset,
        componente_id: ids.component,
        tipo: 'PREVENTIVE',
        checklist_versao_id: publishedVersionId,
        criticidade: 'HIGH',
        tipo_disparo: 'PERIODICITY',
        valor_disparo: null,
        unidade_disparo: 'DAYS',
        recorrencia_dias: 30,
        duracao_estimada_minutos: 60,
        exige_loto: true,
        exige_evidencia: true,
        maximo_sessoes: 1,
        modo_parada: 'MANDATORY_STOP',
        analise_tecnica: { objetivo: 'Homologar plano periódico.' },
        area_tecnica_id: ids.qualityArea,
      },
    });
    assert.equal(createPlanResponse.statusCode, 200, createPlanResponse.body);
    const planId: string = createPlanResponse.json().data.id;

    const planListResponse = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/plans?busca=integral',
      headers: adminHeaders,
    });
    assert.equal(planListResponse.statusCode, 200, planListResponse.body);
    assert.equal(planListResponse.json().data.itens.length, 1);
    assert.equal(planListResponse.json().data.itens[0].id, planId);
    assert.equal(planListResponse.json().data.itens[0].plano_itens_count, 9);
    assert.equal(planListResponse.json().data.itens[0].exige_loto, true);
    assert.equal(planListResponse.json().data.itens[0].modo_parada, 'MANDATORY_STOP');

    const publishPlanResponse = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/plans/${planId}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishPlanResponse.statusCode, 200, publishPlanResponse.body);
    assert.equal(publishPlanResponse.json().data.versao_atual.status, 'PUBLISHED');

    const planRevisionResponse = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/plans/${planId}/revisions`,
      headers: adminHeaders,
    });
    assert.equal(planRevisionResponse.statusCode, 200, planRevisionResponse.body);
    assert.equal(planRevisionResponse.json().data.versao_atual.status, 'DRAFT');
    assert.equal(planRevisionResponse.json().data.versao_atual.revisao, 2);

    const checklistRevisionResponse = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${checklistId}/revisions`,
      headers: adminHeaders,
    });
    assert.equal(checklistRevisionResponse.statusCode, 200, checklistRevisionResponse.body);
    assert.equal(checklistRevisionResponse.json().data.versao_atual.status, 'DRAFT');
    assert.equal(checklistRevisionResponse.json().data.versao_atual.revisao, 2);
    assert.equal(checklistRevisionResponse.json().data.itens.length, 9);

    const aggregateResponse = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/checklists/save',
      headers: adminHeaders,
      payload: {
        checklist_id: null,
        analise_tecnica_origem_id: null,
        checklist: {
          codigo: 'CHK-PLN-AGGREGATE',
          nome: 'Checklist atômico com rota nominal',
          ativo_id: ids.asset,
          componente_id: ids.component,
          tipo: 'INSPECTION',
          criticidade: 'CRITICAL',
          area_tecnica_id: null,
          cargo_tecnico_id: null,
          politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
          assinaturas_exigidas: 1,
          segregacao_exigida: true,
          orientacao_gestor: null,
          requisitos_seguranca: ['Confirmar bloqueio antes da inspeção'],
        },
        itens: [
          {
            id: null,
            parametro_nome: 'Pressão do rolamento',
            ...itemPayload('PARAMETRO', {
              parametro_id: null,
              unidade: 'bar',
              valor_minimo: 2,
              valor_maximo: 6,
            }),
          },
          { id: null, parametro_nome: null, ...itemPayload('TEXTO') },
        ],
      },
    });
    assert.equal(aggregateResponse.statusCode, 200, aggregateResponse.body);
    assert.equal(aggregateResponse.json().data.itens.length, 2);
    assert.ok(aggregateResponse.json().data.itens[0].parametro_id);
    const aggregateChecklistId: string = aggregateResponse.json().data.id;

    const invalidFixedPolicyValidator = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${aggregateChecklistId}/submit-configured`,
      headers: adminHeaders,
      payload: {
        politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
        comentario: 'Validador explicitamente selecionado fora das areas permitidas.',
        exige_segregacao: true,
        responsavel_atual_id: ids.maintenance,
        usuarios_validadores: [ids.maintenance],
      },
    });
    assert.equal(invalidFixedPolicyValidator.statusCode, 422, invalidFixedPolicyValidator.body);
    assert.equal(
      invalidFixedPolicyValidator.json().error.code,
      'CHECKLIST_VALIDATION_RECIPIENT_REQUIRED',
    );

    const configuredSubmit = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${aggregateChecklistId}/submit-configured`,
      headers: adminHeaders,
      payload: {
        politica_assinatura: 'PERSONALIZADA',
        comentario: 'Validar os limites e a segurança da leitura.',
        exige_segregacao: true,
        responsavel_atual_id: ids.quality,
        usuarios_validadores: [ids.quality],
      },
    });
    assert.equal(configuredSubmit.statusCode, 200, configuredSubmit.body);
    assert.equal(configuredSubmit.json().data.versao_atual.status, 'IN_REVIEW');
    assert.equal(configuredSubmit.json().data.versao_atual.assinaturas_exigidas, 1);

    const unselectedReview = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${aggregateChecklistId}/review`,
      headers: bearer(identities.safetyToken),
      payload: { decisao: 'APPROVED', justificativa: 'Tentativa fora da rota.' },
    });
    assert.equal(unselectedReview.statusCode, 403, unselectedReview.body);

    const selectedReview = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/checklists/${aggregateChecklistId}/review`,
      headers: bearer(identities.qualityToken),
      payload: { decisao: 'APPROVED', justificativa: 'Rota nominal aprovada.' },
    });
    assert.equal(selectedReview.statusCode, 200, selectedReview.body);
    assert.equal(selectedReview.json().data.versao_atual.status, 'APPROVED');

    const protectedDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/maintenance/checklists/${aggregateChecklistId}`,
      headers: adminHeaders,
    });
    assert.equal(protectedDelete.statusCode, 409, protectedDelete.body);

    const draftToDelete = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/checklists/save',
      headers: adminHeaders,
      payload: {
        checklist_id: null,
        analise_tecnica_origem_id: null,
        checklist: {
          codigo: 'CHK-PLN-DELETE',
          nome: 'Rascunho descartável',
          ativo_id: ids.asset,
          componente_id: null,
          tipo: 'INSPECTION',
          criticidade: 'LOW',
          area_tecnica_id: null,
          cargo_tecnico_id: null,
          politica_assinatura: 'QUALIDADE',
          assinaturas_exigidas: 1,
          segregacao_exigida: true,
          orientacao_gestor: null,
          requisitos_seguranca: [],
        },
        itens: [{ id: null, parametro_nome: null, ...itemPayload('CONFIRMACAO') }],
      },
    });
    assert.equal(draftToDelete.statusCode, 200, draftToDelete.body);
    const deleteDraft = await app.inject({
      method: 'DELETE',
      url: `/v1/maintenance/checklists/${draftToDelete.json().data.id}`,
      headers: adminHeaders,
    });
    assert.equal(deleteDraft.statusCode, 200, deleteDraft.body);
    assert.equal(deleteDraft.json().data.deleted, true);
  },
);
