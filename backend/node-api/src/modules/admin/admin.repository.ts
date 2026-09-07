import type { PoolClient, QueryResultRow } from 'pg';

import type {
  AdminAuditMetadata,
  AdminProfile,
  AdminRow,
  AdminStatus,
  AuditListQuery,
  SaveTechnicalAreaInput,
  SaveTechnicalRoleInput,
  SaveUserInput,
  UserListQuery,
} from './admin.types.js';

function profileRoleType(profile: AdminProfile): string {
  return profile === 'GESTOR' ? 'MANAGER' : profile;
}

export interface MonitoringIssueRow extends QueryResultRow {
  readonly code: string;
  readonly entity: string;
  readonly entity_id: string;
  readonly message: string;
}

export interface MonitoringSummaryRow extends QueryResultRow {
  readonly audit_events_24h: number | string;
  readonly declared_tables: number | string;
}

export class AdminRepository {
  async listUsers(client: PoolClient, query: UserListQuery): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT usuario.id, usuario.name AS nome, usuario.email,
              usuario.employee_number AS matricula,
              CASE papel.role_type WHEN 'ADMIN' THEN 'ADMIN' WHEN 'OPERATOR' THEN 'OPERADOR' ELSE 'GESTOR' END AS perfil,
              CASE WHEN usuario.status = 'ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END AS status,
              CASE WHEN usuario.first_access_required THEN 'SIM' ELSE 'NAO' END AS primeiro_acesso,
              usuario.failed_login_attempts AS tentativas_login,
              usuario.locked_until AS bloqueado_ate, usuario.last_login_at AS ultimo_login_em,
              usuario.password_changed_at AS senha_atualizada_em,
              usuario.recovery_reference AS recuperacao_referencia,
              usuario.recovery_requested_at AS recuperacao_solicitada_em,
              (usuario.recovery_reference IS NOT NULL) AS recuperacao_pendente,
              count(DISTINCT sessao.id) FILTER (
                WHERE sessao.status = 'ACTIVE' AND sessao.expires_at > clock_timestamp()
              )::integer AS sessoes_ativas,
              usuario.created_at AS criado_em, usuario.updated_at AS atualizado_em,
              atribuicao.technical_area_id AS area_id,
              atribuicao.technical_role_id AS cargo_id,
              usuario.specialties::text AS especialidades_json,
              COALESCE(usuario.metadata->'scope_ids', '[]'::jsonb)::text AS escopo_ids_json
       FROM iam.users usuario
       LEFT JOIN iam.user_roles usuario_papel
         ON usuario_papel.tenant_id = usuario.tenant_id AND usuario_papel.user_id = usuario.id
        AND usuario_papel.valid_from <= clock_timestamp()
        AND (usuario_papel.valid_until IS NULL OR usuario_papel.valid_until > clock_timestamp())
       LEFT JOIN iam.roles papel
         ON papel.tenant_id = usuario_papel.tenant_id AND papel.id = usuario_papel.role_id
       LEFT JOIN iam.user_technical_assignments atribuicao
         ON atribuicao.tenant_id = usuario.tenant_id AND atribuicao.user_id = usuario.id
        AND atribuicao.is_primary AND atribuicao.status = 'ACTIVE'
       LEFT JOIN iam.sessions sessao
         ON sessao.tenant_id = usuario.tenant_id AND sessao.user_id = usuario.id
       WHERE usuario.deleted_at IS NULL
         AND ($1 = '' OR usuario.name ILIKE '%' || $1 || '%'
              OR usuario.employee_number ILIKE '%' || $1 || '%'
              OR COALESCE(usuario.email, '') ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR CASE papel.role_type WHEN 'ADMIN' THEN 'ADMIN' WHEN 'OPERATOR' THEN 'OPERADOR' ELSE 'GESTOR' END = $2)
         AND ($3::text IS NULL OR CASE WHEN usuario.status = 'ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END = $3)
       GROUP BY usuario.id, papel.role_type, atribuicao.technical_area_id, atribuicao.technical_role_id
       ORDER BY usuario.name, usuario.id
       LIMIT $4`,
      [query.search, query.profile, query.status, query.limit],
    );
    return result.rows;
  }

  async findUser(client: PoolClient, userId: string): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT id, name, email, employee_number, status, first_access_required,
              specialties, metadata
       FROM iam.users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async saveUser(
    client: PoolClient,
    tenantId: string,
    actorId: string,
    input: SaveUserInput,
    passwordHash: string | null,
  ): Promise<{
    readonly id: string;
    readonly mode: 'insert' | 'update';
    readonly revoked: number;
  }> {
    let userId = input.id;
    const mode = userId ? 'update' : 'insert';
    const metadata = JSON.stringify({ scope_ids: input.scopeIds });
    if (userId) {
      await client.query(
        `UPDATE iam.users SET name=$2, email=$3, employee_number=$4,
                status=$5, specialties=$6::jsonb,
                metadata=COALESCE(metadata, '{}'::jsonb) || $7::jsonb
         WHERE id=$1 AND deleted_at IS NULL`,
        [
          userId,
          input.name,
          input.email,
          input.employeeNumber,
          input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
          JSON.stringify(input.specialties),
          metadata,
        ],
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO iam.users
           (tenant_id,name,email,employee_number,status,first_access_required,specialties,metadata)
         VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,$7::jsonb) RETURNING id`,
        [
          tenantId,
          input.name,
          input.email,
          input.employeeNumber,
          input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
          JSON.stringify(input.specialties),
          metadata,
        ],
      );
      userId = inserted.rows[0]?.id ?? null;
    }
    if (!userId) throw new Error('O PostgreSQL não retornou o identificador do usuário.');

    const role = await client.query<{ id: string }>(
      `SELECT id FROM iam.roles
       WHERE role_type=$1 AND status='ACTIVE' AND deleted_at IS NULL
       ORDER BY protected DESC, created_at LIMIT 1`,
      [profileRoleType(input.profile)],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error(`Não existe papel ativo para o perfil ${input.profile}.`);
    await client.query(`DELETE FROM iam.user_roles WHERE user_id=$1`, [userId]);
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id,assigned_by)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, userId, roleId, actorId],
    );

    await client.query(
      `UPDATE iam.user_technical_assignments
       SET status='INACTIVE', valid_until=clock_timestamp(), is_primary=false
       WHERE user_id=$1 AND status='ACTIVE'`,
      [userId],
    );
    if (input.areaId) {
      await client.query(
        `INSERT INTO iam.user_technical_assignments
           (tenant_id,user_id,technical_area_id,technical_role_id,is_primary,status,assigned_by)
         VALUES ($1,$2,$3,$4,true,'ACTIVE',$5)`,
        [tenantId, userId, input.areaId, input.technicalRoleId, actorId],
      );
    }

    if (passwordHash) {
      await client.query(
        `INSERT INTO iam.credentials
           (tenant_id,user_id,credential_type,algorithm,password_hash,legacy_migration_status)
         VALUES ($1,$2,'PASSWORD','ARGON2ID',$3,'NOT_REQUIRED')
         ON CONFLICT (tenant_id,user_id,credential_type) DO UPDATE
         SET algorithm='ARGON2ID', password_hash=EXCLUDED.password_hash,
             legacy_hash=NULL, legacy_algorithm=NULL, legacy_migration_status='REHASHED',
             revoked_at=NULL, updated_at=clock_timestamp()`,
        [tenantId, userId, passwordHash],
      );
      await client.query(
        `UPDATE iam.users SET first_access_required=true, password_changed_at=clock_timestamp(),
                failed_login_attempts=0, locked_until=NULL
         WHERE id=$1`,
        [userId],
      );
    }

    const revoked = await this.revokeSessions(client, userId, 'ADMIN_USER_CHANGED');
    return { id: userId, mode, revoked };
  }

  async unlockUser(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `UPDATE iam.users SET failed_login_attempts=0, locked_until=NULL,
              status=CASE WHEN status='BLOCKED' THEN 'ACTIVE' ELSE status END
       WHERE id=$1 AND deleted_at IS NULL`,
      [userId],
    );
  }

  async resetPassword(client: PoolClient, userId: string, passwordHash: string): Promise<number> {
    await client.query(
      `UPDATE iam.credentials SET algorithm='ARGON2ID', password_hash=$2,
              legacy_hash=NULL, legacy_algorithm=NULL, legacy_migration_status='REHASHED',
              revoked_at=NULL, updated_at=clock_timestamp()
       WHERE user_id=$1 AND credential_type='PASSWORD'`,
      [userId, passwordHash],
    );
    await client.query(
      `UPDATE iam.users SET first_access_required=true, password_changed_at=clock_timestamp(),
              failed_login_attempts=0, locked_until=NULL
       WHERE id=$1 AND deleted_at IS NULL`,
      [userId],
    );
    return this.revokeSessions(client, userId, 'ADMIN_PASSWORD_RESET');
  }

  async revokeSessions(client: PoolClient, userId: string, reason: string): Promise<number> {
    const result = await client.query(
      `UPDATE iam.sessions SET status='REVOKED', revoked_at=clock_timestamp(), revocation_reason=$2
       WHERE user_id=$1 AND status='ACTIVE' AND expires_at > clock_timestamp()`,
      [userId, reason],
    );
    return result.rowCount ?? 0;
  }

  async listAreas(client: PoolClient, status: AdminStatus | null): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT id, code AS codigo, name AS nome, description AS descricao,
              CASE WHEN status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END AS status,
              CASE WHEN default_signature_required THEN 'SIM' ELSE 'NAO' END AS exige_assinatura_padrao,
              validation_area AS area_validacao
       FROM iam.technical_areas
       WHERE deleted_at IS NULL
         AND ($1::text IS NULL OR CASE WHEN status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END=$1)
       ORDER BY name`,
      [status],
    );
    return result.rows;
  }

  async saveArea(
    client: PoolClient,
    tenantId: string,
    actorId: string,
    input: SaveTechnicalAreaInput,
  ): Promise<string> {
    if (input.id) {
      await client.query(
        `UPDATE iam.technical_areas SET code=$2,name=$3,description=$4,
                default_signature_required=$5,status=$6
         WHERE id=$1 AND deleted_at IS NULL`,
        [
          input.id,
          input.code,
          input.name,
          input.description,
          input.defaultSignatureRequired,
          input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
        ],
      );
      return input.id;
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO iam.technical_areas
         (tenant_id,code,name,description,default_signature_required,validation_area,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id`,
      [
        tenantId,
        input.code,
        input.name,
        input.description,
        input.defaultSignatureRequired,
        input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
        actorId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('O PostgreSQL não retornou a área criada.');
    return id;
  }

  async listRoles(
    client: PoolClient,
    areaId: string | null,
    status: AdminStatus | null,
  ): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT id,technical_area_id AS area_id,code AS codigo,name AS nome,description AS descricao,
              CASE WHEN status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END AS status,
              CASE WHEN can_sign THEN 'SIM' ELSE 'NAO' END AS pode_assinar
       FROM iam.technical_roles
       WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR technical_area_id=$1)
         AND ($2::text IS NULL OR CASE WHEN status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END=$2)
       ORDER BY name`,
      [areaId, status],
    );
    return result.rows;
  }

  async saveRole(
    client: PoolClient,
    tenantId: string,
    actorId: string,
    input: SaveTechnicalRoleInput,
  ): Promise<string> {
    if (input.id) {
      await client.query(
        `UPDATE iam.technical_roles SET technical_area_id=$2,code=$3,name=$4,description=$5,
                can_sign=$6,status=$7 WHERE id=$1 AND deleted_at IS NULL`,
        [
          input.id,
          input.areaId,
          input.code,
          input.name,
          input.description,
          input.canSign,
          input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
        ],
      );
      return input.id;
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO iam.technical_roles
         (tenant_id,technical_area_id,code,name,description,can_sign,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        tenantId,
        input.areaId,
        input.code,
        input.name,
        input.description,
        input.canSign,
        input.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE',
        actorId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('O PostgreSQL não retornou o cargo criado.');
    return id;
  }

  async permissionMatrix(client: PoolClient): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT role.role_type, capability.id, capability.code, capability.name,
              capability.description, capability.protected,
              COALESCE(role_capability.effect='ALLOW',false) AS allowed
       FROM iam.roles role
       CROSS JOIN iam.capabilities capability
       LEFT JOIN iam.role_capabilities role_capability
         ON role_capability.role_id=role.id AND role_capability.capability_id=capability.id
       WHERE role.status='ACTIVE' AND capability.status='ACTIVE'
         AND role.role_type IN ('ADMIN','MANAGER','OPERATOR')
       ORDER BY role.role_type, capability.module, capability.name`,
    );
    return result.rows;
  }

  async savePermissions(
    client: PoolClient,
    profile: AdminProfile,
    permissions: Readonly<Record<string, boolean>>,
    actorId: string,
  ): Promise<void> {
    const roleType = profileRoleType(profile);
    for (const [code, allowed] of Object.entries(permissions)) {
      await client.query(
        `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect,granted_by)
         SELECT role.tenant_id,role.id,capability.id,$3,$4
         FROM iam.roles role JOIN iam.capabilities capability ON capability.code=$2
         WHERE role.role_type=$1 AND role.status='ACTIVE'
         ON CONFLICT (tenant_id,role_id,capability_id) DO UPDATE
         SET effect=EXCLUDED.effect,granted_by=EXCLUDED.granted_by,granted_at=clock_timestamp()`,
        [roleType, code, allowed ? 'ALLOW' : 'DENY', actorId],
      );
    }
  }

  async company(client: PoolClient): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT tenant.display_name AS nome,
              COALESCE(profile.metadata->>'logo_data_url','') AS logo_data_url,
              COALESCE(profile.updated_at,tenant.updated_at) AS atualizado_em
       FROM platform.tenants tenant
       LEFT JOIN platform.company_profiles profile ON profile.tenant_id=tenant.id
       WHERE tenant.id=platform.current_tenant_id()`,
    );
    return result.rows[0] ?? null;
  }

  async saveCompany(
    client: PoolClient,
    tenantId: string,
    actorId: string,
    name: string,
    logoDataUrl: string,
  ): Promise<void> {
    await client.query(`UPDATE platform.tenants SET display_name=$2 WHERE id=$1`, [tenantId, name]);
    await client.query(
      `INSERT INTO platform.company_profiles (tenant_id,trade_name,metadata,updated_by)
       VALUES ($1,$2,jsonb_build_object('logo_data_url',$3::text),$4)
       ON CONFLICT (tenant_id) DO UPDATE SET trade_name=EXCLUDED.trade_name,
         metadata=platform.company_profiles.metadata || EXCLUDED.metadata,
         updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,
      [tenantId, name, logoDataUrl, actorId],
    );
  }

  async commercialAccess(client: PoolClient): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT subscription.status, subscription.ends_at, plan.code AS plano_codigo,
              plan.name AS plano_nome, plan.limits,
              COALESCE(jsonb_agg(DISTINCT feature.code) FILTER (WHERE feature.code IS NOT NULL),'[]'::jsonb) AS recursos,
              maintenance.id AS janela_id, maintenance.status AS janela_status,
              maintenance.reason AS janela_motivo, maintenance.ends_at AS janela_expira_em
       FROM platform.tenants tenant
       LEFT JOIN platform.tenant_subscriptions subscription ON subscription.tenant_id=tenant.id
        AND subscription.status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED')
       LEFT JOIN platform.commercial_plans plan ON plan.id=subscription.commercial_plan_id
       LEFT JOIN platform.commercial_plan_features plan_feature ON plan_feature.commercial_plan_id=plan.id AND plan_feature.enabled
       LEFT JOIN platform.feature_catalog feature ON feature.id=plan_feature.feature_id AND feature.status='ACTIVE'
       LEFT JOIN platform.maintenance_windows maintenance ON maintenance.tenant_id=tenant.id AND maintenance.status='OPEN'
       WHERE tenant.id=platform.current_tenant_id()
       GROUP BY subscription.id,plan.id,maintenance.id`,
    );
    return result.rows[0] ?? null;
  }

  async activeConfiguration(client: PoolClient, lock = false): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT version.id,version.version_number AS numero,version.status,version.source AS origem,
              version.base_version_id AS base_versao_id,version.configuration AS configuracao,
              version.content_hash_sha256 AS hash_sha256,version.validation_result AS validacao,
              version.created_by AS criado_por,version.created_at AS criado_em,
              version.published_at AS publicado_em
       FROM platform.configuration_versions version
       WHERE version.status='PUBLISHED'
       ORDER BY version.version_number DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    );
    return result.rows[0] ?? null;
  }

  async configurationDraft(
    client: PoolClient,
    userId: string,
    lock = false,
  ): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT id,base_version_id AS base_versao_id,configuration AS configuracao,
              content_hash_sha256 AS hash_sha256,validation_result AS validacao,status,
              created_at AS criado_em,updated_at AS atualizado_em
       FROM platform.configuration_drafts
       WHERE user_id=$1 AND status IN ('EDITING','VALID','INVALID')
       ORDER BY updated_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async saveConfigurationDraft(
    client: PoolClient,
    tenantId: string,
    userId: string,
    baseVersionId: string | null,
    configuration: Readonly<Record<string, unknown>>,
    hash: string,
    validation: Readonly<Record<string, unknown>>,
    valid: boolean,
  ): Promise<AdminRow> {
    const existing = await this.configurationDraft(client, userId, true);
    if (existing) {
      const result = await client.query<AdminRow>(
        `UPDATE platform.configuration_drafts
         SET base_version_id=$2,configuration=$3::jsonb,content_hash_sha256=$4,
             validation_result=$5::jsonb,status=$6
         WHERE id=$1
         RETURNING id,base_version_id AS base_versao_id,configuration AS configuracao,
                   content_hash_sha256 AS hash_sha256,validation_result AS validacao,updated_at AS atualizado_em`,
        [
          existing.id,
          baseVersionId,
          JSON.stringify(configuration),
          hash,
          JSON.stringify(validation),
          valid ? 'VALID' : 'INVALID',
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Rascunho atualizado sem retorno.');
      return row;
    }
    const result = await client.query<AdminRow>(
      `INSERT INTO platform.configuration_drafts
         (tenant_id,user_id,base_version_id,configuration,content_hash_sha256,validation_result,status)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)
       RETURNING id,base_version_id AS base_versao_id,configuration AS configuracao,
                 content_hash_sha256 AS hash_sha256,validation_result AS validacao,updated_at AS atualizado_em`,
      [
        tenantId,
        userId,
        baseVersionId,
        JSON.stringify(configuration),
        hash,
        JSON.stringify(validation),
        valid ? 'VALID' : 'INVALID',
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Rascunho criado sem retorno.');
    return row;
  }

  async listConfigurationVersions(client: PoolClient, limit: number): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT id,version_number AS numero,status,source AS origem,base_version_id AS base_versao_id,
              content_hash_sha256 AS hash_sha256,
              COALESCE((validation_result->>'valido')::boolean,false) AS valido,
              created_by AS criado_por,created_at AS criado_em,published_at AS publicado_em,
              configuration AS configuracao
       FROM platform.configuration_versions
       ORDER BY version_number DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async publishConfiguration(
    client: PoolClient,
    tenantId: string,
    userId: string,
    draft: AdminRow,
    origin: 'PUBLICATION' | 'ROLLBACK',
  ): Promise<AdminRow> {
    const active = await this.activeConfiguration(client, true);
    await client.query(
      `UPDATE platform.configuration_versions SET status='SUPERSEDED' WHERE status='PUBLISHED'`,
    );
    const result = await client.query<AdminRow>(
      `INSERT INTO platform.configuration_versions
         (tenant_id,version_number,status,source,base_version_id,configuration,
          content_hash_sha256,validation_result,created_by,published_at)
       VALUES ($1,(SELECT COALESCE(max(version_number),0)+1 FROM platform.configuration_versions),
         'PUBLISHED',$2,$3,$4::jsonb,$5,$6::jsonb,$7,clock_timestamp())
       RETURNING id,version_number AS numero,content_hash_sha256 AS hash_sha256,
                 configuration AS configuracao,published_at AS publicado_em,created_by AS publicado_por`,
      [
        tenantId,
        origin,
        active?.id ?? null,
        JSON.stringify(draft.configuracao),
        draft.hash_sha256,
        JSON.stringify(draft.validacao),
        userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Publicação criada sem retorno.');
    return row;
  }

  async closeConfigurationDraft(client: PoolClient, draftId: string): Promise<void> {
    await client.query(`UPDATE platform.configuration_drafts SET status='PUBLISHED' WHERE id=$1`, [
      draftId,
    ]);
  }

  async openMaintenanceWindow(client: PoolClient): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT id,reason,starts_at,ends_at FROM platform.maintenance_windows
       WHERE status='OPEN' AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()
       ORDER BY starts_at DESC LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  async activeCommercialCatalog(client: PoolClient, lock = false): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT id,version_number AS numero,status,origin AS origem,base_version_id AS base_versao_id,
              catalog,content_hash_sha256 AS hash_sha256,validation_result AS validacao,
              created_by AS publicado_por,created_at AS publicado_em
       FROM platform.commercial_catalog_versions WHERE status='PUBLISHED'
       ORDER BY version_number DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    );
    return result.rows[0] ?? null;
  }

  async commercialCatalogDraft(
    client: PoolClient,
    userId: string,
    lock = false,
  ): Promise<AdminRow | null> {
    const result = await client.query<AdminRow>(
      `SELECT id,base_version_id AS base_versao_id,catalog,content_hash_sha256 AS hash_sha256,
              validation_result AS validacao,status,created_at AS criado_em,updated_at AS atualizado_em
       FROM platform.commercial_catalog_drafts
       WHERE user_id=$1 AND status IN ('EDITING','VALID','INVALID')
       ORDER BY updated_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async saveCommercialCatalogDraft(
    client: PoolClient,
    tenantId: string,
    userId: string,
    baseVersionId: string | null,
    catalog: Readonly<Record<string, unknown>>,
    hash: string,
    validation: Readonly<Record<string, unknown>>,
    valid: boolean,
  ): Promise<AdminRow> {
    const existing = await this.commercialCatalogDraft(client, userId, true);
    if (existing) {
      const result = await client.query<AdminRow>(
        `UPDATE platform.commercial_catalog_drafts SET base_version_id=$2,catalog=$3::jsonb,
                content_hash_sha256=$4,validation_result=$5::jsonb,status=$6
         WHERE id=$1 RETURNING id,base_version_id AS base_versao_id,catalog,
           content_hash_sha256 AS hash_sha256,validation_result AS validacao,updated_at AS atualizado_em`,
        [
          existing.id,
          baseVersionId,
          JSON.stringify(catalog),
          hash,
          JSON.stringify(validation),
          valid ? 'VALID' : 'INVALID',
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Rascunho comercial atualizado sem retorno.');
      return row;
    }
    const result = await client.query<AdminRow>(
      `INSERT INTO platform.commercial_catalog_drafts
         (tenant_id,user_id,base_version_id,catalog,content_hash_sha256,validation_result,status)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)
       RETURNING id,base_version_id AS base_versao_id,catalog,
         content_hash_sha256 AS hash_sha256,validation_result AS validacao,updated_at AS atualizado_em`,
      [
        tenantId,
        userId,
        baseVersionId,
        JSON.stringify(catalog),
        hash,
        JSON.stringify(validation),
        valid ? 'VALID' : 'INVALID',
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Rascunho comercial criado sem retorno.');
    return row;
  }

  async listCommercialCatalogVersions(
    client: PoolClient,
    limit: number,
  ): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT id,version_number AS numero,origin AS origem,content_hash_sha256 AS hash_sha256,
              created_by AS publicado_por,created_at AS publicado_em,status,
              catalog,validation_result AS validacao
       FROM platform.commercial_catalog_versions ORDER BY version_number DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async publishCommercialCatalog(
    client: PoolClient,
    tenantId: string,
    userId: string,
    draft: AdminRow,
    origin: 'PUBLICATION' | 'ROLLBACK',
  ): Promise<AdminRow> {
    const active = await this.activeCommercialCatalog(client, true);
    await client.query(
      `UPDATE platform.commercial_catalog_versions SET status='SUPERSEDED' WHERE status='PUBLISHED'`,
    );
    const result = await client.query<AdminRow>(
      `INSERT INTO platform.commercial_catalog_versions
         (tenant_id,version_number,status,origin,base_version_id,catalog,content_hash_sha256,
          validation_result,created_by)
       VALUES ($1,(SELECT COALESCE(max(version_number),0)+1 FROM platform.commercial_catalog_versions),
         'PUBLISHED',$2,$3,$4::jsonb,$5,$6::jsonb,$7)
       RETURNING id,version_number AS numero,origin AS origem,catalog,
         content_hash_sha256 AS hash_sha256,created_by AS publicado_por,created_at AS publicado_em`,
      [
        tenantId,
        origin,
        active?.id ?? null,
        JSON.stringify(draft.catalog),
        draft.hash_sha256,
        JSON.stringify(draft.validacao),
        userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Catálogo comercial publicado sem retorno.');
    return row;
  }

  async closeCommercialCatalogDraft(client: PoolClient, draftId: string): Promise<void> {
    await client.query(
      `UPDATE platform.commercial_catalog_drafts SET status='PUBLISHED' WHERE id=$1`,
      [draftId],
    );
  }

  async listAudit(client: PoolClient, query: AuditListQuery): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT event.id,event.occurred_at AS data_hora,event.action AS acao,
              event.entity_type AS entidade,event.entity_id AS registro,
              event.before_data AS antes,event.after_data AS depois,event.trace_id,
              event.role_snapshot AS perfil,usuario.id AS responsavel_id,
              COALESCE(usuario.name,'Sistema') AS responsavel
       FROM audit.events event
       LEFT JOIN iam.users usuario ON usuario.id=event.user_id
       WHERE ($1='' OR event.action ILIKE '%'||$1||'%' OR event.entity_type ILIKE '%'||$1||'%'
                    OR COALESCE(event.entity_id,'') ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR event.action ILIKE $2||'%')
         AND ($3::text IS NULL OR event.entity_type=$3)
         AND ($4::uuid IS NULL OR event.user_id=$4)
       ORDER BY event.occurred_at DESC,event.id DESC LIMIT $5`,
      [query.search, query.actionGroup, query.entityType, query.responsibleId, query.limit],
    );
    return result.rows;
  }

  async monitoringSummary(client: PoolClient): Promise<MonitoringSummaryRow> {
    const result = await client.query<MonitoringSummaryRow>(`
      SELECT
        (SELECT count(*) FROM audit.events
          WHERE occurred_at >= clock_timestamp() - interval '24 hours')::integer AS audit_events_24h,
        (SELECT count(*) FROM information_schema.tables
          WHERE table_type = 'BASE TABLE'
            AND table_schema IN ('platform','iam','cmms','maintenance','workflow','governance','audit','migration'))::integer
          AS declared_tables
    `);
    const row = result.rows[0];
    if (!row) throw new Error('O PostgreSQL não retornou o resumo de monitoramento.');
    return row;
  }

  async monitoringIssues(client: PoolClient): Promise<readonly MonitoringIssueRow[]> {
    const result = await client.query<MonitoringIssueRow>(`
      SELECT * FROM (
        SELECT
          'CHECKLIST_PUBLICADO_SEM_ITENS'::text AS code,
          'checklist_template_versions'::text AS entity,
          version.id::text AS entity_id,
          'Checklist publicado sem etapa ativa.'::text AS message
        FROM maintenance.checklist_template_versions version
        WHERE version.status = 'PUBLISHED'
          AND NOT EXISTS (
            SELECT 1 FROM maintenance.checklist_items item
            WHERE item.checklist_template_version_id = version.id AND item.status = 'ACTIVE'
          )

        UNION ALL

        SELECT
          'PLANO_PUBLICADO_CHECKLIST_INVALIDO', 'maintenance_plan_versions', plan.id::text,
          'Plano publicado sem checklist publicado e executável.'
        FROM maintenance.maintenance_plan_versions plan
        LEFT JOIN maintenance.checklist_template_versions checklist
          ON checklist.id = plan.checklist_template_version_id
        WHERE plan.status = 'PUBLISHED'
          AND (
            checklist.id IS NULL OR checklist.status <> 'PUBLISHED'
            OR NOT EXISTS (
              SELECT 1 FROM maintenance.checklist_items item
              WHERE item.checklist_template_version_id = checklist.id AND item.status = 'ACTIVE'
            )
          )

        UNION ALL

        SELECT
          'OS_PLANO_INCONSISTENTE', 'work_orders', work_order.id::text,
          'Ordem operacional aponta para plano não publicado ou checklist sem etapas.'
        FROM maintenance.work_orders work_order
        JOIN maintenance.maintenance_plan_versions plan ON plan.id = work_order.maintenance_plan_version_id
        JOIN maintenance.checklist_template_versions checklist ON checklist.id = plan.checklist_template_version_id
        WHERE work_order.status IN ('APPROVED','RELEASED','IN_PROGRESS','BLOCKED','COMPLETED')
          AND (
            plan.status <> 'PUBLISHED' OR checklist.status <> 'PUBLISHED'
            OR NOT EXISTS (
              SELECT 1 FROM maintenance.checklist_items item
              WHERE item.checklist_template_version_id = checklist.id AND item.status = 'ACTIVE'
            )
          )

        UNION ALL

        SELECT
          'ACAO_ABERTA_OS_TERMINAL', 'work_order_actions', action.id::text,
          'Ação aberta vinculada a uma ordem já encerrada.'
        FROM maintenance.work_order_actions action
        JOIN maintenance.work_orders work_order ON work_order.id = action.work_order_id
        WHERE action.status IN ('PENDING','READY','IN_PROGRESS','BLOCKED')
          AND work_order.status IN ('COMPLETED','CANCELLED','QUARANTINED')

        UNION ALL

        SELECT
          'EXECUCAO_TERMINAL_SEM_FIM', 'executions', execution.id::text,
          'Execução encerrada sem data final registrada.'
        FROM maintenance.executions execution
        WHERE execution.status IN ('COMPLETED','CANCELLED') AND execution.completed_at IS NULL

        UNION ALL

        SELECT
          'PARADA_ENCERRADA_SEM_RETORNO', 'equipment_stops', equipment_stop.id::text,
          'Parada encerrada sem horário de retorno operacional.'
        FROM maintenance.equipment_stops equipment_stop
        WHERE equipment_stop.status IN ('COMPLETED','CANCELLED') AND equipment_stop.completed_at IS NULL
      ) issues
      ORDER BY code, entity, entity_id
      LIMIT 300
    `);
    return result.rows;
  }

  async listTechnicalAnalyses(client: PoolClient): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT analysis.id,analysis.technical_demand_id AS demanda_id,
              analysis.occurrence_id AS ocorrencia_id,analysis.asset_id AS ativo_id,
              analysis.component_id AS componente_id,analysis.author_id AS autor_id,
              analysis.technical_area_id AS area_id,analysis.technical_role_id AS cargo_id,
              analysis.title AS titulo,analysis.diagnosis AS diagnostico,analysis.risk AS risco,
              analysis.probable_cause AS causa_provavel,analysis.recommendation AS recomendacao,
              CASE WHEN analysis.recommends_checklist THEN 'SIM' ELSE 'NAO' END AS recomenda_checklist,
              CASE WHEN analysis.recommends_work_order THEN 'SIM' ELSE 'NAO' END AS recomenda_os,
              analysis.priority AS prioridade,analysis.status,analysis.sent_to_admin_at AS enviado_admin_em,
              analysis.created_at AS criado_em,analysis.updated_at AS atualizado_em,
              analysis.report::text AS relatorio_tecnico_json
       FROM workflow.technical_analyses analysis
       ORDER BY analysis.sent_to_admin_at DESC NULLS LAST,analysis.created_at DESC`,
    );
    return result.rows;
  }

  async listTechnicalDemands(client: PoolClient, limit: number): Promise<readonly AdminRow[]> {
    const result = await client.query<AdminRow>(
      `SELECT demand.id,demand.demand_type AS tipo,demand.entity_type AS entidade_tipo,
              demand.entity_id AS entidade_id,demand.title AS titulo,demand.description AS descricao,
              demand.priority AS prioridade,demand.status,demand.created_at AS criado_em,
              demand.updated_at AS atualizado_em,demand.current_area_id AS area_id,
              demand.current_technical_role_id AS cargo_id
       FROM workflow.technical_demands demand
       ORDER BY demand.updated_at DESC,demand.id DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async audit(
    client: PoolClient,
    tenantId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string | null,
    before: AdminRow | null,
    after: AdminRow | null,
    metadata: AdminAuditMetadata,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.events
         (tenant_id,user_id,role_snapshot,action,entity_type,entity_id,before_data,after_data,
          redacted_fields,trace_id,source,user_agent,ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
         ARRAY['password','password_hash','token','token_hash_sha256'],
         $9,'ADMINISTRATIVE',$10,$11)`,
      [
        tenantId,
        actorId,
        metadata.roleSnapshot,
        action,
        entityType,
        entityId,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        metadata.traceId,
        metadata.userAgent,
        metadata.ipAddress,
      ],
    );
  }
}
