import { createHash } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { loadEnvironment } from '../../config/environment.js';
import { PasswordService } from '../../modules/auth/password.service.js';

const ids = {
  admin: '00000000-0000-4000-8000-000000000101',
  quality: '00000000-0000-4000-8000-000000000102',
  safety: '00000000-0000-4000-8000-000000000103',
  maintenance: '00000000-0000-4000-8000-000000000104',
  operator: '00000000-0000-4000-8000-000000000105',
  adminRole: '00000000-0000-4000-8000-000000000201',
  managerRole: '00000000-0000-4000-8000-000000000202',
  operatorRole: '00000000-0000-4000-8000-000000000203',
  qualityArea: '00000000-0000-4000-8000-000000000301',
  safetyArea: '00000000-0000-4000-8000-000000000302',
  maintenanceArea: '00000000-0000-4000-8000-000000000303',
  qualityTechnicalRole: '00000000-0000-4000-8000-000000000401',
  safetyTechnicalRole: '00000000-0000-4000-8000-000000000402',
  maintenanceTechnicalRole: '00000000-0000-4000-8000-000000000403',
  plant: '00000000-0000-4000-8000-000000000501',
  utilitiesSector: '00000000-0000-4000-8000-000000000502',
  productionSector: '00000000-0000-4000-8000-000000000503',
  utilitiesLine: '00000000-0000-4000-8000-000000000504',
  packagingLine: '00000000-0000-4000-8000-000000000505',
  pump: '00000000-0000-4000-8000-000000000601',
  motor: '00000000-0000-4000-8000-000000000602',
  compressor: '00000000-0000-4000-8000-000000000603',
  conveyor: '00000000-0000-4000-8000-000000000604',
  pumpBearing: '00000000-0000-4000-8000-000000000701',
  motorBearing: '00000000-0000-4000-8000-000000000702',
  compressorFilter: '00000000-0000-4000-8000-000000000703',
  bearingMaterial: '00000000-0000-4000-8000-000000000711',
  lubricantMaterial: '00000000-0000-4000-8000-000000000712',
  filterMaterial: '00000000-0000-4000-8000-000000000713',
  pumpTemperature: '00000000-0000-4000-8000-000000000801',
  motorVibration: '00000000-0000-4000-8000-000000000802',
  compressorPressure: '00000000-0000-4000-8000-000000000803',
  conveyorGuard: '00000000-0000-4000-8000-000000000804',
  pumpTemperaturePolicy: '00000000-0000-4000-8000-000000000901',
  motorVibrationPolicy: '00000000-0000-4000-8000-000000000902',
  compressorPressurePolicy: '00000000-0000-4000-8000-000000000903',
  pumpChecklist: '00000000-0000-4000-8000-000000001001',
  pumpChecklistVersion: '00000000-0000-4000-8000-000000001002',
  periodicPlan: '00000000-0000-4000-8000-000000001101',
  periodicPlanVersion: '00000000-0000-4000-8000-000000001102',
  occurrencePlan: '00000000-0000-4000-8000-000000001103',
  occurrencePlanVersion: '00000000-0000-4000-8000-000000001104',
  readyWorkOrder: '00000000-0000-4000-8000-000000001201',
  readyDemand: '00000000-0000-4000-8000-000000001202',
  readyQualityRequirement: '00000000-0000-4000-8000-000000001203',
  readySafetyRequirement: '00000000-0000-4000-8000-000000001204',
  readyQualitySignature: '00000000-0000-4000-8000-000000001205',
  readySafetySignature: '00000000-0000-4000-8000-000000001206',
  readyAction: '00000000-0000-4000-8000-000000001207',
  reviewWorkOrder: '00000000-0000-4000-8000-000000001211',
  reviewDemand: '00000000-0000-4000-8000-000000001212',
  reviewQualityRequirement: '00000000-0000-4000-8000-000000001213',
  reviewSafetyRequirement: '00000000-0000-4000-8000-000000001214',
} as const;

function requiredPassword(name: string): string {
  const password = process.env[name];
  if (!password || password.length < 12) {
    throw new Error(`${name} deve conter pelo menos 12 caracteres.`);
  }
  return password;
}

function hashPolicy(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function setContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `
      SELECT
        set_config('app.tenant_id', $1, true),
        set_config('app.user_id', $2, true)
    `,
    [tenantId, ids.admin],
  );
}

async function seedIdentities(
  client: PoolClient,
  tenantId: string,
  passwords: Readonly<Record<'admin' | 'quality' | 'safety' | 'maintenance' | 'operator', string>>,
  passwordService: PasswordService,
): Promise<void> {
  const users = [
    [ids.admin, 'USR-ADMIN-DEMO', 'Administrador de Homologação', 'admin.demo@fabcontrol.local'],
    [ids.quality, 'USR-QUAL-DEMO', 'Especialista de Qualidade', 'qualidade.demo@fabcontrol.local'],
    [ids.safety, 'USR-SEG-DEMO', 'Especialista de Segurança', 'seguranca.demo@fabcontrol.local'],
    [ids.maintenance, 'USR-MAN-DEMO', 'Técnico de Manutenção', 'manutencao.demo@fabcontrol.local'],
    [ids.operator, 'USR-OPE-DEMO', 'Operador de Homologação', 'operador.demo@fabcontrol.local'],
  ] as const;
  const roles = [
    [ids.adminRole, 'ADMIN', 'Administrador', 'ADMIN'],
    [ids.managerRole, 'GESTOR_TECNICO', 'Gestor técnico', 'MANAGER'],
    [ids.operatorRole, 'OPERADOR', 'Operador', 'OPERATOR'],
  ] as const;

  for (const [id, code, name, roleType] of roles) {
    await client.query(
      `
        INSERT INTO iam.roles (
          id, tenant_id, code, name, description, role_type, protected
        )
        VALUES ($1, $2, $3, $4, $4 || ' de homologação.', $5, true)
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, status = 'ACTIVE'
      `,
      [id, tenantId, code, name, roleType],
    );
  }

  for (const [id, employeeNumber, name, email] of users) {
    await client.query(
      `
        INSERT INTO iam.users (
          id, tenant_id, employee_number, name, email, first_access_required, metadata
        )
        VALUES ($1, $2, $3, $4, $5, false, '{"demo":true}'::jsonb)
        ON CONFLICT (tenant_id, employee_number) DO UPDATE
        SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          status = 'ACTIVE',
          first_access_required = false,
          metadata = EXCLUDED.metadata
      `,
      [id, tenantId, employeeNumber, name, email],
    );
  }

  const roleAssignments = [
    [ids.admin, ids.adminRole],
    [ids.quality, ids.managerRole],
    [ids.safety, ids.managerRole],
    [ids.maintenance, ids.managerRole],
    [ids.operator, ids.operatorRole],
  ] as const;
  for (const [userId, roleId] of roleAssignments) {
    await client.query(
      `
        INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
      `,
      [tenantId, userId, roleId],
    );
  }

  await client.query(
    `
      INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
      SELECT $1, $2, capability.id, 'ALLOW'
      FROM iam.capabilities capability
      WHERE capability.status = 'ACTIVE'
      ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
    `,
    [tenantId, ids.adminRole],
  );

  for (const capabilityCode of [
    'cmms.structure.read',
    'cmms.assets.read',
    'cmms.parameters.read',
    'cmms.materials.read',
    'cmms.readings.create',
    'maintenance.checklists.read',
    'maintenance.plans.read',
    'maintenance.work-orders.read',
    'maintenance.executions.read',
  ]) {
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.managerRole, capabilityCode],
    );
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.operatorRole, capabilityCode],
    );
  }

  await client.query(
    `
      INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
      SELECT $1, $2, capability.id, 'ALLOW'
      FROM iam.capabilities capability
      WHERE capability.code = 'maintenance.checklists.review'
      ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
    `,
    [tenantId, ids.managerRole],
  );

  for (const capabilityCode of ['maintenance.work-orders.review']) {
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.managerRole, capabilityCode],
    );
  }

  for (const capabilityCode of [
    'maintenance.occurrences.read',
    'maintenance.occurrences.report',
    'maintenance.occurrences.triage',
    'maintenance.stops.read',
    'maintenance.stops.manage',
    'maintenance.alerts.read',
    'maintenance.alerts.manage',
    'workflow.notifications.read',
    'analytics.technical.read',
  ]) {
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.managerRole, capabilityCode],
    );
  }

  for (const capabilityCode of ['maintenance.executions.read', 'maintenance.executions.perform']) {
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.operatorRole, capabilityCode],
    );
  }

  for (const capabilityCode of [
    'maintenance.occurrences.read',
    'maintenance.occurrences.report',
    'maintenance.stops.read',
    'workflow.notifications.read',
  ]) {
    await client.query(
      `
        INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = $3
        ON CONFLICT (tenant_id, role_id, capability_id) DO UPDATE SET effect = 'ALLOW'
      `,
      [tenantId, ids.operatorRole, capabilityCode],
    );
  }

  const userPasswords = [
    [ids.admin, passwords.admin],
    [ids.quality, passwords.quality],
    [ids.safety, passwords.safety],
    [ids.maintenance, passwords.maintenance],
    [ids.operator, passwords.operator],
  ] as const;
  for (const [userId, password] of userPasswords) {
    const passwordHash = await passwordService.hash(password);
    await client.query(
      `
        INSERT INTO iam.credentials (
          tenant_id, user_id, credential_type, algorithm, password_hash
        )
        VALUES ($1, $2, 'PASSWORD', 'ARGON2ID', $3)
        ON CONFLICT (tenant_id, user_id, credential_type) DO UPDATE
        SET
          algorithm = 'ARGON2ID',
          password_hash = EXCLUDED.password_hash,
          revoked_at = NULL,
          legacy_hash = NULL,
          legacy_algorithm = NULL,
          legacy_migration_status = 'NOT_REQUIRED'
      `,
      [tenantId, userId, passwordHash],
    );
  }
}

async function seedTechnicalProfiles(client: PoolClient, tenantId: string): Promise<void> {
  const areas = [
    [ids.qualityArea, 'QUALITY', 'Qualidade', true, true],
    [ids.safetyArea, 'SAFETY', 'Segurança', true, true],
    [ids.maintenanceArea, 'MAINTENANCE', 'Manutenção', false, false],
  ] as const;
  for (const [id, code, name, signatureRequired, validationArea] of areas) {
    await client.query(
      `
        INSERT INTO iam.technical_areas (
          id, tenant_id, code, name, description, default_signature_required,
          validation_area, created_by
        )
        VALUES ($1, $2, $3, $4, $4 || ' de homologação.', $5, $6, $7)
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET
          name = EXCLUDED.name,
          default_signature_required = EXCLUDED.default_signature_required,
          validation_area = EXCLUDED.validation_area,
          status = 'ACTIVE'
      `,
      [id, tenantId, code, name, signatureRequired, validationArea, ids.admin],
    );
  }

  const roles = [
    [ids.qualityTechnicalRole, ids.qualityArea, 'QUALITY_INSPECTOR', 'Inspetor de Qualidade', true],
    [ids.safetyTechnicalRole, ids.safetyArea, 'SAFETY_TECHNICIAN', 'Técnico de Segurança', true],
    [
      ids.maintenanceTechnicalRole,
      ids.maintenanceArea,
      'MAINTENANCE_TECHNICIAN',
      'Técnico de Manutenção',
      false,
    ],
  ] as const;
  for (const [id, areaId, code, name, canSign] of roles) {
    await client.query(
      `
        INSERT INTO iam.technical_roles (
          id, tenant_id, technical_area_id, code, name, description, can_sign, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $5 || ' de homologação.', $6, $7)
        ON CONFLICT (tenant_id, technical_area_id, code) DO UPDATE
        SET name = EXCLUDED.name, can_sign = EXCLUDED.can_sign, status = 'ACTIVE'
      `,
      [id, tenantId, areaId, code, name, canSign, ids.admin],
    );
  }

  const assignments = [
    [ids.quality, ids.qualityArea, ids.qualityTechnicalRole],
    [ids.safety, ids.safetyArea, ids.safetyTechnicalRole],
    [ids.maintenance, ids.maintenanceArea, ids.maintenanceTechnicalRole],
  ] as const;
  for (const [userId, areaId, roleId] of assignments) {
    await client.query(
      `
        INSERT INTO iam.user_technical_assignments (
          tenant_id, user_id, technical_area_id, technical_role_id,
          is_primary, assigned_by
        )
        VALUES ($1, $2, $3, $4, true, $5)
        ON CONFLICT (tenant_id, user_id) WHERE is_primary AND status = 'ACTIVE'
        DO UPDATE SET
          technical_area_id = EXCLUDED.technical_area_id,
          technical_role_id = EXCLUDED.technical_role_id,
          assigned_by = EXCLUDED.assigned_by
      `,
      [tenantId, userId, areaId, roleId, ids.admin],
    );
  }
}

async function seedCatalog(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO cmms.plants (id, tenant_id, tag, name)
      VALUES ($1, $2, 'PLT-DEMO', 'Unidade Industrial de Homologação')
      ON CONFLICT (tenant_id, tag) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'
    `,
    [ids.plant, tenantId],
  );

  const sectors = [
    [ids.utilitiesSector, 'UTIL', 'Utilidades'],
    [ids.productionSector, 'PROD', 'Produção e Embalagem'],
  ] as const;
  for (const [id, tag, name] of sectors) {
    await client.query(
      `
        INSERT INTO cmms.sectors (id, tenant_id, plant_id, tag, name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, plant_id, tag) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'
      `,
      [id, tenantId, ids.plant, tag, name],
    );
  }

  const lines = [
    [ids.utilitiesLine, ids.utilitiesSector, 'LIN-UTIL', 'Linha de Utilidades'],
    [ids.packagingLine, ids.productionSector, 'LIN-EMB', 'Linha de Embalagem'],
  ] as const;
  for (const [id, sectorId, tag, name] of lines) {
    await client.query(
      `
        INSERT INTO cmms.lines (id, tenant_id, sector_id, tag, name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, sector_id, tag) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'
      `,
      [id, tenantId, sectorId, tag, name],
    );
  }

  const assets = [
    [
      ids.pump,
      ids.utilitiesLine,
      'EQ-BOM-001',
      'Bomba de Processo 01',
      'PUMP',
      'HIGH',
      'OPERATING',
      92,
      8462.5,
      'Casa de bombas / posição 01',
    ],
    [
      ids.motor,
      ids.packagingLine,
      'EQ-MOT-002',
      'Motor da Esteira Principal',
      'ELECTRIC_MOTOR',
      'CRITICAL',
      'STOPPED',
      38,
      5130.2,
      'Embalagem / esteira principal',
    ],
    [
      ids.compressor,
      ids.utilitiesLine,
      'EQ-CMP-003',
      'Compressor de Ar 03',
      'COMPRESSOR',
      'HIGH',
      'MAINTENANCE_PLANNED',
      68,
      12880.9,
      'Sala de compressores / posição 03',
    ],
    [
      ids.conveyor,
      ids.packagingLine,
      'EQ-EST-004',
      'Esteira de Inspeção Final',
      'CONVEYOR',
      'MEDIUM',
      'INSPECTION',
      81,
      2940.1,
      'Embalagem / inspeção final',
    ],
  ] as const;
  for (const [
    id,
    lineId,
    tag,
    name,
    type,
    criticality,
    operationalStatus,
    health,
    hourMeter,
    location,
  ] of assets) {
    await client.query(
      `
        INSERT INTO cmms.assets (
          id, tenant_id, line_id, tag, qr_payload, name, asset_type, criticality,
          operational_status, health_percent, current_hour_meter, hour_meter_mode,
          hour_meter_updated_at, manufacturer, model, serial_number,
          technical_location, metadata
        )
        VALUES (
          $1::uuid, $2, $3, $4, 'fabcontrol://asset/' || $1::text, $5, $6, $7,
          $8, $9, $10, 'RUNNING_HOURS', clock_timestamp(), 'Fab Demo',
          'Série Industrial', 'DEMO-' || right($1::text, 8), $11,
          '{"demo":true,"data_quality":"controlled"}'::jsonb
        )
        ON CONFLICT (tenant_id, tag) DO UPDATE SET
          name = EXCLUDED.name,
          operational_status = EXCLUDED.operational_status,
          health_percent = EXCLUDED.health_percent,
          current_hour_meter = EXCLUDED.current_hour_meter,
          technical_location = EXCLUDED.technical_location,
          lifecycle_status = 'ACTIVE'
      `,
      [
        id,
        tenantId,
        lineId,
        tag,
        name,
        type,
        criticality,
        operationalStatus,
        health,
        hourMeter,
        location,
      ],
    );
  }

  const components = [
    [
      ids.pumpBearing,
      ids.pump,
      'CMP-ROL-BOM-001',
      'Rolamento lado acoplado',
      'BEARING',
      'HIGH',
      'OPERATING',
    ],
    [
      ids.motorBearing,
      ids.motor,
      'CMP-ROL-MOT-002',
      'Rolamento dianteiro do motor',
      'BEARING',
      'CRITICAL',
      'STOPPED',
    ],
    [
      ids.compressorFilter,
      ids.compressor,
      'CMP-FIL-CMP-003',
      'Filtro de admissão',
      'FILTER',
      'MEDIUM',
      'MAINTENANCE_PLANNED',
    ],
  ] as const;
  for (const [id, assetId, tag, name, type, criticality, operationalStatus] of components) {
    await client.query(
      `
        INSERT INTO cmms.components (
          id, tenant_id, asset_id, tag, qr_payload, name, component_type,
          criticality, operational_status, useful_life_hours, accumulated_hours,
          installed_at, manufacturer, model, technical_location, metadata
        )
        VALUES (
          $1::uuid, $2, $3, $4, 'fabcontrol://component/' || $1::text, $5, $6,
          $7, $8, 12000, 3200, clock_timestamp() - interval '18 months',
          'Fab Demo', 'Componente controlado', $5,
          '{"demo":true,"spare_part_controlled":true}'::jsonb
        )
        ON CONFLICT (tenant_id, tag) DO UPDATE SET
          name = EXCLUDED.name,
          operational_status = EXCLUDED.operational_status,
          lifecycle_status = 'ACTIVE'
      `,
      [id, tenantId, assetId, tag, name, type, criticality, operationalStatus],
    );
  }
}

async function seedMaterials(client: PoolClient, tenantId: string): Promise<void> {
  const materials = [
    [ids.bearingMaterial, 'ROL-6205-2RS', 'Rolamento blindado 6205 2RS', 'UN', 2, 4],
    [ids.lubricantMaterial, 'LUB-EP2-20KG', 'Graxa industrial EP2', 'KG', 18.5, 10],
    [ids.filterMaterial, 'FLT-CMP-001', 'Elemento filtrante do compressor', 'UN', 1, 3],
  ] as const;

  for (const [id, sku, name, unit, currentStock, minimumStock] of materials) {
    await client.query(
      `
        INSERT INTO cmms.materials (
          id, tenant_id, sku, name, unit, current_stock, minimum_stock, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
        ON CONFLICT (tenant_id, sku) DO UPDATE SET
          name = EXCLUDED.name,
          unit = EXCLUDED.unit,
          current_stock = EXCLUDED.current_stock,
          minimum_stock = EXCLUDED.minimum_stock,
          status = 'ACTIVE'
      `,
      [id, tenantId, sku, name, unit, currentStock, minimumStock],
    );
  }
}

async function seedParameters(client: PoolClient, tenantId: string): Promise<void> {
  const definitions = [
    [
      ids.pumpTemperature,
      ids.pump,
      ids.pumpBearing,
      'BEARING_TEMPERATURE',
      'Temperatura do rolamento',
      '°C',
      'SENSOR',
    ],
    [
      ids.motorVibration,
      ids.motor,
      ids.motorBearing,
      'BEARING_VIBRATION',
      'Vibração do rolamento',
      'mm/s',
      'MANUAL',
    ],
    [
      ids.compressorPressure,
      ids.compressor,
      null,
      'DISCHARGE_PRESSURE',
      'Pressão de descarga',
      'bar',
      'SENSOR',
    ],
    [
      ids.conveyorGuard,
      ids.conveyor,
      null,
      'SAFETY_GUARD_OK',
      'Proteção física instalada',
      'boolean',
      'CHECKLIST',
    ],
  ] as const;
  for (const [id, assetId, componentId, code, name, unit, sourceType] of definitions) {
    await client.query(
      `
        INSERT INTO cmms.parameter_definitions (
          id, tenant_id, asset_id, component_id, code, name, unit,
          value_type, source_type, description, metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          CASE WHEN $7 = 'boolean' THEN 'BOOLEAN' ELSE 'DECIMAL' END,
          $8, 'Parâmetro de homologação com origem e limites controlados.',
          '{"demo":true}'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          asset_id = EXCLUDED.asset_id,
          component_id = EXCLUDED.component_id,
          code = EXCLUDED.code,
          name = EXCLUDED.name,
          unit = EXCLUDED.unit,
          status = 'ACTIVE'
      `,
      [id, tenantId, assetId, componentId, code, name, unit, sourceType],
    );
  }

  const policies = [
    [ids.pumpTemperaturePolicy, ids.pumpTemperature, 45, 75, 30, 90],
    [ids.motorVibrationPolicy, ids.motorVibration, 1.5, 4.5, 0.5, 7.1],
    [ids.compressorPressurePolicy, ids.compressorPressure, 6.5, 8.5, 5.5, 9.5],
  ] as const;
  for (const [id, parameterId, warningMin, warningMax, criticalMin, criticalMax] of policies) {
    const hash = hashPolicy({ parameterId, warningMin, warningMax, criticalMin, criticalMax });
    await client.query(
      `
        INSERT INTO cmms.parameter_policies (
          id, tenant_id, parameter_definition_id, version, warning_min, warning_max,
          critical_min, critical_max, validation_rule, effective_from, status,
          content_hash_sha256, created_by, approved_by, approved_at
        )
        VALUES (
          $1, $2, $3, 1, $4, $5, $6, $7,
          '{"demo":true,"requires_review_when_abnormal":true}'::jsonb,
          clock_timestamp() - interval '90 days', 'ACTIVE', $8, $9, $9,
          clock_timestamp() - interval '90 days'
        )
        ON CONFLICT (tenant_id, parameter_definition_id, version) DO UPDATE SET
          warning_min = EXCLUDED.warning_min,
          warning_max = EXCLUDED.warning_max,
          critical_min = EXCLUDED.critical_min,
          critical_max = EXCLUDED.critical_max,
          content_hash_sha256 = EXCLUDED.content_hash_sha256
      `,
      [
        id,
        tenantId,
        parameterId,
        warningMin,
        warningMax,
        criticalMin,
        criticalMax,
        hash,
        ids.admin,
      ],
    );
  }

  const readings = [
    [ids.pumpTemperature, ids.pumpTemperaturePolicy, 58.4, 'demo:pump-temp:normal', '2 hours'],
    [ids.pumpTemperature, ids.pumpTemperaturePolicy, 78.2, 'demo:pump-temp:warning', '1 hour'],
    [
      ids.motorVibration,
      ids.motorVibrationPolicy,
      8.3,
      'demo:motor-vibration:critical',
      '30 minutes',
    ],
    [
      ids.compressorPressure,
      ids.compressorPressurePolicy,
      7.4,
      'demo:pressure:normal',
      '15 minutes',
    ],
  ] as const;
  for (const [parameterId, policyId, value, idempotencyKey, age] of readings) {
    await client.query(
      `
        INSERT INTO cmms.parameter_readings (
          tenant_id, parameter_definition_id, parameter_policy_id, numeric_value,
          unit, source, recorded_by, recorded_at, raw_value, idempotency_key, metadata
        )
        SELECT
          $1, definition.id, $3, $4::numeric, definition.unit, 'MANUAL', $5,
          clock_timestamp() - $6::interval, $4::text, $7, '{"demo":true}'::jsonb
        FROM cmms.parameter_definitions definition
        WHERE definition.id = $2
        ON CONFLICT (tenant_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
      `,
      [tenantId, parameterId, policyId, value, ids.maintenance, age, idempotencyKey],
    );
  }

  await client.query(
    `
      INSERT INTO cmms.parameter_readings (
        tenant_id, parameter_definition_id, boolean_value, unit, source,
        recorded_by, recorded_at, raw_value, idempotency_key, metadata
      )
      VALUES (
        $1, $2, true, 'boolean', 'CHECKLIST', $3,
        clock_timestamp() - interval '10 minutes', 'true',
        'demo:conveyor-guard:normal', '{"demo":true}'::jsonb
      )
      ON CONFLICT (tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      DO NOTHING
    `,
    [tenantId, ids.conveyorGuard, ids.operator],
  );

  await client.query(
    `
      INSERT INTO maintenance.operational_alerts (
        tenant_id, asset_id, component_id, parameter_reading_id, alert_type,
        severity, title, message, deduplication_key, first_detected_at,
        last_detected_at, metadata
      )
      SELECT
        $1, $2, $3, reading.id, 'PARAMETER_OUT_OF_RANGE', 'CRITICAL',
        'Vibração crítica no motor',
        'A vibração ultrapassou o limite crítico e exige análise técnica.',
        'demo:critical-motor-vibration', reading.recorded_at, reading.recorded_at,
        '{"demo":true,"scenario":"critical_parameter"}'::jsonb
      FROM cmms.parameter_readings reading
      WHERE reading.idempotency_key = 'demo:motor-vibration:critical'
      ON CONFLICT (tenant_id, deduplication_key)
        WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'IN_TREATMENT')
      DO UPDATE SET
        parameter_reading_id = EXCLUDED.parameter_reading_id,
        last_detected_at = EXCLUDED.last_detected_at,
        status = 'OPEN'
    `,
    [tenantId, ids.motor, ids.motorBearing],
  );
}

async function seedChecklistsAndPlans(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO maintenance.checklist_templates (
        id, tenant_id, code, name, asset_id, component_id, checklist_type,
        criticality, created_by
      )
      VALUES (
        $1, $2, 'CHK-BOM-001', 'Inspeção completa da bomba de processo', $3, $4,
        'PREVENTIVE', 'HIGH', $5
      )
      ON CONFLICT (tenant_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        lifecycle_status = 'ACTIVE'
    `,
    [ids.pumpChecklist, tenantId, ids.pump, ids.pumpBearing, ids.admin],
  );

  const checklistHash = hashPolicy({
    code: 'CHK-BOM-001',
    revision: 1,
    responseTypes: [
      'INSTRUCAO',
      'CONFIRMACAO',
      'OK_NOK',
      'NUMERO',
      'PARAMETRO',
      'TEXTO',
      'SELECAO',
      'EVIDENCIA',
      'LEITURA_OPERACIONAL',
    ],
  });
  await client.query(
    `
      INSERT INTO maintenance.checklist_template_versions (
        id, tenant_id, checklist_template_id, revision, status, technical_area_id,
        signature_policy, required_signatures, segregation_required, manager_guidance,
        safety_requirements, content_hash_sha256, created_by
      )
      VALUES (
        $1, $2, $3, 1, 'DRAFT', $4, 'QUALIDADE_E_SEGURANCA', 2, true,
        'Confirmar integridade mecânica, condição segura e evidências antes da liberação.',
        '["Aplicar bloqueio e etiquetagem antes da inspeção","Confirmar ausência de energia residual"]'::jsonb,
        $5, $6
      )
      ON CONFLICT (tenant_id, checklist_template_id, revision) DO NOTHING
    `,
    [
      ids.pumpChecklistVersion,
      tenantId,
      ids.pumpChecklist,
      ids.qualityArea,
      checklistHash,
      ids.admin,
    ],
  );

  const items = [
    {
      title: 'Ler as instruções de segurança',
      instruction: 'Aplicar LOTO e confirmar condição segura antes de tocar no conjunto.',
      type: 'INSTRUCAO',
      category: 'SEGURANCA',
      required: false,
      evidence: false,
      minimumPhotos: 0,
      blocks: false,
      parameterId: null,
      expected: null,
      minimum: null,
      maximum: null,
      unit: null,
      options: [],
    },
    {
      title: 'Confirmar bloqueio de energia',
      instruction: 'Confirme somente após testar a ausência de energia residual.',
      type: 'CONFIRMACAO',
      category: 'SEGURANCA',
      required: true,
      evidence: false,
      minimumPhotos: 0,
      blocks: true,
      parameterId: null,
      expected: 'CONFIRMADO',
      minimum: null,
      maximum: null,
      unit: null,
      options: [],
    },
    {
      title: 'Inspecionar condição do rolamento',
      instruction: 'Avalie folga, ruído, vedação e sinais de superaquecimento.',
      type: 'OK_NOK',
      category: 'MECANICA',
      required: true,
      evidence: true,
      minimumPhotos: 1,
      blocks: true,
      parameterId: null,
      expected: 'OK',
      minimum: null,
      maximum: null,
      unit: null,
      options: [],
    },
    {
      title: 'Registrar quantidade de reapertos',
      instruction: 'Informe quantos pontos precisaram de reaperto.',
      type: 'NUMERO',
      category: 'MECANICA',
      required: true,
      evidence: false,
      minimumPhotos: 0,
      blocks: false,
      parameterId: null,
      expected: null,
      minimum: 0,
      maximum: 12,
      unit: 'pontos',
      options: [],
    },
    {
      title: 'Medir temperatura do rolamento',
      instruction: 'Registre a temperatura estabilizada em operação.',
      type: 'PARAMETRO',
      category: 'CONDICAO',
      required: true,
      evidence: true,
      minimumPhotos: 1,
      blocks: true,
      parameterId: ids.pumpTemperature,
      expected: null,
      minimum: 30,
      maximum: 90,
      unit: '°C',
      options: [],
    },
    {
      title: 'Descrever observações da inspeção',
      instruction: 'Registre achados relevantes ou informe que não houve desvios.',
      type: 'TEXTO',
      category: 'RELATORIO',
      required: true,
      evidence: false,
      minimumPhotos: 0,
      blocks: false,
      parameterId: null,
      expected: null,
      minimum: null,
      maximum: null,
      unit: null,
      options: [],
    },
    {
      title: 'Classificar condição final',
      instruction: 'Selecione a condição observada ao final da atividade.',
      type: 'SELECAO',
      category: 'DECISAO',
      required: true,
      evidence: false,
      minimumPhotos: 0,
      blocks: true,
      parameterId: null,
      expected: 'APTO',
      minimum: null,
      maximum: null,
      unit: null,
      options: ['APTO', 'APTO_COM_RESTRICAO', 'NAO_APTO'],
    },
    {
      title: 'Registrar evidência da condição final',
      instruction: 'Fotografe o conjunto montado e a identificação do equipamento.',
      type: 'EVIDENCIA',
      category: 'EVIDENCIA',
      required: true,
      evidence: true,
      minimumPhotos: 2,
      blocks: true,
      parameterId: null,
      expected: null,
      minimum: null,
      maximum: null,
      unit: null,
      options: [],
    },
    {
      title: 'Confirmar leitura operacional final',
      instruction: 'Faça a leitura final após o retorno seguro à operação.',
      type: 'LEITURA_OPERACIONAL',
      category: 'OPERACAO',
      required: true,
      evidence: false,
      minimumPhotos: 0,
      blocks: true,
      parameterId: ids.pumpTemperature,
      expected: null,
      minimum: 30,
      maximum: 90,
      unit: '°C',
      options: [],
    },
  ] as const;

  for (const [index, item] of items.entries()) {
    await client.query(
      `
        INSERT INTO maintenance.checklist_items (
          tenant_id, checklist_template_version_id, sequence, title, instruction,
          response_type_code, category, required, evidence_required,
          minimum_evidence_photos, blocks_completion, parameter_definition_id,
          expected_value, minimum_value, maximum_value, unit, options, weight
        )
        SELECT
          $1, version.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17::jsonb, 1
        FROM maintenance.checklist_template_versions version
        WHERE version.id = $2
          AND version.status = 'DRAFT'
        ON CONFLICT (tenant_id, checklist_template_version_id, sequence) DO NOTHING
      `,
      [
        tenantId,
        ids.pumpChecklistVersion,
        index + 1,
        item.title,
        item.instruction,
        item.type,
        item.category,
        item.required,
        item.evidence,
        item.minimumPhotos,
        item.blocks,
        item.parameterId,
        item.expected,
        item.minimum,
        item.maximum,
        item.unit,
        JSON.stringify(item.options),
      ],
    );
  }

  await client.query(
    `
      UPDATE maintenance.checklist_template_versions
      SET status = 'IN_REVIEW', submitted_at = clock_timestamp(), content_hash_sha256 = $2
      WHERE id = $1 AND status = 'DRAFT'
    `,
    [ids.pumpChecklistVersion, checklistHash],
  );

  const reviews = [
    [ids.quality, 'GESTOR_TECNICO:QUALITY:QUALITY_INSPECTOR'],
    [ids.safety, 'GESTOR_TECNICO:SAFETY:SAFETY_TECHNICIAN'],
  ] as const;
  for (const [reviewerId, roleSnapshot] of reviews) {
    await client.query(
      `
        INSERT INTO maintenance.checklist_model_reviews (
          tenant_id, checklist_template_version_id, decision, justification,
          reviewer_id, reviewer_role_snapshot, payload_hash_sha256
        )
        SELECT
          $1, version.id, 'APPROVED',
          'Modelo demonstrativo aprovado para homologação integral.', $3, $4, $5
        FROM maintenance.checklist_template_versions version
        WHERE version.id = $2 AND version.status = 'IN_REVIEW'
        ON CONFLICT (tenant_id, checklist_template_version_id, reviewer_id) DO NOTHING
      `,
      [tenantId, ids.pumpChecklistVersion, reviewerId, roleSnapshot, checklistHash],
    );
  }

  await client.query(
    `
      UPDATE maintenance.checklist_template_versions
      SET status = 'APPROVED'
      WHERE id = $1 AND status = 'IN_REVIEW'
    `,
    [ids.pumpChecklistVersion],
  );
  await client.query(
    `
      UPDATE maintenance.checklist_template_versions
      SET status = 'PUBLISHED', published_at = clock_timestamp()
      WHERE id = $1 AND status = 'APPROVED'
    `,
    [ids.pumpChecklistVersion],
  );

  const plans = [
    {
      id: ids.periodicPlan,
      versionId: ids.periodicPlanVersion,
      code: 'PLN-BOM-30D',
      name: 'Preventiva mensal da bomba de processo',
      planType: 'PREVENTIVE',
      criticality: 'HIGH',
      triggerType: 'PERIODICITY',
      triggerValue: null,
      triggerUnit: 'DAYS',
      recurrenceDays: 30,
      duration: 90,
      stopMode: 'MANDATORY_STOP',
      analysis: {
        objetivo: 'Prevenir falha do rolamento e perda de disponibilidade.',
        origem: 'Massa controlada de homologação',
      },
    },
    {
      id: ids.occurrencePlan,
      versionId: ids.occurrencePlanVersion,
      code: 'PLN-BOM-OCO',
      name: 'Inspeção não programada após ocorrência',
      planType: 'CORRECTIVE',
      criticality: 'CRITICAL',
      triggerType: 'OCCURRENCE',
      triggerValue: null,
      triggerUnit: null,
      recurrenceDays: null,
      duration: 45,
      stopMode: 'EXECUTOR_DECISION',
      analysis: {
        objetivo: 'Diagnosticar ocorrência antes da liberação operacional.',
        origem: 'Ocorrência ou alerta crítico',
      },
    },
  ] as const;

  for (const plan of plans) {
    await client.query(
      `
        INSERT INTO maintenance.maintenance_plans (
          id, tenant_id, code, name, asset_id, component_id, plan_type, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          lifecycle_status = 'ACTIVE'
      `,
      [
        plan.id,
        tenantId,
        plan.code,
        plan.name,
        ids.pump,
        ids.pumpBearing,
        plan.planType,
        ids.admin,
      ],
    );
    const planHash = hashPolicy(plan.analysis);
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
          true, true, 1, $11, $12::jsonb, $13, $14, $15
        )
        ON CONFLICT (tenant_id, maintenance_plan_id, revision) DO NOTHING
      `,
      [
        plan.versionId,
        tenantId,
        plan.id,
        ids.pumpChecklistVersion,
        plan.criticality,
        plan.triggerType,
        plan.triggerValue,
        plan.triggerUnit,
        plan.recurrenceDays,
        plan.duration,
        plan.stopMode,
        JSON.stringify(plan.analysis),
        ids.maintenanceArea,
        planHash,
        ids.admin,
      ],
    );
    await client.query(
      `
        UPDATE maintenance.maintenance_plan_versions
        SET status = 'PUBLISHED', submitted_at = clock_timestamp(), published_at = clock_timestamp()
        WHERE id = $1 AND status = 'DRAFT'
      `,
      [plan.versionId],
    );
  }
}

async function seedOperationalScenarios(client: PoolClient, tenantId: string): Promise<void> {
  const readyHash = hashPolicy({
    code: 'OS-HML-READY-001',
    planVersionId: ids.periodicPlanVersion,
    checklistVersionId: ids.pumpChecklistVersion,
    title: 'Inspeção preventiva liberada para execução',
    revision: 1,
  });
  const reviewHash = hashPolicy({
    code: 'OS-HML-REVIEW-001',
    planVersionId: ids.occurrencePlanVersion,
    checklistVersionId: ids.pumpChecklistVersion,
    title: 'Diagnóstico após alerta de temperatura',
    revision: 1,
  });

  const workOrders = [
    {
      id: ids.readyWorkOrder,
      demandId: ids.readyDemand,
      code: 'OS-HML-READY-001',
      planVersionId: ids.periodicPlanVersion,
      workType: 'PREVENTIVE',
      title: 'Inspeção preventiva liberada para execução',
      description: 'Cenário homologável com checklist completo e validações permanentes.',
      priority: 'HIGH',
      stopMode: 'MANDATORY_STOP',
      hash: readyHash,
    },
    {
      id: ids.reviewWorkOrder,
      demandId: ids.reviewDemand,
      code: 'OS-HML-REVIEW-001',
      planVersionId: ids.occurrencePlanVersion,
      workType: 'CORRECTIVE',
      title: 'Diagnóstico após alerta de temperatura',
      description: 'Cenário pendente para testar a validação de Qualidade e Segurança.',
      priority: 'CRITICAL',
      stopMode: 'EXECUTOR_DECISION',
      hash: reviewHash,
    },
  ] as const;

  for (const workOrder of workOrders) {
    await client.query(
      `
        INSERT INTO maintenance.work_orders (
          id, tenant_id, code, asset_id, component_id, maintenance_plan_version_id,
          origin_type, work_type, title, description, priority, status, requester_id,
          maintenance_stop_mode, technical_analysis, scheduled_for
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'HOMOLOGATION', $7, $8, $9, $10, 'DRAFT', $11,
          $12, $13::jsonb, clock_timestamp() + interval '1 day'
        )
        ON CONFLICT (tenant_id, code) DO NOTHING
      `,
      [
        workOrder.id,
        tenantId,
        workOrder.code,
        ids.pump,
        ids.pumpBearing,
        workOrder.planVersionId,
        workOrder.workType,
        workOrder.title,
        workOrder.description,
        workOrder.priority,
        ids.admin,
        workOrder.stopMode,
        JSON.stringify({
          objetivo: workOrder.description,
          checklistTemplateVersionId: ids.pumpChecklistVersion,
          homologation: true,
        }),
      ],
    );

    await client.query(
      `
        INSERT INTO workflow.technical_demands (
          id, tenant_id, demand_type, entity_type, entity_id, origin_type,
          title, description, priority, status, current_area_id,
          current_technical_role_id, current_responsible_id, created_by,
          creator_role_snapshot, signature_required, required_signature_count,
          segregation_required, signature_policy, entity_version, payload_hash_sha256
        )
        VALUES (
          $1, $2, 'WORK_ORDER_VALIDATION', 'WORK_ORDER', $3, 'ADMIN',
          $4, $5, $6, 'AWAITING_SIGNATURE', $7, $8, $9, $10,
          'ADMIN:ADMIN', true, 2, true, 'QUALIDADE_E_SEGURANCA', 1, $11
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        workOrder.demandId,
        tenantId,
        workOrder.id,
        workOrder.title,
        workOrder.description,
        workOrder.priority,
        ids.qualityArea,
        ids.qualityTechnicalRole,
        ids.quality,
        ids.admin,
        workOrder.hash,
      ],
    );

    await client.query(
      `
        UPDATE maintenance.work_orders
        SET technical_demand_id = $2,
            content_hash_sha256 = $3,
            submitted_at = COALESCE(submitted_at, clock_timestamp()),
            status = 'IN_TECHNICAL_REVIEW'
        WHERE tenant_id = $1
          AND id = $4
          AND status = 'DRAFT'
      `,
      [tenantId, workOrder.demandId, workOrder.hash, workOrder.id],
    );
  }

  const requirements = [
    [ids.readyQualityRequirement, ids.readyDemand, 'QUALITY_SIGNATURE', ids.qualityArea],
    [ids.readySafetyRequirement, ids.readyDemand, 'SAFETY_SIGNATURE', ids.safetyArea],
    [ids.reviewQualityRequirement, ids.reviewDemand, 'QUALITY_SIGNATURE', ids.qualityArea],
    [ids.reviewSafetyRequirement, ids.reviewDemand, 'SAFETY_SIGNATURE', ids.safetyArea],
  ] as const;
  for (const [id, demandId, code, areaId] of requirements) {
    await client.query(
      `
        INSERT INTO workflow.demand_validator_requirements (
          id, tenant_id, technical_demand_id, requirement_code, technical_area_id,
          required_count, status
        )
        VALUES ($1, $2, $3, $4, $5, 1, 'PENDING')
        ON CONFLICT (tenant_id, technical_demand_id, requirement_code) DO NOTHING
      `,
      [id, tenantId, demandId, code, areaId],
    );
  }

  const signatures = [
    {
      id: ids.readyQualitySignature,
      requirementId: ids.readyQualityRequirement,
      userId: ids.quality,
      areaId: ids.qualityArea,
      roleId: ids.qualityTechnicalRole,
      roleSnapshot: 'GESTOR_TECNICO:QUALITY:QUALITY_INSPECTOR',
      declaration: 'Conteúdo e requisitos da Qualidade aprovados para homologação.',
    },
    {
      id: ids.readySafetySignature,
      requirementId: ids.readySafetyRequirement,
      userId: ids.safety,
      areaId: ids.safetyArea,
      roleId: ids.safetyTechnicalRole,
      roleSnapshot: 'GESTOR_TECNICO:SAFETY:SAFETY_TECHNICIAN',
      declaration: 'Riscos, bloqueio e requisitos de Segurança aprovados para homologação.',
    },
  ] as const;
  for (const signature of signatures) {
    await client.query(
      `
        INSERT INTO workflow.technical_signatures (
          id, tenant_id, technical_demand_id, validator_requirement_id,
          entity_type, entity_id, entity_version, user_id, role_snapshot,
          technical_area_id, technical_role_id, meaning, declaration,
          payload_hash_sha256, signature_hash_sha256
        )
        SELECT
          $1, $2, $3, $4, 'WORK_ORDER', $5, 1, $6, $7,
          $8, $9, 'APPROVAL', $10, $11, $12
        WHERE NOT EXISTS (
          SELECT 1
          FROM workflow.technical_signatures existing
          WHERE existing.tenant_id = $2 AND existing.id = $1
        )
      `,
      [
        signature.id,
        tenantId,
        ids.readyDemand,
        signature.requirementId,
        ids.readyWorkOrder,
        signature.userId,
        signature.roleSnapshot,
        signature.areaId,
        signature.roleId,
        signature.declaration,
        readyHash,
        hashPolicy({ signatureId: signature.id, demandId: ids.readyDemand, payload: readyHash }),
      ],
    );
  }

  await client.query(
    `
      UPDATE workflow.technical_demands
      SET status = 'TECHNICALLY_APPROVED',
          completed_at = COALESCE(completed_at, clock_timestamp())
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'AWAITING_SIGNATURE'
        AND completed_signature_count = required_signature_count
    `,
    [tenantId, ids.readyDemand],
  );
  await client.query(
    `
      UPDATE maintenance.work_orders work_order
      SET status = 'APPROVED'
      FROM workflow.technical_demands demand
      WHERE work_order.tenant_id = $1
        AND work_order.id = $2
        AND work_order.status = 'IN_TECHNICAL_REVIEW'
        AND demand.tenant_id = work_order.tenant_id
        AND demand.id = work_order.technical_demand_id
        AND demand.status = 'TECHNICALLY_APPROVED'
    `,
    [tenantId, ids.readyWorkOrder],
  );
  await client.query(
    `
      UPDATE maintenance.work_orders
      SET status = 'RELEASED',
          released_at = COALESCE(released_at, clock_timestamp()),
          opened_at = COALESCE(opened_at, clock_timestamp())
      WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED'
    `,
    [tenantId, ids.readyWorkOrder],
  );
  await client.query(
    `
      UPDATE workflow.technical_demands
      SET status = 'RELEASED_TO_OPERATION'
      WHERE tenant_id = $1 AND id = $2 AND status = 'TECHNICALLY_APPROVED'
    `,
    [tenantId, ids.readyDemand],
  );
  await client.query(
    `
      INSERT INTO maintenance.work_order_actions (
        id, tenant_id, work_order_id, asset_id, component_id,
        maintenance_plan_version_id, origin, action_type, title, description,
        priority, status, maintenance_stop_mode, technical_analysis
      )
      SELECT
        $1, work_order.tenant_id, work_order.id, work_order.asset_id,
        work_order.component_id, work_order.maintenance_plan_version_id,
        'WORK_ORDER_RELEASE', 'EXECUTE_CHECKLIST', work_order.title,
        work_order.description, work_order.priority, 'READY',
        work_order.maintenance_stop_mode, work_order.technical_analysis
      FROM maintenance.work_orders work_order
      WHERE work_order.tenant_id = $2
        AND work_order.id = $3
        AND work_order.status = 'RELEASED'
      ON CONFLICT DO NOTHING
    `,
    [ids.readyAction, tenantId, ids.readyWorkOrder],
  );
}

async function main(): Promise<void> {
  const environment = loadEnvironment();
  if (environment.nodeEnv === 'production' || environment.release.environment === 'PRODUCTION') {
    throw new Error('A massa demonstrativa é bloqueada em produção.');
  }

  const passwords = {
    admin: requiredPassword('DEMO_ADMIN_PASSWORD'),
    quality: requiredPassword('DEMO_QUALITY_PASSWORD'),
    safety: requiredPassword('DEMO_SAFETY_PASSWORD'),
    maintenance: requiredPassword('DEMO_MAINTENANCE_PASSWORD'),
    operator: requiredPassword('DEMO_OPERATOR_PASSWORD'),
  };
  const passwordService = new PasswordService(environment.auth.passwordPepper);
  const pool = new Pool({ connectionString: environment.database.url, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setContext(client, environment.defaultTenantId);
    await client.query(
      `
        INSERT INTO platform.tenants (
          id, legal_name, display_name, slug, environment, status
        )
        VALUES (
          $1::uuid, 'Fab Control Homologação Ltda.', 'Fab Control Homologação',
          'fab-control-homologacao-' || left(replace($1::text, '-', ''), 12),
          'HOMOLOGATION', 'ACTIVE'
        )
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          environment = 'HOMOLOGATION',
          status = 'ACTIVE'
      `,
      [environment.defaultTenantId],
    );
    await seedIdentities(client, environment.defaultTenantId, passwords, passwordService);
    await seedTechnicalProfiles(client, environment.defaultTenantId);
    await client.query(
      `
        INSERT INTO platform.company_profiles (
          tenant_id, trade_name, legal_name, updated_by, metadata
        )
        VALUES (
          $1, 'Fab Control Homologação', 'Fab Control Homologação Ltda.',
          $2, '{"demo":true}'::jsonb
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          trade_name = EXCLUDED.trade_name,
          legal_name = EXCLUDED.legal_name,
          updated_by = EXCLUDED.updated_by,
          metadata = EXCLUDED.metadata
      `,
      [environment.defaultTenantId, ids.admin],
    );
    await seedCatalog(client, environment.defaultTenantId);
    await seedMaterials(client, environment.defaultTenantId);
    await seedParameters(client, environment.defaultTenantId);
    await seedChecklistsAndPlans(client, environment.defaultTenantId);
    await seedOperationalScenarios(client, environment.defaultTenantId);
    await client.query('COMMIT');
    process.stdout.write(
      'Massa de homologação aplicada: 5 perfis, 4 ativos, 9 tipos de etapa, 1 checklist, 2 planos, 1 validação pendente e 1 ação liberada.\n',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
