import type { PoolClient, QueryResultRow } from 'pg';

import type {
  ChecklistInput,
  ChecklistItemInput,
  ChecklistListQuery,
  ChecklistPatch,
  ChecklistVersionStatus,
  MaintenancePlanInput,
  MaintenancePlanPatch,
  PlanListQuery,
  RequestAuditMetadata,
  ReviewDecision,
} from './planning.types.js';

export type PlanningRow = Readonly<Record<string, unknown>>;

export interface ValidatorContextRow extends QueryResultRow {
  readonly area_id: string;
  readonly area_code: string;
  readonly role_id: string | null;
  readonly role_code: string | null;
  readonly can_sign: boolean;
}

export interface ReviewProgressRow extends QueryResultRow {
  readonly approved_count: number;
  readonly quality_approved: boolean;
  readonly safety_approved: boolean;
}

export interface ChecklistNotificationCoverage {
  readonly recipientCount: number;
  readonly areaCodes: readonly string[];
}

export class PlanningRepository {
  async listItemTypes(client: PoolClient): Promise<readonly PlanningRow[]> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          code AS codigo,
          name AS nome,
          description AS descricao,
          requires_response AS exige_resposta,
          requires_value AS exige_valor,
          requires_options AS exige_opcoes,
          supports_limit AS aceita_limites,
          supports_evidence AS aceita_evidencia,
          default_category AS categoria_padrao
        FROM maintenance.checklist_item_types
        WHERE active
        ORDER BY created_at, code
      `,
    );
    return result.rows;
  }

  async findAssetContext(
    client: PoolClient,
    assetId: string,
    componentId: string | null,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          asset.id AS ativo_id,
          asset.tag AS ativo_tag,
          asset.name AS ativo_nome,
          asset.lifecycle_status AS ativo_status,
          component.id AS componente_id,
          component.tag AS componente_tag,
          component.name AS componente_nome,
          component.lifecycle_status AS componente_status
        FROM cmms.assets asset
        LEFT JOIN cmms.components component
          ON component.tenant_id = asset.tenant_id
         AND component.id = $2
         AND component.asset_id = asset.id
         AND component.deleted_at IS NULL
        WHERE asset.id = $1
          AND asset.deleted_at IS NULL
          AND ($2::uuid IS NULL OR component.id IS NOT NULL)
        LIMIT 1
      `,
      [assetId, componentId],
    );
    return result.rows[0] ?? null;
  }

  async findParameter(
    client: PoolClient,
    parameterId: string,
    assetId: string,
    componentId: string | null,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT id, code, name, unit, value_type, status
        FROM cmms.parameter_definitions
        WHERE id = $1
          AND asset_id = $2
          AND component_id IS NOT DISTINCT FROM $3::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [parameterId, assetId, componentId],
    );
    return result.rows[0] ?? null;
  }

  async technicalScopeExists(
    client: PoolClient,
    areaId: string | null,
    roleId: string | null,
  ): Promise<boolean> {
    if (areaId === null) return roleId === null;
    const result = await client.query<{ valid: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM iam.technical_areas area
          LEFT JOIN iam.technical_roles technical_role
            ON technical_role.technical_area_id = area.id
           AND technical_role.id = $2
           AND technical_role.status = 'ACTIVE'
          WHERE area.id = $1
            AND area.status = 'ACTIVE'
            AND ($2::uuid IS NULL OR technical_role.id IS NOT NULL)
        ) AS valid
      `,
      [areaId, roleId],
    );
    return result.rows[0]?.valid ?? false;
  }

  async validatorAssignment(client: PoolClient, userId: string): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT assignment.technical_area_id AS area_id,
               assignment.technical_role_id AS role_id,
               technical_role.can_sign
        FROM iam.user_technical_assignments assignment
        JOIN iam.users user_account
          ON user_account.id = assignment.user_id
         AND user_account.status = 'ACTIVE'
        LEFT JOIN iam.technical_roles technical_role
          ON technical_role.id = assignment.technical_role_id
         AND technical_role.status = 'ACTIVE'
        WHERE assignment.user_id = $1
          AND assignment.status = 'ACTIVE'
        ORDER BY assignment.is_primary DESC, assignment.created_at
        LIMIT 1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async updateChecklistSubmissionRoute(
    client: PoolClient,
    versionId: string,
    input: {
      readonly technicalAreaId: string | null;
      readonly technicalRoleId: string | null;
      readonly signaturePolicy: string;
      readonly requiredSignatures: number;
      readonly segregationRequired: boolean;
      readonly managerGuidance: string;
    },
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.checklist_template_versions
        SET technical_area_id = $2,
            technical_role_id = $3,
            signature_policy = $4,
            required_signatures = $5,
            segregation_required = $6,
            manager_guidance = $7
        WHERE id = $1
      `,
      [
        versionId,
        input.technicalAreaId,
        input.technicalRoleId,
        input.signaturePolicy,
        input.requiredSignatures,
        input.segregationRequired,
        input.managerGuidance,
      ],
    );
  }

  async replaceChecklistValidatorUsers(
    client: PoolClient,
    tenantId: string,
    versionId: string,
    userId: string,
    validatorUserIds: readonly string[],
  ): Promise<void> {
    await client.query(
      'DELETE FROM maintenance.checklist_version_validator_users WHERE checklist_template_version_id = $1',
      [versionId],
    );
    if (validatorUserIds.length === 0) return;
    const valid = await client.query<{ id: string }>(
      `
        SELECT DISTINCT user_account.id
        FROM iam.users user_account
        JOIN iam.user_technical_assignments assignment
          ON assignment.user_id = user_account.id
         AND assignment.status = 'ACTIVE'
        LEFT JOIN iam.technical_roles technical_role
          ON technical_role.id = assignment.technical_role_id
         AND technical_role.status = 'ACTIVE'
        WHERE user_account.id = ANY($1::uuid[])
          AND user_account.status = 'ACTIVE'
          AND COALESCE(technical_role.can_sign, false)
      `,
      [validatorUserIds],
    );
    if (valid.rows.length !== validatorUserIds.length) {
      throw new Error('VALIDATOR_USERS_INVALID');
    }
    for (const validatorId of validatorUserIds) {
      await client.query(
        `
          INSERT INTO maintenance.checklist_version_validator_users (
            tenant_id, checklist_template_version_id, user_id, created_by
          ) VALUES ($1, $2, $3, $4)
        `,
        [tenantId, versionId, validatorId, userId],
      );
    }
  }

  async checklistValidatorUserEligible(
    client: PoolClient,
    versionId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query<{ eligible: boolean }>(
      `
        SELECT
          NOT EXISTS (
            SELECT 1
            FROM maintenance.checklist_version_validator_users requirement
            WHERE requirement.checklist_template_version_id = $1
          )
          OR EXISTS (
            SELECT 1
            FROM maintenance.checklist_version_validator_users requirement
            WHERE requirement.checklist_template_version_id = $1
              AND requirement.user_id = $2
          ) AS eligible
      `,
      [versionId, userId],
    );
    return result.rows[0]?.eligible ?? false;
  }

  async createChecklistValidationNotification(
    client: PoolClient,
    tenantId: string,
    input: {
      readonly checklistId: string;
      readonly versionId: string;
      readonly contentHash: string;
      readonly title: string;
      readonly message: string;
      readonly priority: string;
      readonly signaturePolicy: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO workflow.notifications (
          tenant_id, notification_type, title, message, entity_type, entity_id,
          priority, action_route, action_payload, audience, deduplication_key
        )
        VALUES (
          $1, 'CHECKLIST_VALIDATION_REQUESTED', $2, $3, 'CHECKLIST_MODELO', $4,
          $5, $6, $7::jsonb, $8::jsonb, $9
        )
        ON CONFLICT (tenant_id, deduplication_key)
        WHERE deduplication_key IS NOT NULL AND status = 'ACTIVE'
        DO UPDATE SET
          title = EXCLUDED.title,
          message = EXCLUDED.message,
          priority = EXCLUDED.priority,
          action_route = EXCLUDED.action_route,
          action_payload = EXCLUDED.action_payload,
          audience = EXCLUDED.audience
        RETURNING id
      `,
      [
        tenantId,
        input.title,
        input.message,
        input.checklistId,
        input.priority,
        `/maintenance/checklists/${input.checklistId}/review`,
        JSON.stringify({
          entityType: 'CHECKLIST_MODELO',
          entityId: input.checklistId,
          checklistVersionId: input.versionId,
        }),
        JSON.stringify({ signaturePolicy: input.signaturePolicy }),
        `checklist-validation:${input.versionId}:${input.contentHash}`,
      ],
    );
    const notification = result.rows[0];
    if (!notification) throw new Error('A notificação de validação não foi persistida.');
    return notification.id;
  }

  async attachChecklistValidationRecipients(
    client: PoolClient,
    tenantId: string,
    notificationId: string,
    versionId: string,
    signaturePolicy: string,
  ): Promise<ChecklistNotificationCoverage> {
    await client.query(
      `
        INSERT INTO workflow.notification_recipients (
          tenant_id, notification_id, user_id, delivery_status,
          delivered_at, last_notified_at, delivery_attempts
        )
        SELECT DISTINCT
          $1::uuid,
          $2::uuid,
          user_account.id,
          'DELIVERED',
          clock_timestamp(),
          clock_timestamp(),
          1
        FROM iam.users user_account
        JOIN iam.user_technical_assignments assignment
          ON assignment.tenant_id = user_account.tenant_id
         AND assignment.user_id = user_account.id
         AND assignment.status = 'ACTIVE'
         AND assignment.valid_from <= clock_timestamp()
         AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
        JOIN iam.technical_areas area
          ON area.tenant_id = assignment.tenant_id
         AND area.id = assignment.technical_area_id
         AND area.status = 'ACTIVE'
        LEFT JOIN iam.technical_roles technical_role
          ON technical_role.tenant_id = assignment.tenant_id
         AND technical_role.id = assignment.technical_role_id
         AND technical_role.status = 'ACTIVE'
        WHERE user_account.tenant_id = $1
          AND user_account.status = 'ACTIVE'
          AND user_account.deleted_at IS NULL
          AND COALESCE(technical_role.can_sign, false)
          AND (
            (
              $4 = 'PERSONALIZADA'
              AND EXISTS (
                SELECT 1
                FROM maintenance.checklist_version_validator_users selected
                WHERE selected.checklist_template_version_id = $3
                  AND selected.tenant_id = $1
                  AND selected.user_id = user_account.id
              )
            )
            OR (
              $4 IN (
                'QUALIDADE',
                'SEGURANCA',
                'QUALIDADE_OU_SEGURANCA',
                'QUALIDADE_E_SEGURANCA'
              )
              AND (
                ($4 = 'QUALIDADE' AND area.code = 'QUALITY')
                OR ($4 = 'SEGURANCA' AND area.code = 'SAFETY')
                OR ($4 IN ('QUALIDADE_OU_SEGURANCA', 'QUALIDADE_E_SEGURANCA')
                    AND area.code IN ('QUALITY', 'SAFETY'))
              )
              AND (
                EXISTS (
                  SELECT 1
                  FROM maintenance.checklist_version_validator_users selected
                  WHERE selected.checklist_template_version_id = $3
                    AND selected.tenant_id = $1
                    AND selected.user_id = user_account.id
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM maintenance.checklist_version_validator_users selected
                  WHERE selected.checklist_template_version_id = $3
                    AND selected.tenant_id = $1
                )
              )
            )
          )
        ON CONFLICT (tenant_id, notification_id, user_id) DO NOTHING
      `,
      [tenantId, notificationId, versionId, signaturePolicy],
    );

    const coverage = await client.query<{ recipient_count: number; area_codes: string[] }>(
      `
        SELECT
          count(DISTINCT recipient.user_id)::integer AS recipient_count,
          COALESCE(
            array_agg(DISTINCT area.code) FILTER (WHERE area.code IS NOT NULL),
            ARRAY[]::text[]
          ) AS area_codes
        FROM workflow.notification_recipients recipient
        LEFT JOIN iam.user_technical_assignments assignment
          ON assignment.tenant_id = recipient.tenant_id
         AND assignment.user_id = recipient.user_id
         AND assignment.status = 'ACTIVE'
         AND assignment.valid_from <= clock_timestamp()
         AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
        LEFT JOIN iam.technical_areas area
          ON area.tenant_id = assignment.tenant_id
         AND area.id = assignment.technical_area_id
        WHERE recipient.tenant_id = $1
          AND recipient.notification_id = $2
          AND recipient.dismissed_at IS NULL
      `,
      [tenantId, notificationId],
    );
    const row = coverage.rows[0];
    return {
      recipientCount: row?.recipient_count ?? 0,
      areaCodes: row?.area_codes ?? [],
    };
  }

  async retractChecklistValidationNotifications(
    client: PoolClient,
    tenantId: string,
    versionId: string,
  ): Promise<void> {
    await client.query(
      `
        WITH retracted AS (
          UPDATE workflow.notifications
          SET status = 'RETRACTED'
          WHERE tenant_id = $1
            AND notification_type = 'CHECKLIST_VALIDATION_REQUESTED'
            AND status = 'ACTIVE'
            AND action_payload ->> 'checklistVersionId' = $2
          RETURNING id
        )
        UPDATE workflow.notification_recipients recipient
        SET
          read_at = COALESCE(recipient.read_at, clock_timestamp()),
          dismissed_at = COALESCE(recipient.dismissed_at, clock_timestamp())
        FROM retracted
        WHERE recipient.tenant_id = $1
          AND recipient.notification_id = retracted.id
      `,
      [tenantId, versionId],
    );
  }

  async listChecklists(
    client: PoolClient,
    query: ChecklistListQuery,
  ): Promise<readonly PlanningRow[]> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          template.id,
          template.code AS codigo,
          template.name AS nome,
          template.checklist_type AS tipo,
          template.criticality AS criticidade,
          template.lifecycle_status AS status_ciclo_vida,
          template.asset_id AS ativo_id,
          asset.tag AS ativo_tag,
          asset.name AS ativo_nome,
          template.component_id AS componente_id,
          component.tag AS componente_tag,
          component.name AS componente_nome,
          version.id AS versao_id,
          version.revision AS revisao,
          version.status,
          version.signature_policy AS politica_assinatura,
          version.required_signatures AS assinaturas_exigidas,
          COALESCE(item_total.total, 0)::integer AS total_itens,
          template.updated_at
        FROM maintenance.checklist_templates template
        JOIN cmms.assets asset ON asset.id = template.asset_id
        LEFT JOIN cmms.components component ON component.id = template.component_id
        JOIN LATERAL (
          SELECT current_version.*
          FROM maintenance.checklist_template_versions current_version
          WHERE current_version.checklist_template_id = template.id
          ORDER BY current_version.revision DESC
          LIMIT 1
        ) version ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::integer AS total
          FROM maintenance.checklist_items item
          WHERE item.checklist_template_version_id = version.id
            AND item.status = 'ACTIVE'
        ) item_total ON true
        WHERE template.deleted_at IS NULL
          AND (
            $1 = ''
            OR template.code ILIKE '%' || $1 || '%'
            OR template.name ILIKE '%' || $1 || '%'
            OR asset.tag ILIKE '%' || $1 || '%'
            OR asset.name ILIKE '%' || $1 || '%'
          )
          AND ($2::text IS NULL OR version.status = $2)
          AND ($3::uuid IS NULL OR template.asset_id = $3)
        ORDER BY template.updated_at DESC, template.id DESC
        LIMIT $4
      `,
      [query.search, query.status, query.assetId, query.limit],
    );
    return result.rows;
  }

  async findChecklistTemplate(
    client: PoolClient,
    checklistId: string,
    lock = false,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT *
        FROM maintenance.checklist_templates
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [checklistId],
    );
    return result.rows[0] ?? null;
  }

  async findLatestChecklistVersion(
    client: PoolClient,
    checklistId: string,
    lock = false,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT version.*
        FROM maintenance.checklist_template_versions version
        WHERE version.checklist_template_id = $1
        ORDER BY version.revision DESC
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [checklistId],
    );
    return result.rows[0] ?? null;
  }

  async findEditableChecklistVersion(
    client: PoolClient,
    checklistId: string,
    lock = false,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT version.*
        FROM maintenance.checklist_template_versions version
        WHERE version.checklist_template_id = $1
          AND version.status IN ('DRAFT', 'CHANGES_REQUESTED')
        ORDER BY version.revision DESC
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [checklistId],
    );
    return result.rows[0] ?? null;
  }

  async getChecklistDetail(client: PoolClient, checklistId: string): Promise<PlanningRow | null> {
    const template = await client.query<PlanningRow>(
      `
        SELECT
          template.id,
          template.code AS codigo,
          template.name AS nome,
          template.checklist_type AS tipo,
          template.criticality AS criticidade,
          template.lifecycle_status AS status_ciclo_vida,
          template.asset_id AS ativo_id,
          asset.tag AS ativo_tag,
          asset.name AS ativo_nome,
          template.component_id AS componente_id,
          component.tag AS componente_tag,
          component.name AS componente_nome,
          template.created_by AS criado_por,
          template.created_at,
          template.updated_at
        FROM maintenance.checklist_templates template
        JOIN cmms.assets asset ON asset.id = template.asset_id
        LEFT JOIN cmms.components component ON component.id = template.component_id
        WHERE template.id = $1
          AND template.deleted_at IS NULL
        LIMIT 1
      `,
      [checklistId],
    );
    const model = template.rows[0];
    if (!model) return null;

    const versions = await client.query<PlanningRow>(
      `
        SELECT
          version.id,
          version.revision AS revisao,
          version.status,
          version.technical_area_id AS area_tecnica_id,
          area.name AS area_tecnica_nome,
          version.technical_role_id AS cargo_tecnico_id,
          technical_role.name AS cargo_tecnico_nome,
          version.signature_policy AS politica_assinatura,
          version.required_signatures AS assinaturas_exigidas,
          version.segregation_required AS segregacao_exigida,
          version.manager_guidance AS orientacao_gestor,
          version.safety_requirements AS requisitos_seguranca,
          version.content_hash_sha256 AS hash_conteudo,
          version.source_version_id AS versao_origem_id,
          version.submitted_at AS submetida_em,
          version.published_at AS publicada_em,
          version.created_at
        FROM maintenance.checklist_template_versions version
        LEFT JOIN iam.technical_areas area ON area.id = version.technical_area_id
        LEFT JOIN iam.technical_roles technical_role ON technical_role.id = version.technical_role_id
        WHERE version.checklist_template_id = $1
        ORDER BY version.revision DESC
      `,
      [checklistId],
    );
    const currentVersion = versions.rows[0];
    const items = currentVersion
      ? await this.listChecklistItems(client, String(currentVersion.id))
      : [];
    const reviews = currentVersion
      ? await this.listChecklistReviews(client, String(currentVersion.id))
      : [];
    return {
      ...model,
      versao_atual: currentVersion ?? null,
      versoes: versions.rows,
      itens: items,
      revisoes_tecnicas: reviews,
    };
  }

  async createChecklist(
    client: PoolClient,
    tenantId: string,
    templateId: string,
    versionId: string,
    userId: string,
    input: ChecklistInput,
    initialHash: string,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO maintenance.checklist_templates (
          id, tenant_id, code, name, asset_id, component_id, checklist_type,
          criticality, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        templateId,
        tenantId,
        input.code,
        input.name,
        input.assetId,
        input.componentId,
        input.checklistType,
        input.criticality,
        userId,
      ],
    );
    await client.query(
      `
        INSERT INTO maintenance.checklist_template_versions (
          id, tenant_id, checklist_template_id, revision, status,
          technical_area_id, technical_role_id, signature_policy,
          required_signatures, segregation_required, manager_guidance,
          safety_requirements, content_hash_sha256, created_by
        )
        VALUES (
          $1, $2, $3, 1, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
      `,
      [
        versionId,
        tenantId,
        templateId,
        input.technicalAreaId,
        input.technicalRoleId,
        input.signaturePolicy,
        input.requiredSignatures,
        input.segregationRequired,
        input.managerGuidance,
        JSON.stringify(input.safetyRequirements),
        initialHash,
        userId,
      ],
    );
  }

  async updateChecklist(
    client: PoolClient,
    checklistId: string,
    versionId: string,
    patch: ChecklistPatch,
    currentTemplate: PlanningRow,
    currentVersion: PlanningRow,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.checklist_templates
        SET
          code = $2,
          name = $3,
          lifecycle_status = $4,
          criticality = $5
        WHERE id = $1
      `,
      [
        checklistId,
        patch.code ?? currentTemplate.code,
        patch.name ?? currentTemplate.name,
        patch.lifecycleStatus ?? currentTemplate.lifecycle_status,
        patch.criticality ?? currentTemplate.criticality,
      ],
    );
    await client.query(
      `
        UPDATE maintenance.checklist_template_versions
        SET
          technical_area_id = $2,
          technical_role_id = $3,
          signature_policy = $4,
          required_signatures = $5,
          segregation_required = $6,
          manager_guidance = $7,
          safety_requirements = $8
        WHERE id = $1
      `,
      [
        versionId,
        patch.technicalAreaId === undefined
          ? currentVersion.technical_area_id
          : patch.technicalAreaId,
        patch.technicalRoleId === undefined
          ? currentVersion.technical_role_id
          : patch.technicalRoleId,
        patch.signaturePolicy ?? currentVersion.signature_policy,
        patch.requiredSignatures ?? currentVersion.required_signatures,
        patch.segregationRequired ?? currentVersion.segregation_required,
        patch.managerGuidance === undefined
          ? currentVersion.manager_guidance
          : patch.managerGuidance,
        JSON.stringify(
          patch.safetyRequirements ??
            (currentVersion.safety_requirements as readonly string[] | undefined) ??
            [],
        ),
      ],
    );
  }

  async updateChecklistAggregate(
    client: PoolClient,
    checklistId: string,
    versionId: string,
    input: ChecklistInput,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.checklist_templates
        SET code = $2,
            name = $3,
            asset_id = $4,
            component_id = $5,
            checklist_type = $6,
            criticality = $7,
            lifecycle_status = 'ACTIVE'
        WHERE id = $1
      `,
      [
        checklistId,
        input.code,
        input.name,
        input.assetId,
        input.componentId,
        input.checklistType,
        input.criticality,
      ],
    );
    await client.query(
      `
        UPDATE maintenance.checklist_template_versions
        SET technical_area_id = $2,
            technical_role_id = $3,
            signature_policy = $4,
            required_signatures = $5,
            segregation_required = $6,
            manager_guidance = $7,
            safety_requirements = $8
        WHERE id = $1
      `,
      [
        versionId,
        input.technicalAreaId,
        input.technicalRoleId,
        input.signaturePolicy,
        input.requiredSignatures,
        input.segregationRequired,
        input.managerGuidance,
        JSON.stringify(input.safetyRequirements),
      ],
    );
  }

  async findParameterByName(
    client: PoolClient,
    assetId: string,
    componentId: string | null,
    name: string,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT id, code, name, unit, value_type, status
        FROM cmms.parameter_definitions
        WHERE asset_id = $1
          AND component_id IS NOT DISTINCT FROM $2::uuid
          AND deleted_at IS NULL
          AND status = 'ACTIVE'
          AND (upper(code) = upper($3) OR upper(name) = upper($3))
        ORDER BY CASE WHEN upper(code) = upper($3) THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1
      `,
      [assetId, componentId, name],
    );
    return result.rows[0] ?? null;
  }

  async createChecklistParameter(
    client: PoolClient,
    tenantId: string,
    assetId: string,
    componentId: string | null,
    code: string,
    name: string,
    unit: string,
  ): Promise<PlanningRow> {
    const result = await client.query<PlanningRow>(
      `
        INSERT INTO cmms.parameter_definitions (
          tenant_id, asset_id, component_id, code, name, unit,
          value_type, source_type, description, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'DECIMAL', 'CHECKLIST',
          'Parâmetro criado pelo construtor assistido de checklist.',
          '{"origem":"CHECKLIST_BUILDER"}'::jsonb)
        RETURNING id, code, name, unit, value_type, status
      `,
      [tenantId, assetId, componentId, code, name, unit],
    );
    const created = result.rows[0];
    if (!created) throw new Error('O PostgreSQL não retornou o parâmetro criado.');
    return created;
  }

  async replaceChecklistItems(
    client: PoolClient,
    tenantId: string,
    versionId: string,
    items: readonly { readonly id: string; readonly input: ChecklistItemInput }[],
  ): Promise<void> {
    await client.query(
      'DELETE FROM maintenance.checklist_items WHERE checklist_template_version_id = $1',
      [versionId],
    );
    for (const [index, item] of items.entries()) {
      await client.query(
        `
          INSERT INTO maintenance.checklist_items (
            id, tenant_id, checklist_template_version_id, sequence, title,
            instruction, response_type_code, category, required,
            evidence_required, minimum_evidence_photos, blocks_completion,
            parameter_definition_id, expected_value, minimum_value, maximum_value,
            unit, options, validation_rule_code, weight
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
          )
        `,
        [
          item.id,
          tenantId,
          versionId,
          index + 1,
          item.input.title,
          item.input.instruction,
          item.input.responseTypeCode,
          item.input.category,
          item.input.required,
          item.input.evidenceRequired,
          item.input.minimumEvidencePhotos,
          item.input.blocksCompletion,
          item.input.parameterDefinitionId,
          item.input.expectedValue,
          item.input.minimumValue,
          item.input.maximumValue,
          item.input.unit,
          JSON.stringify(item.input.options),
          item.input.validationRuleCode,
          item.input.weight,
        ],
      );
    }
  }

  async softDeleteChecklistDraft(client: PoolClient, checklistId: string): Promise<boolean> {
    const deleted = await client.query(
      `
        UPDATE maintenance.checklist_templates template
        SET deleted_at = clock_timestamp(), lifecycle_status = 'ARCHIVED'
        WHERE template.id = $1
          AND template.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM maintenance.checklist_template_versions version
            WHERE version.checklist_template_id = template.id
              AND version.status NOT IN ('DRAFT', 'CHANGES_REQUESTED')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM maintenance.maintenance_plan_versions plan_version
            JOIN maintenance.checklist_template_versions version
              ON version.id = plan_version.checklist_template_version_id
            WHERE version.checklist_template_id = template.id
          )
        RETURNING template.id
      `,
      [checklistId],
    );
    return deleted.rowCount === 1;
  }

  async acceptTechnicalAnalysisAsChecklist(
    client: PoolClient,
    analysisId: string,
    checklistId: string,
  ): Promise<boolean> {
    const updated = await client.query(
      `
        UPDATE workflow.technical_analyses
        SET status = 'ACCEPTED',
            report = report || jsonb_build_object(
              'checklist_template_id', $2::text,
              'converted_at', clock_timestamp()
            )
        WHERE id = $1
          AND status IN ('DRAFT', 'SENT_TO_ADMIN')
      `,
      [analysisId, checklistId],
    );
    return updated.rowCount === 1;
  }

  async listChecklistItems(client: PoolClient, versionId: string): Promise<readonly PlanningRow[]> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          item.id,
          item.sequence AS sequencia,
          item.title AS titulo,
          item.instruction AS instrucao,
          item.response_type_code AS tipo_resposta,
          item.category AS categoria,
          item.required AS obrigatoria,
          item.evidence_required AS exige_evidencia,
          item.minimum_evidence_photos AS minimo_fotos,
          item.blocks_completion AS bloqueia_conclusao,
          item.parameter_definition_id AS parametro_id,
          parameter.code AS parametro_codigo,
          parameter.name AS parametro_nome,
          item.expected_value AS valor_esperado,
          item.minimum_value AS valor_minimo,
          item.maximum_value AS valor_maximo,
          item.unit AS unidade,
          item.options AS opcoes,
          item.validation_rule_code AS regra_validacao,
          item.weight AS peso,
          item.status
        FROM maintenance.checklist_items item
        LEFT JOIN cmms.parameter_definitions parameter ON parameter.id = item.parameter_definition_id
        WHERE item.checklist_template_version_id = $1
        ORDER BY item.sequence, item.id
      `,
      [versionId],
    );
    return result.rows;
  }

  async insertChecklistItem(
    client: PoolClient,
    tenantId: string,
    versionId: string,
    itemId: string,
    input: ChecklistItemInput,
  ): Promise<PlanningRow> {
    const result = await client.query<PlanningRow>(
      `
        INSERT INTO maintenance.checklist_items (
          id, tenant_id, checklist_template_version_id, sequence, title,
          instruction, response_type_code, category, required,
          evidence_required, minimum_evidence_photos, blocks_completion,
          parameter_definition_id, expected_value, minimum_value, maximum_value,
          unit, options, validation_rule_code, weight
        )
        SELECT
          $1, $2, $3, COALESCE(max(item.sequence), 0) + 1, $4,
          $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19
        FROM maintenance.checklist_items item
        WHERE item.checklist_template_version_id = $3
        RETURNING id, sequence AS sequencia
      `,
      [
        itemId,
        tenantId,
        versionId,
        input.title,
        input.instruction,
        input.responseTypeCode,
        input.category,
        input.required,
        input.evidenceRequired,
        input.minimumEvidencePhotos,
        input.blocksCompletion,
        input.parameterDefinitionId,
        input.expectedValue,
        input.minimumValue,
        input.maximumValue,
        input.unit,
        JSON.stringify(input.options),
        input.validationRuleCode,
        input.weight,
      ],
    );
    const created = result.rows[0];
    if (!created) throw new Error('O PostgreSQL não retornou a etapa criada.');
    return created;
  }

  async updateChecklistItem(
    client: PoolClient,
    versionId: string,
    itemId: string,
    input: ChecklistItemInput,
  ): Promise<boolean> {
    const result = await client.query(
      `
        UPDATE maintenance.checklist_items
        SET
          title = $3,
          instruction = $4,
          response_type_code = $5,
          category = $6,
          required = $7,
          evidence_required = $8,
          minimum_evidence_photos = $9,
          blocks_completion = $10,
          parameter_definition_id = $11,
          expected_value = $12,
          minimum_value = $13,
          maximum_value = $14,
          unit = $15,
          options = $16,
          validation_rule_code = $17,
          weight = $18
        WHERE id = $1
          AND checklist_template_version_id = $2
      `,
      [
        itemId,
        versionId,
        input.title,
        input.instruction,
        input.responseTypeCode,
        input.category,
        input.required,
        input.evidenceRequired,
        input.minimumEvidencePhotos,
        input.blocksCompletion,
        input.parameterDefinitionId,
        input.expectedValue,
        input.minimumValue,
        input.maximumValue,
        input.unit,
        JSON.stringify(input.options),
        input.validationRuleCode,
        input.weight,
      ],
    );
    return result.rowCount === 1;
  }

  async deleteChecklistItem(
    client: PoolClient,
    versionId: string,
    itemId: string,
  ): Promise<boolean> {
    const deleted = await client.query<{ sequence: number }>(
      `
        DELETE FROM maintenance.checklist_items
        WHERE id = $1
          AND checklist_template_version_id = $2
        RETURNING sequence
      `,
      [itemId, versionId],
    );
    const row = deleted.rows[0];
    if (!row) return false;
    await client.query(
      `
        UPDATE maintenance.checklist_items
        SET sequence = sequence - 1
        WHERE checklist_template_version_id = $1
          AND sequence > $2
      `,
      [versionId, row.sequence],
    );
    return true;
  }

  async reorderChecklistItems(
    client: PoolClient,
    versionId: string,
    orderedIds: readonly string[],
  ): Promise<boolean> {
    const existing = await client.query<{ id: string }>(
      `
        SELECT id
        FROM maintenance.checklist_items
        WHERE checklist_template_version_id = $1
        ORDER BY sequence
        FOR UPDATE
      `,
      [versionId],
    );
    if (
      existing.rows.length !== orderedIds.length ||
      existing.rows.some((item) => !orderedIds.includes(item.id))
    ) {
      return false;
    }
    await client.query(
      `
        UPDATE maintenance.checklist_items
        SET sequence = sequence + 1000000
        WHERE checklist_template_version_id = $1
      `,
      [versionId],
    );
    for (const [index, itemId] of orderedIds.entries()) {
      await client.query(
        `
          UPDATE maintenance.checklist_items
          SET sequence = $3
          WHERE id = $1
            AND checklist_template_version_id = $2
        `,
        [itemId, versionId, index + 1],
      );
    }
    return true;
  }

  async countActiveChecklistItems(client: PoolClient, versionId: string): Promise<number> {
    const result = await client.query<{ total: number }>(
      `
        SELECT count(*)::integer AS total
        FROM maintenance.checklist_items
        WHERE checklist_template_version_id = $1
          AND status = 'ACTIVE'
      `,
      [versionId],
    );
    return result.rows[0]?.total ?? 0;
  }

  async updateChecklistVersionStatus(
    client: PoolClient,
    versionId: string,
    status: ChecklistVersionStatus,
    contentHash: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.checklist_template_versions
        SET
          status = $2,
          content_hash_sha256 = $3,
          submitted_at = CASE
            WHEN $2 IN ('IN_REVIEW', 'APPROVED') THEN clock_timestamp()
            ELSE submitted_at
          END,
          published_at = CASE WHEN $2 = 'PUBLISHED' THEN clock_timestamp() ELSE published_at END
        WHERE id = $1
      `,
      [versionId, status, contentHash],
    );
  }

  async supersedePublishedChecklist(
    client: PoolClient,
    checklistId: string,
    exceptVersionId: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.checklist_template_versions
        SET status = 'SUPERSEDED'
        WHERE checklist_template_id = $1
          AND id <> $2
          AND status = 'PUBLISHED'
      `,
      [checklistId, exceptVersionId],
    );
  }

  async createChecklistRevision(
    client: PoolClient,
    tenantId: string,
    checklistId: string,
    sourceVersion: PlanningRow,
    versionId: string,
    userId: string,
  ): Promise<void> {
    const revisionResult = await client.query<{ revision: number }>(
      `
        SELECT COALESCE(max(revision), 0)::integer + 1 AS revision
        FROM maintenance.checklist_template_versions
        WHERE checklist_template_id = $1
      `,
      [checklistId],
    );
    const revision = revisionResult.rows[0]?.revision;
    if (!revision) throw new Error('Não foi possível calcular a nova revisão do checklist.');
    await client.query(
      `
        INSERT INTO maintenance.checklist_template_versions (
          id, tenant_id, checklist_template_id, revision, status,
          technical_area_id, technical_role_id, signature_policy,
          required_signatures, segregation_required, manager_guidance,
          safety_requirements, content_hash_sha256, source_version_id,
          replaces_version_id, created_by
        )
        VALUES (
          $1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $13, $14
        )
      `,
      [
        versionId,
        tenantId,
        checklistId,
        revision,
        sourceVersion.technical_area_id,
        sourceVersion.technical_role_id,
        sourceVersion.signature_policy,
        sourceVersion.required_signatures,
        sourceVersion.segregation_required,
        sourceVersion.manager_guidance,
        JSON.stringify(sourceVersion.safety_requirements ?? []),
        sourceVersion.content_hash_sha256,
        sourceVersion.id,
        userId,
      ],
    );
    await client.query(
      `
        INSERT INTO maintenance.checklist_items (
          tenant_id, checklist_template_version_id, sequence, title, instruction,
          response_type_code, category, required, evidence_required,
          minimum_evidence_photos, blocks_completion, reference_storage_object_id,
          parameter_definition_id, expected_value, minimum_value, maximum_value,
          unit, options, validation_rule_code, weight, status
        )
        SELECT
          tenant_id, $2, sequence, title, instruction, response_type_code,
          category, required, evidence_required, minimum_evidence_photos,
          blocks_completion, reference_storage_object_id, parameter_definition_id,
          expected_value, minimum_value, maximum_value, unit, options,
          validation_rule_code, weight, status
        FROM maintenance.checklist_items
        WHERE checklist_template_version_id = $1
        ORDER BY sequence
      `,
      [sourceVersion.id, versionId],
    );
  }

  async getValidatorContext(
    client: PoolClient,
    userId: string,
  ): Promise<ValidatorContextRow | null> {
    const result = await client.query<ValidatorContextRow>(
      `
        SELECT
          area.id AS area_id,
          area.code AS area_code,
          technical_role.id AS role_id,
          technical_role.code AS role_code,
          COALESCE(technical_role.can_sign, false) AS can_sign
        FROM iam.user_technical_assignments assignment
        JOIN iam.technical_areas area ON area.id = assignment.technical_area_id
        LEFT JOIN iam.technical_roles technical_role ON technical_role.id = assignment.technical_role_id
        WHERE assignment.user_id = $1
          AND assignment.status = 'ACTIVE'
          AND assignment.valid_from <= clock_timestamp()
          AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
        ORDER BY assignment.is_primary DESC, assignment.created_at
        LIMIT 1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async insertChecklistReview(
    client: PoolClient,
    tenantId: string,
    versionId: string,
    decision: ReviewDecision,
    justification: string,
    reviewerId: string,
    roleSnapshot: string,
    payloadHash: string,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO maintenance.checklist_model_reviews (
          tenant_id, checklist_template_version_id, decision, justification,
          reviewer_id, reviewer_role_snapshot, payload_hash_sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [tenantId, versionId, decision, justification, reviewerId, roleSnapshot, payloadHash],
    );
  }

  async reviewProgress(client: PoolClient, versionId: string): Promise<ReviewProgressRow> {
    const result = await client.query<ReviewProgressRow>(
      `
        SELECT
          count(DISTINCT review.reviewer_id) FILTER (
            WHERE review.decision = 'APPROVED'
          )::integer AS approved_count,
          COALESCE(bool_or(area.code = 'QUALITY') FILTER (
            WHERE review.decision = 'APPROVED'
          ), false) AS quality_approved,
          COALESCE(bool_or(area.code = 'SAFETY') FILTER (
            WHERE review.decision = 'APPROVED'
          ), false) AS safety_approved
        FROM maintenance.checklist_model_reviews review
        LEFT JOIN iam.user_technical_assignments assignment
          ON assignment.user_id = review.reviewer_id
         AND assignment.is_primary
         AND assignment.status = 'ACTIVE'
        LEFT JOIN iam.technical_areas area ON area.id = assignment.technical_area_id
        WHERE review.checklist_template_version_id = $1
      `,
      [versionId],
    );
    return (
      result.rows[0] ?? {
        approved_count: 0,
        quality_approved: false,
        safety_approved: false,
      }
    );
  }

  async listChecklistReviews(
    client: PoolClient,
    versionId: string,
  ): Promise<readonly PlanningRow[]> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          review.id,
          review.decision AS decisao,
          review.justification AS justificativa,
          review.reviewer_id AS revisor_id,
          reviewer.name AS revisor_nome,
          review.reviewer_role_snapshot AS perfil,
          area.code AS area_codigo,
          area.name AS area_nome,
          review.payload_hash_sha256 AS hash_conteudo,
          review.created_at
        FROM maintenance.checklist_model_reviews review
        JOIN iam.users reviewer ON reviewer.id = review.reviewer_id
        LEFT JOIN iam.user_technical_assignments assignment
          ON assignment.user_id = review.reviewer_id
         AND assignment.is_primary
         AND assignment.status = 'ACTIVE'
        LEFT JOIN iam.technical_areas area ON area.id = assignment.technical_area_id
        WHERE review.checklist_template_version_id = $1
        ORDER BY review.created_at, review.id
      `,
      [versionId],
    );
    return result.rows;
  }

  async listPlans(client: PoolClient, query: PlanListQuery): Promise<readonly PlanningRow[]> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          plan.id,
          plan.code AS codigo,
          plan.name AS nome,
          plan.plan_type AS tipo,
          plan.lifecycle_status AS status_ciclo_vida,
          plan.asset_id AS ativo_id,
          asset.tag AS ativo_tag,
          asset.name AS ativo_nome,
          plan.component_id AS componente_id,
          component.name AS componente_nome,
          version.id AS versao_id,
          version.revision AS revisao,
          version.status,
          version.criticality AS criticidade,
          version.trigger_type AS tipo_disparo,
          version.trigger_value AS valor_disparo,
          version.trigger_unit AS unidade_disparo,
          version.recurrence_days AS recorrencia_dias,
          version.estimated_duration_minutes AS duracao_estimada_minutos,
          version.lockout_required AS exige_loto,
          version.evidence_required AS exige_evidencia,
          version.maximum_sessions AS maximo_sessoes,
          version.maintenance_stop_mode AS modo_parada,
          version.technical_analysis AS analise_tecnica,
          version.technical_area_id AS area_tecnica_id,
          version.checklist_template_version_id AS checklist_versao_id,
          checklist.name AS checklist_nome,
          checklist_items.total_itens AS plano_itens_count,
          plan.updated_at
        FROM maintenance.maintenance_plans plan
        JOIN cmms.assets asset ON asset.id = plan.asset_id
        LEFT JOIN cmms.components component ON component.id = plan.component_id
        JOIN LATERAL (
          SELECT current_version.*
          FROM maintenance.maintenance_plan_versions current_version
          WHERE current_version.maintenance_plan_id = plan.id
          ORDER BY current_version.revision DESC
          LIMIT 1
        ) version ON true
        JOIN maintenance.checklist_template_versions checklist_version
          ON checklist_version.id = version.checklist_template_version_id
        JOIN maintenance.checklist_templates checklist
          ON checklist.id = checklist_version.checklist_template_id
        JOIN LATERAL (
          SELECT count(*) FILTER (WHERE item.status = 'ACTIVE')::integer AS total_itens
          FROM maintenance.checklist_items item
          WHERE item.checklist_template_version_id = checklist_version.id
        ) checklist_items ON true
        WHERE plan.deleted_at IS NULL
          AND (
            $1 = ''
            OR plan.code ILIKE '%' || $1 || '%'
            OR plan.name ILIKE '%' || $1 || '%'
            OR asset.tag ILIKE '%' || $1 || '%'
            OR asset.name ILIKE '%' || $1 || '%'
          )
          AND ($2::text IS NULL OR version.status = $2)
          AND ($3::uuid IS NULL OR plan.asset_id = $3)
          AND ($4::text IS NULL OR plan.plan_type = $4)
        ORDER BY plan.updated_at DESC, plan.id DESC
        LIMIT $5
      `,
      [query.search, query.status, query.assetId, query.planType, query.limit],
    );
    return result.rows;
  }

  async findPublishedChecklistContext(
    client: PoolClient,
    checklistVersionId: string,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT
          version.id,
          version.status,
          template.id AS checklist_id,
          template.asset_id,
          template.component_id,
          count(item.id) FILTER (WHERE item.status = 'ACTIVE')::integer AS total_itens
        FROM maintenance.checklist_template_versions version
        JOIN maintenance.checklist_templates template ON template.id = version.checklist_template_id
        LEFT JOIN maintenance.checklist_items item ON item.checklist_template_version_id = version.id
        WHERE version.id = $1
          AND template.deleted_at IS NULL
        GROUP BY version.id, template.id
        LIMIT 1
      `,
      [checklistVersionId],
    );
    return result.rows[0] ?? null;
  }

  async createPlan(
    client: PoolClient,
    tenantId: string,
    planId: string,
    versionId: string,
    userId: string,
    input: MaintenancePlanInput,
    contentHash: string,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO maintenance.maintenance_plans (
          id, tenant_id, code, name, asset_id, component_id, plan_type, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        planId,
        tenantId,
        input.code,
        input.name,
        input.assetId,
        input.componentId,
        input.planType,
        userId,
      ],
    );
    await client.query(
      `
        INSERT INTO maintenance.maintenance_plan_versions (
          id, tenant_id, maintenance_plan_id, checklist_template_version_id,
          revision, status, criticality, trigger_type, trigger_value, trigger_unit,
          recurrence_days, estimated_duration_minutes, lockout_required,
          evidence_required, maximum_sessions, maintenance_stop_mode,
          technical_analysis, technical_area_id, content_hash_sha256, created_by
        )
        VALUES (
          $1, $2, $3, $4, 1, 'DRAFT', $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18
        )
      `,
      [
        versionId,
        tenantId,
        planId,
        input.checklistTemplateVersionId,
        input.criticality,
        input.triggerType,
        input.triggerValue,
        input.triggerUnit,
        input.recurrenceDays,
        input.estimatedDurationMinutes,
        input.lockoutRequired,
        input.evidenceRequired,
        input.maximumSessions,
        input.stopMode,
        JSON.stringify(input.technicalAnalysis),
        input.technicalAreaId,
        contentHash,
        userId,
      ],
    );
  }

  async findPlan(client: PoolClient, planId: string, lock = false): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT *
        FROM maintenance.maintenance_plans
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [planId],
    );
    return result.rows[0] ?? null;
  }

  async findLatestPlanVersion(
    client: PoolClient,
    planId: string,
    lock = false,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT *
        FROM maintenance.maintenance_plan_versions
        WHERE maintenance_plan_id = $1
        ORDER BY revision DESC
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [planId],
    );
    return result.rows[0] ?? null;
  }

  async findEditablePlanVersion(
    client: PoolClient,
    planId: string,
    lock = false,
  ): Promise<PlanningRow | null> {
    const result = await client.query<PlanningRow>(
      `
        SELECT *
        FROM maintenance.maintenance_plan_versions
        WHERE maintenance_plan_id = $1
          AND status IN ('DRAFT', 'CHANGES_REQUESTED')
        ORDER BY revision DESC
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [planId],
    );
    return result.rows[0] ?? null;
  }

  async getPlanDetail(client: PoolClient, planId: string): Promise<PlanningRow | null> {
    const planResult = await client.query<PlanningRow>(
      `
        SELECT
          plan.id,
          plan.code AS codigo,
          plan.name AS nome,
          plan.plan_type AS tipo,
          plan.lifecycle_status AS status_ciclo_vida,
          plan.asset_id AS ativo_id,
          asset.tag AS ativo_tag,
          asset.name AS ativo_nome,
          plan.component_id AS componente_id,
          component.tag AS componente_tag,
          component.name AS componente_nome,
          plan.created_at,
          plan.updated_at
        FROM maintenance.maintenance_plans plan
        JOIN cmms.assets asset ON asset.id = plan.asset_id
        LEFT JOIN cmms.components component ON component.id = plan.component_id
        WHERE plan.id = $1
          AND plan.deleted_at IS NULL
        LIMIT 1
      `,
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan) return null;
    const versions = await client.query<PlanningRow>(
      `
        SELECT
          version.id,
          version.revision AS revisao,
          version.status,
          version.checklist_template_version_id AS checklist_versao_id,
          checklist.code AS checklist_codigo,
          checklist.name AS checklist_nome,
          checklist_version.revision AS checklist_revisao,
          version.criticality AS criticidade,
          version.trigger_type AS tipo_disparo,
          version.trigger_value AS valor_disparo,
          version.trigger_unit AS unidade_disparo,
          version.recurrence_days AS recorrencia_dias,
          version.estimated_duration_minutes AS duracao_estimada_minutos,
          version.lockout_required AS exige_loto,
          version.evidence_required AS exige_evidencia,
          version.maximum_sessions AS maximo_sessoes,
          version.maintenance_stop_mode AS modo_parada,
          version.technical_analysis AS analise_tecnica,
          version.technical_area_id AS area_tecnica_id,
          area.name AS area_tecnica_nome,
          version.content_hash_sha256 AS hash_conteudo,
          version.source_version_id AS versao_origem_id,
          version.published_at AS publicada_em,
          version.created_at
        FROM maintenance.maintenance_plan_versions version
        JOIN maintenance.checklist_template_versions checklist_version
          ON checklist_version.id = version.checklist_template_version_id
        JOIN maintenance.checklist_templates checklist
          ON checklist.id = checklist_version.checklist_template_id
        LEFT JOIN iam.technical_areas area ON area.id = version.technical_area_id
        WHERE version.maintenance_plan_id = $1
        ORDER BY version.revision DESC
      `,
      [planId],
    );
    return { ...plan, versao_atual: versions.rows[0] ?? null, versoes: versions.rows };
  }

  async updatePlan(
    client: PoolClient,
    planId: string,
    versionId: string,
    patch: MaintenancePlanPatch,
    currentPlan: PlanningRow,
    currentVersion: PlanningRow,
    contentHash: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.maintenance_plans
        SET code = $2, name = $3, lifecycle_status = $4
        WHERE id = $1
      `,
      [
        planId,
        patch.code ?? currentPlan.code,
        patch.name ?? currentPlan.name,
        patch.lifecycleStatus ?? currentPlan.lifecycle_status,
      ],
    );
    await client.query(
      `
        UPDATE maintenance.maintenance_plan_versions
        SET
          checklist_template_version_id = $2,
          criticality = $3,
          trigger_type = $4,
          trigger_value = $5,
          trigger_unit = $6,
          recurrence_days = $7,
          estimated_duration_minutes = $8,
          lockout_required = $9,
          evidence_required = $10,
          maximum_sessions = $11,
          maintenance_stop_mode = $12,
          technical_analysis = $13,
          technical_area_id = $14,
          content_hash_sha256 = $15
        WHERE id = $1
      `,
      [
        versionId,
        patch.checklistTemplateVersionId ?? currentVersion.checklist_template_version_id,
        patch.criticality ?? currentVersion.criticality,
        patch.triggerType ?? currentVersion.trigger_type,
        patch.triggerValue === undefined ? currentVersion.trigger_value : patch.triggerValue,
        patch.triggerUnit === undefined ? currentVersion.trigger_unit : patch.triggerUnit,
        patch.recurrenceDays === undefined ? currentVersion.recurrence_days : patch.recurrenceDays,
        patch.estimatedDurationMinutes === undefined
          ? currentVersion.estimated_duration_minutes
          : patch.estimatedDurationMinutes,
        patch.lockoutRequired ?? currentVersion.lockout_required,
        patch.evidenceRequired ?? currentVersion.evidence_required,
        patch.maximumSessions === undefined
          ? currentVersion.maximum_sessions
          : patch.maximumSessions,
        patch.stopMode ?? currentVersion.maintenance_stop_mode,
        JSON.stringify(patch.technicalAnalysis ?? currentVersion.technical_analysis ?? {}),
        patch.technicalAreaId === undefined
          ? currentVersion.technical_area_id
          : patch.technicalAreaId,
        contentHash,
      ],
    );
  }

  async updatePlanLifecycleStatus(
    client: PoolClient,
    planId: string,
    lifecycleStatus: string,
  ): Promise<void> {
    await client.query(
      `UPDATE maintenance.maintenance_plans
       SET lifecycle_status = $2, updated_at = clock_timestamp()
       WHERE id = $1`,
      [planId, lifecycleStatus],
    );
  }

  async publishPlanVersion(
    client: PoolClient,
    planId: string,
    versionId: string,
    contentHash: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE maintenance.maintenance_plan_versions
        SET status = 'SUPERSEDED'
        WHERE maintenance_plan_id = $1
          AND id <> $2
          AND status = 'PUBLISHED'
      `,
      [planId, versionId],
    );
    await client.query(
      `
        UPDATE maintenance.maintenance_plan_versions
        SET status = 'PUBLISHED', content_hash_sha256 = $2, published_at = clock_timestamp()
        WHERE id = $1
      `,
      [versionId, contentHash],
    );
  }

  async createPlanRevision(
    client: PoolClient,
    tenantId: string,
    planId: string,
    sourceVersion: PlanningRow,
    versionId: string,
    userId: string,
  ): Promise<void> {
    const revisionResult = await client.query<{ revision: number }>(
      `
        SELECT COALESCE(max(revision), 0)::integer + 1 AS revision
        FROM maintenance.maintenance_plan_versions
        WHERE maintenance_plan_id = $1
      `,
      [planId],
    );
    const revision = revisionResult.rows[0]?.revision;
    if (!revision) throw new Error('Não foi possível calcular a nova revisão do plano.');
    await client.query(
      `
        INSERT INTO maintenance.maintenance_plan_versions (
          id, tenant_id, maintenance_plan_id, checklist_template_version_id,
          revision, status, criticality, trigger_type, trigger_value, trigger_unit,
          recurrence_days, estimated_duration_minutes, lockout_required,
          evidence_required, maximum_sessions, maintenance_stop_mode,
          technical_analysis, technical_area_id, content_hash_sha256,
          source_version_id, replaces_version_id, created_by
        )
        VALUES (
          $1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18, $19, $19, $20
        )
      `,
      [
        versionId,
        tenantId,
        planId,
        sourceVersion.checklist_template_version_id,
        revision,
        sourceVersion.criticality,
        sourceVersion.trigger_type,
        sourceVersion.trigger_value,
        sourceVersion.trigger_unit,
        sourceVersion.recurrence_days,
        sourceVersion.estimated_duration_minutes,
        sourceVersion.lockout_required,
        sourceVersion.evidence_required,
        sourceVersion.maximum_sessions,
        sourceVersion.maintenance_stop_mode,
        JSON.stringify(sourceVersion.technical_analysis ?? {}),
        sourceVersion.technical_area_id,
        sourceVersion.content_hash_sha256,
        sourceVersion.id,
        userId,
      ],
    );
  }

  async writeAudit(
    client: PoolClient,
    tenantId: string,
    userId: string,
    metadata: RequestAuditMetadata,
    action: string,
    entityType: string,
    entityId: string,
    beforeData: Readonly<Record<string, unknown>> | null,
    afterData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO audit.events (
          tenant_id, user_id, role_snapshot, action, entity_type, entity_id,
          before_data, after_data, redacted_fields, trace_id, source,
          user_agent, ip_address
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, ARRAY[]::text[],
          $9, 'APPLICATION', $10, $11
        )
      `,
      [
        tenantId,
        userId,
        metadata.roleSnapshot,
        action,
        entityType,
        entityId,
        beforeData ? JSON.stringify(beforeData) : null,
        JSON.stringify(afterData),
        metadata.traceId,
        metadata.userAgent,
        metadata.ipAddress,
      ],
    );
  }
}
