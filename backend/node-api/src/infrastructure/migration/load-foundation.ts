import {
  activeStatus,
  criticality,
  lifecycleStatus,
  operationalStatus,
  roleType,
} from './legacy-enums.js';
import {
  booleanValue,
  enumValue,
  integerValue,
  jsonValue,
  numberValue,
  optionalNumber,
  optionalText,
  text,
  timestamp,
  upper,
} from './legacy-values.js';
import {
  referenceId,
  requiredLegacyId,
  targetId,
  type LoadedTarget,
  type MigrationLoadContext,
} from './loader-context.js';
import type { SourceRowSnapshot } from './source-snapshot.js';

const userStatus = {
  ATIVO: 'ACTIVE',
  ACTIVE: 'ACTIVE',
  INATIVO: 'INACTIVE',
  INACTIVE: 'INACTIVE',
  BLOQUEADO: 'BLOCKED',
  BLOCKED: 'BLOCKED',
  ARQUIVADO: 'ARCHIVED',
  ARCHIVED: 'ARCHIVED',
} as const;

export async function ensureTenantRoles(context: MigrationLoadContext): Promise<void> {
  const roles = [
    ['ADMIN', 'Administrador', 'Administração integral do ambiente.', 'ADMIN'],
    ['MANAGER', 'Gestor', 'Validação e acompanhamento técnico.', 'MANAGER'],
    ['OPERATOR', 'Operador', 'Execução operacional no chão de fábrica.', 'OPERATOR'],
    ['SYSTEM', 'Sistema', 'Identidade técnica para eventos automatizados.', 'CUSTOM'],
  ] as const;
  for (const [code, name, description, type] of roles) {
    await context.client.query(
      `INSERT INTO iam.roles
       (id,tenant_id,legacy_id,code,name,description,role_type,protected,status)
       VALUES ($1,$2,$3,$3,$4,$5,$6,true,'ACTIVE')
       ON CONFLICT (tenant_id,code) DO UPDATE SET
         name=EXCLUDED.name,description=EXCLUDED.description,role_type=EXCLUDED.role_type,
         protected=true,status='ACTIVE',updated_at=clock_timestamp()`,
      [targetId(context, 'roles', code), context.tenantId, code, name, description, type],
    );
  }

  await context.client.query(
    `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
     SELECT $1,$2,capability.id,'ALLOW' FROM iam.capabilities capability
     WHERE capability.status='ACTIVE'
     ON CONFLICT (tenant_id,role_id,capability_id) DO UPDATE SET effect='ALLOW'`,
    [context.tenantId, targetId(context, 'roles', 'ADMIN')],
  );
  await context.client.query(
    `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
     SELECT $1,$2,capability.id,'ALLOW' FROM iam.capabilities capability
     WHERE capability.code = ANY($3::text[])
     ON CONFLICT (tenant_id,role_id,capability_id) DO UPDATE SET effect='ALLOW'`,
    [
      context.tenantId,
      targetId(context, 'roles', 'MANAGER'),
      [
        'cmms.structure.read',
        'cmms.assets.read',
        'cmms.parameters.read',
        'cmms.materials.read',
        'cmms.readings.create',
        'maintenance.checklists.read',
        'maintenance.checklists.review',
        'maintenance.plans.read',
        'maintenance.work-orders.read',
        'maintenance.work-orders.review',
        'maintenance.executions.read',
        'maintenance.occurrences.read',
        'maintenance.occurrences.report',
        'maintenance.occurrences.triage',
        'maintenance.stops.read',
        'maintenance.stops.manage',
        'maintenance.alerts.read',
        'maintenance.alerts.manage',
        'workflow.notifications.read',
        'analytics.technical.read',
      ],
    ],
  );
  await context.client.query(
    `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
     SELECT $1,$2,capability.id,'ALLOW' FROM iam.capabilities capability
     WHERE capability.code = ANY($3::text[])
     ON CONFLICT (tenant_id,role_id,capability_id) DO UPDATE SET effect='ALLOW'`,
    [
      context.tenantId,
      targetId(context, 'roles', 'OPERATOR'),
      [
        'cmms.structure.read',
        'cmms.assets.read',
        'cmms.parameters.read',
        'cmms.materials.read',
        'cmms.readings.create',
        'maintenance.checklists.read',
        'maintenance.plans.read',
        'maintenance.work-orders.read',
        'maintenance.executions.read',
        'maintenance.executions.perform',
        'maintenance.occurrences.read',
        'maintenance.occurrences.report',
        'maintenance.stops.read',
        'workflow.notifications.read',
      ],
    ],
  );
}

export async function loadUser(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'usuarios', legacyId);
  const profile = upper(row.payload.perfil) ?? 'OPERADOR';
  const mappedRole = enumValue(profile, 'perfil', roleType);
  const baseRoleCode = mappedRole === 'CUSTOM' ? 'SYSTEM' : mappedRole;
  const specialties = jsonValue(row.payload.especialidades_json, 'especialidades_json', []);
  if (!Array.isArray(specialties)) {
    throw new Error('especialidades_json deve ser uma lista.');
  }
  const scopes = jsonValue(row.payload.escopo_ids_json, 'escopo_ids_json', []);

  await context.client.query(
    `INSERT INTO iam.users
     (id,tenant_id,legacy_id,employee_number,name,email,status,first_access_required,
      failed_login_attempts,locked_until,last_login_at,password_changed_at,recovery_reference,
      recovery_requested_at,specialties,metadata,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,
             COALESCE($17::timestamptz,clock_timestamp()),COALESCE($18::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       employee_number=EXCLUDED.employee_number,name=EXCLUDED.name,email=EXCLUDED.email,
       status=EXCLUDED.status,first_access_required=EXCLUDED.first_access_required,
       failed_login_attempts=EXCLUDED.failed_login_attempts,locked_until=EXCLUDED.locked_until,
       last_login_at=EXCLUDED.last_login_at,password_changed_at=EXCLUDED.password_changed_at,
       recovery_reference=EXCLUDED.recovery_reference,
       recovery_requested_at=EXCLUDED.recovery_requested_at,specialties=EXCLUDED.specialties,
       metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'matricula', legacyId),
      text(row.payload, 'nome'),
      optionalText(row.payload.email),
      enumValue(row.payload.status, 'status', userStatus, 'ACTIVE'),
      booleanValue(row.payload.primeiro_acesso, true),
      Math.max(0, integerValue(row.payload.tentativas_login, 'tentativas_login', 0)),
      timestamp(row.payload.bloqueado_ate, 'bloqueado_ate', context.timeZone),
      timestamp(row.payload.ultimo_login_em, 'ultimo_login_em', context.timeZone),
      timestamp(row.payload.senha_atualizada_em, 'senha_atualizada_em', context.timeZone),
      optionalText(row.payload.recuperacao_referencia),
      timestamp(
        row.payload.recuperacao_solicitada_em,
        'recuperacao_solicitada_em',
        context.timeZone,
      ),
      JSON.stringify(specialties),
      JSON.stringify({
        legacy_profile: profile,
        legacy_area_id: optionalText(row.payload.area_id),
        legacy_role_id: optionalText(row.payload.cargo_id),
        legacy_scopes: scopes,
      }),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );

  await context.client.query(
    `INSERT INTO iam.user_roles (tenant_id,user_id,role_id,assigned_by)
     VALUES ($1,$2,$3,NULL)
     ON CONFLICT (tenant_id,user_id,role_id) DO NOTHING`,
    [context.tenantId, id, targetId(context, 'roles', baseRoleCode)],
  );

  const passwordHash = optionalText(row.payload.senha_hash);
  const pinHash = optionalText(row.payload.pin_hash);
  if (passwordHash || pinHash) {
    await context.client.query(
      `INSERT INTO iam.credentials
       (id,tenant_id,user_id,credential_type,algorithm,legacy_hash,legacy_algorithm,
        legacy_migration_status,created_at,updated_at)
       VALUES ($1,$2,$3,'PASSWORD','LEGACY_APPS_SCRIPT',$4,'APPS_SCRIPT_V1','RESET_REQUIRED',
               COALESCE($5::timestamptz,clock_timestamp()),COALESCE($6::timestamptz,clock_timestamp()))
       ON CONFLICT (tenant_id,user_id,credential_type) DO UPDATE SET
         algorithm=EXCLUDED.algorithm,password_hash=NULL,pin_hash=NULL,
         legacy_hash=EXCLUDED.legacy_hash,legacy_algorithm=EXCLUDED.legacy_algorithm,
         legacy_migration_status='RESET_REQUIRED',updated_at=EXCLUDED.updated_at,revoked_at=NULL`,
      [
        targetId(context, 'credentials', legacyId),
        context.tenantId,
        id,
        JSON.stringify({ password_hash: passwordHash, pin_hash: pinHash }),
        timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
        timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ],
    );
  }
  return { schema: 'iam', table: 'users', id };
}

export async function loadTechnicalArea(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'areas_tecnicas', legacyId);
  const legacyCode = text(row.payload, 'codigo').toUpperCase();
  const code = ['QUALIDADE', 'QUALITY'].includes(legacyCode)
    ? 'QUALITY'
    : ['SEGURANCA', 'SEGURANÇA', 'SAFETY'].includes(legacyCode)
      ? 'SAFETY'
      : legacyCode;
  await context.client.query(
    `INSERT INTO iam.technical_areas
     (id,tenant_id,legacy_id,code,name,description,default_signature_required,
      validation_area,status,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE($11::timestamptz,clock_timestamp()),COALESCE($12::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       code=EXCLUDED.code,name=EXCLUDED.name,description=EXCLUDED.description,
       default_signature_required=EXCLUDED.default_signature_required,
       validation_area=EXCLUDED.validation_area,status=EXCLUDED.status,
       created_by=EXCLUDED.created_by,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      code,
      text(row.payload, 'nome'),
      text(row.payload, 'descricao', 'Área técnica migrada do ambiente legado.'),
      booleanValue(row.payload.exige_assinatura_padrao, false),
      ['QUALITY', 'SAFETY'].includes(code),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por', true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'iam', table: 'technical_areas', id };
}

export async function loadTechnicalRole(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'cargos_tecnicos', legacyId);
  await context.client.query(
    `INSERT INTO iam.technical_roles
     (id,tenant_id,legacy_id,technical_area_id,code,name,description,can_sign,status,
      created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE($11::timestamptz,clock_timestamp()),COALESCE($12::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       technical_area_id=EXCLUDED.technical_area_id,code=EXCLUDED.code,name=EXCLUDED.name,
       description=EXCLUDED.description,can_sign=EXCLUDED.can_sign,status=EXCLUDED.status,
       created_by=EXCLUDED.created_by,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id'),
      text(row.payload, 'codigo').toUpperCase(),
      text(row.payload, 'nome'),
      text(row.payload, 'descricao', 'Cargo técnico migrado do ambiente legado.'),
      booleanValue(row.payload.pode_assinar, false),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por', true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'iam', table: 'technical_roles', id };
}

export async function linkUserTechnicalAssignments(context: MigrationLoadContext): Promise<void> {
  const userSheet = context.snapshot.sheets.find((candidate) => candidate.name === 'usuarios');
  if (!userSheet) return;
  for (const row of userSheet.rows) {
    const areaId = referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id', true);
    if (!areaId) continue;
    const userId = targetId(context, 'usuarios', requiredLegacyId(row));
    const technicalRoleId = referenceId(
      context,
      'cargos_tecnicos',
      row.payload.cargo_id,
      'cargo_id',
      true,
    );
    await context.client.query(
      `INSERT INTO iam.user_technical_assignments
       (id,tenant_id,user_id,technical_area_id,technical_role_id,is_primary,status,valid_from,assigned_by)
       VALUES ($1,$2,$3,$4,$5,true,'ACTIVE',COALESCE($6::timestamptz,'1970-01-01'),$7)
       ON CONFLICT (tenant_id,id) DO UPDATE SET
         user_id=EXCLUDED.user_id,technical_area_id=EXCLUDED.technical_area_id,
         technical_role_id=EXCLUDED.technical_role_id,is_primary=true,status='ACTIVE',
         valid_until=NULL,updated_at=clock_timestamp()`,
      [
        targetId(context, 'user_technical_assignments', requiredLegacyId(row)),
        context.tenantId,
        userId,
        areaId,
        technicalRoleId,
        timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
        context.actorId,
      ],
    );
  }
}

export async function loadPlant(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'plantas', legacyId);
  await context.client.query(
    `INSERT INTO cmms.plants (id,tenant_id,legacy_id,tag,name,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,clock_timestamp()),
             COALESCE($8::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       tag=EXCLUDED.tag,name=EXCLUDED.name,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'tag'),
      text(row.payload, 'nome'),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'plants', id };
}

export async function loadSector(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'setores', legacyId);
  await context.client.query(
    `INSERT INTO cmms.sectors (id,tenant_id,legacy_id,plant_id,tag,name,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,clock_timestamp()),
             COALESCE($9::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       plant_id=EXCLUDED.plant_id,tag=EXCLUDED.tag,name=EXCLUDED.name,
       status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'plantas', row.payload.planta_id, 'planta_id'),
      text(row.payload, 'tag'),
      text(row.payload, 'nome'),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'sectors', id };
}

export async function loadLine(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'linhas', legacyId);
  await context.client.query(
    `INSERT INTO cmms.lines (id,tenant_id,legacy_id,sector_id,tag,name,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,clock_timestamp()),
             COALESCE($9::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       sector_id=EXCLUDED.sector_id,tag=EXCLUDED.tag,name=EXCLUDED.name,
       status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'setores', row.payload.setor_id, 'setor_id'),
      text(row.payload, 'tag'),
      text(row.payload, 'nome'),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'lines', id };
}

export async function loadAsset(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'ativos', legacyId);
  const legacyStatus = row.payload.status;
  await context.client.query(
    `INSERT INTO cmms.assets
     (id,tenant_id,legacy_id,line_id,tag,qr_payload,name,asset_type,criticality,
      operational_status,lifecycle_status,health_percent,current_hour_meter,hour_meter_mode,
      hour_meter_updated_at,service_hour_meter_baseline,service_hour_meter_baseline_at,
      manufacturer,model,serial_number,technical_location,metadata,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22::jsonb,COALESCE($23::timestamptz,clock_timestamp()),
             COALESCE($24::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       line_id=EXCLUDED.line_id,tag=EXCLUDED.tag,qr_payload=EXCLUDED.qr_payload,
       name=EXCLUDED.name,asset_type=EXCLUDED.asset_type,criticality=EXCLUDED.criticality,
       operational_status=EXCLUDED.operational_status,lifecycle_status=EXCLUDED.lifecycle_status,
       health_percent=EXCLUDED.health_percent,current_hour_meter=EXCLUDED.current_hour_meter,
       hour_meter_mode=EXCLUDED.hour_meter_mode,hour_meter_updated_at=EXCLUDED.hour_meter_updated_at,
       service_hour_meter_baseline=EXCLUDED.service_hour_meter_baseline,
       service_hour_meter_baseline_at=EXCLUDED.service_hour_meter_baseline_at,
       manufacturer=EXCLUDED.manufacturer,model=EXCLUDED.model,serial_number=EXCLUDED.serial_number,
       technical_location=EXCLUDED.technical_location,metadata=EXCLUDED.metadata,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'linhas', row.payload.linha_id, 'linha_id'),
      text(row.payload, 'tag'),
      text(row.payload, 'qr_payload', `FAB:ASSET:${text(row.payload, 'tag')}`),
      text(row.payload, 'nome'),
      text(row.payload, 'tipo', 'EQUIPMENT').toUpperCase(),
      enumValue(row.payload.criticidade, 'criticidade', criticality, 'MEDIUM'),
      enumValue(legacyStatus, 'status', operationalStatus, 'OPERATING'),
      enumValue(legacyStatus, 'status', lifecycleStatus, 'ACTIVE'),
      optionalNumber(row.payload.saude_pct, 'saude_pct'),
      optionalNumber(row.payload.horimetro_atual, 'horimetro_atual'),
      optionalText(row.payload.horimetro_modo),
      timestamp(row.payload.horimetro_atualizado_em, 'horimetro_atualizado_em', context.timeZone),
      optionalNumber(row.payload.horimetro_base_servico, 'horimetro_base_servico'),
      timestamp(
        row.payload.horimetro_base_servico_em,
        'horimetro_base_servico_em',
        context.timeZone,
      ),
      optionalText(row.payload.fabricante),
      optionalText(row.payload.modelo),
      optionalText(row.payload.numero_serie),
      optionalText(row.payload.localizacao_tecnica),
      JSON.stringify({ migrated_from: 'Google Sheets', source_hash_sha256: row.hashSha256 }),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'assets', id };
}

export async function loadComponent(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'componentes', legacyId);
  await context.client.query(
    `INSERT INTO cmms.components
     (id,tenant_id,legacy_id,asset_id,tag,qr_payload,name,component_type,criticality,
      operational_status,lifecycle_status,useful_life_hours,useful_life_days,accumulated_hours,
      installed_at,manufacturer,model,serial_number,technical_location,metadata,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20::jsonb,COALESCE($21::timestamptz,clock_timestamp()),
             COALESCE($22::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       asset_id=EXCLUDED.asset_id,tag=EXCLUDED.tag,qr_payload=EXCLUDED.qr_payload,
       name=EXCLUDED.name,component_type=EXCLUDED.component_type,
       criticality=EXCLUDED.criticality,operational_status=EXCLUDED.operational_status,
       lifecycle_status=EXCLUDED.lifecycle_status,useful_life_hours=EXCLUDED.useful_life_hours,
       useful_life_days=EXCLUDED.useful_life_days,accumulated_hours=EXCLUDED.accumulated_hours,
       installed_at=EXCLUDED.installed_at,manufacturer=EXCLUDED.manufacturer,model=EXCLUDED.model,
       serial_number=EXCLUDED.serial_number,technical_location=EXCLUDED.technical_location,
       metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      text(row.payload, 'tag'),
      text(row.payload, 'qr_payload', `FAB:COMPONENT:${text(row.payload, 'tag')}`),
      text(row.payload, 'nome'),
      text(row.payload, 'tipo', 'COMPONENT').toUpperCase(),
      enumValue(row.payload.criticidade, 'criticidade', criticality, 'MEDIUM'),
      enumValue(row.payload.status, 'status', operationalStatus, 'OPERATING'),
      enumValue(row.payload.status, 'status', lifecycleStatus, 'ACTIVE'),
      optionalNumber(row.payload.vida_util_horas, 'vida_util_horas'),
      optionalText(row.payload.vida_util_dias) === null
        ? null
        : integerValue(row.payload.vida_util_dias, 'vida_util_dias'),
      optionalNumber(row.payload.horas_acumuladas, 'horas_acumuladas'),
      timestamp(row.payload.instalado_em, 'instalado_em', context.timeZone),
      optionalText(row.payload.fabricante),
      optionalText(row.payload.modelo),
      optionalText(row.payload.numero_serie),
      optionalText(row.payload.localizacao_tecnica),
      JSON.stringify({ migrated_from: 'Google Sheets', source_hash_sha256: row.hashSha256 }),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'components', id };
}

export async function loadMaterial(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'materiais', legacyId);
  await context.client.query(
    `INSERT INTO cmms.materials
     (id,tenant_id,legacy_id,sku,name,unit,current_stock,minimum_stock,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,clock_timestamp()),
             COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       sku=EXCLUDED.sku,name=EXCLUDED.name,unit=EXCLUDED.unit,
       current_stock=EXCLUDED.current_stock,minimum_stock=EXCLUDED.minimum_stock,
       status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'sku'),
      text(row.payload, 'nome'),
      text(row.payload, 'unidade'),
      Math.max(0, numberValue(row.payload.estoque_atual, 'estoque_atual', 0)),
      Math.max(0, numberValue(row.payload.estoque_minimo, 'estoque_minimo', 0)),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'cmms', table: 'materials', id };
}
