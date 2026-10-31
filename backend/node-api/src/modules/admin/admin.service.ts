import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors/app-error.js';
import type { Environment } from '../../config/environment.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PasswordService } from '../auth/password.service.js';
import { AdminRepository } from './admin.repository.js';
import { readCapabilityTelemetry } from './integrity-telemetry.js';
import type {
  AdminAuditMetadata,
  AdminProfile,
  BulkUserImportInput,
  AuditListQuery,
  SaveTechnicalAreaInput,
  SaveTechnicalRoleInput,
  SaveUserInput,
  UserListQuery,
} from './admin.types.js';

function fail(code: string, message: string, statusCode: number, details?: unknown): never {
  throw new AppError({ code, message, statusCode, ...(details === undefined ? {} : { details }) });
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function importKey(value: string): string {
  return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/gu, '');
}

function adminRowText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function scalarText(value: unknown, fallback = ''): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function configurationValue(value: unknown): Record<string, ConfigurationValue> {
  return Object.fromEntries(
    Object.entries(objectValue(value)).filter((entry): entry is [string, ConfigurationValue] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
}

function capabilityActions(code: string): string[] {
  const parts = code.split('.');
  return [parts.at(-1) ?? code];
}

const commercialFeatureNames: Readonly<Record<string, string>> = {
  CADASTROS: 'Cadastros',
  ORDENS_SERVICO: 'Ordens de serviço',
  CHECKLISTS: 'Checklists',
  GESTAO_TECNICA: 'Gestão técnica',
  INDICADORES: 'Indicadores',
  DOCUMENTOS: 'Documentos',
  IMPORTACOES: 'Importações',
  AUDITORIA: 'Auditoria',
  CONTINUIDADE: 'Continuidade',
  MOTOR_LIMITADO: 'Motor limitado',
};

type ConfigurationValue = string | number | boolean;
interface ConfigurationDefinition {
  readonly chave: string;
  readonly grupo: 'OPERACAO' | 'EVIDENCIAS' | 'WORKFLOW' | 'INDICADORES';
  readonly nome: string;
  readonly descricao: string;
  readonly tipo: 'INTEIRO' | 'NUMERO' | 'BOOLEANO' | 'ENUM';
  readonly padrao: ConfigurationValue;
  readonly minimo?: number;
  readonly maximo?: number;
  readonly unidade?: string;
  readonly opcoes?: readonly string[];
}

const configurationCatalog: readonly ConfigurationDefinition[] = [
  {
    chave: 'parada.tolerancia_retorno_min',
    grupo: 'OPERACAO',
    nome: 'Tolerância de retorno operacional',
    descricao: 'Minutos permitidos entre o fim da manutenção e o retorno operacional.',
    tipo: 'INTEIRO',
    padrao: 10,
    minimo: 0,
    maximo: 1_440,
    unidade: 'min',
  },
  {
    chave: 'manutencao.modo_parada_padrao',
    grupo: 'OPERACAO',
    nome: 'Modo de parada padrão',
    descricao: 'Aplicado quando a ação e o plano não definem uma política própria.',
    tipo: 'ENUM',
    padrao: 'DECISAO_EXECUTOR',
    opcoes: ['OBRIGATORIA', 'DECISAO_EXECUTOR', 'SEM_PARADA'],
  },
  {
    chave: 'evidencia.foto.max_bytes',
    grupo: 'EVIDENCIAS',
    nome: 'Tamanho máximo de foto',
    descricao: 'Limite de cada evidência fotográfica enviada pelo aplicativo.',
    tipo: 'INTEIRO',
    padrao: 2_500_000,
    minimo: 250_000,
    maximo: 5_000_000,
    unidade: 'bytes',
  },
  {
    chave: 'workflow.tecnico.exige_segregacao_padrao',
    grupo: 'WORKFLOW',
    nome: 'Segregação técnica padrão',
    descricao: 'Impede que o autor assine a própria liberação.',
    tipo: 'BOOLEANO',
    padrao: false,
  },
  {
    chave: 'workflow.tecnico.assinaturas_padrao',
    grupo: 'WORKFLOW',
    nome: 'Assinaturas técnicas padrão',
    descricao: 'Quantidade padrão de assinaturas quando a área exige aprovação.',
    tipo: 'INTEIRO',
    padrao: 1,
    minimo: 1,
    maximo: 5,
    unidade: 'assinaturas',
  },
  {
    chave: 'workflow.tecnico.politica_validacao_padrao',
    grupo: 'WORKFLOW',
    nome: 'Filtro técnico padrão',
    descricao: 'Define quem valida quando não há política específica.',
    tipo: 'ENUM',
    padrao: 'QUALIDADE_OU_SEGURANCA',
    opcoes: ['QUALIDADE_OU_SEGURANCA', 'QUALIDADE', 'SEGURANCA', 'QUALIDADE_E_SEGURANCA'],
  },
  {
    chave: 'kpi.janela_padrao_dias',
    grupo: 'INDICADORES',
    nome: 'Janela padrão dos indicadores',
    descricao: 'Período usado quando o painel não informa datas.',
    tipo: 'INTEIRO',
    padrao: 30,
    minimo: 1,
    maximo: 365,
    unidade: 'dias',
  },
  {
    chave: 'kpi.meta.disponibilidade_pct',
    grupo: 'INDICADORES',
    nome: 'Meta de disponibilidade',
    descricao: 'Referência gerencial de disponibilidade técnica.',
    tipo: 'NUMERO',
    padrao: 90,
    minimo: 0,
    maximo: 100,
    unidade: '%',
  },
];

const protectedConfigurationKeys = [
  'versão',
  'versão da aplicação',
  'versão da API',
  'versão do banco',
  'versão do contrato',
  'versão do frontend',
  'ambiente',
  'autenticação',
  'matriz de permissões',
  'regra do horímetro',
  'workflow técnico',
  'schema do motor',
  'snapshot de execução',
] as const;

const defaultCommercialPlans = [
  {
    codigo: 'INICIAL',
    nome: 'Inicial',
    recursos: ['CADASTROS', 'ORDENS_SERVICO', 'MOTOR_LIMITADO'],
  },
  {
    codigo: 'BASICO',
    nome: 'Básico',
    recursos: [
      'CADASTROS',
      'ORDENS_SERVICO',
      'CHECKLISTS',
      'GESTAO_TECNICA',
      'INDICADORES',
      'MOTOR_LIMITADO',
    ],
  },
  { codigo: 'COMPLETO', nome: 'Completo', recursos: Object.keys(commercialFeatureNames) },
] as const;

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function configurationDefaults(): Record<string, ConfigurationValue> {
  return Object.fromEntries(
    configurationCatalog.map((definition) => [definition.chave, definition.padrao]),
  );
}

function validateConfigurationSnapshot(input: Readonly<Record<string, ConfigurationValue>>) {
  const allowed = new Map(configurationCatalog.map((definition) => [definition.chave, definition]));
  const errors: { chave: string; codigo: string; mensagem: string }[] = [];
  const configuration: Record<string, ConfigurationValue> = {};
  for (const key of Object.keys(input)) {
    if (!allowed.has(key))
      errors.push({
        chave: key,
        codigo: 'CONFIG_KEY_NOT_ALLOWED',
        mensagem: 'Chave não editável pelo motor.',
      });
  }
  for (const definition of configurationCatalog) {
    const raw = input[definition.chave] ?? definition.padrao;
    let value: ConfigurationValue = raw;
    if (definition.tipo === 'INTEIRO' || definition.tipo === 'NUMERO') {
      const number = typeof raw === 'number' ? raw : Number(raw);
      value = definition.tipo === 'INTEIRO' ? Math.floor(number) : number;
      if (!Number.isFinite(number))
        errors.push({
          chave: definition.chave,
          codigo: 'CONFIG_NUMBER_INVALID',
          mensagem: 'Informe um número válido.',
        });
      else if (
        number < (definition.minimo ?? Number.NEGATIVE_INFINITY) ||
        number > (definition.maximo ?? Number.POSITIVE_INFINITY)
      )
        errors.push({
          chave: definition.chave,
          codigo: 'CONFIG_RANGE_INVALID',
          mensagem: 'Valor fora do intervalo permitido.',
        });
    } else if (definition.tipo === 'BOOLEANO' && typeof raw !== 'boolean') {
      errors.push({
        chave: definition.chave,
        codigo: 'CONFIG_BOOLEAN_INVALID',
        mensagem: 'Informe verdadeiro ou falso.',
      });
    } else if (definition.tipo === 'ENUM') {
      value = scalarText(raw).toUpperCase();
      if (!definition.opcoes?.includes(value))
        errors.push({
          chave: definition.chave,
          codigo: 'CONFIG_ENUM_INVALID',
          mensagem: 'Opção não permitida.',
        });
    }
    configuration[definition.chave] = value;
  }
  return {
    valido: errors.length === 0,
    erros: errors,
    configuracao: configuration,
    hash_sha256: hashJson(configuration),
  };
}

interface CommercialPlanInput {
  readonly codigo: string;
  readonly nome: string;
  readonly recursos: readonly string[];
}

function validateCommercialPlans(plans: readonly CommercialPlanInput[]) {
  const errors: { plano: string; codigo: string; mensagem: string }[] = [];
  const known = new Set(Object.keys(commercialFeatureNames));
  const canonical = plans
    .map((plan) => ({
      codigo: plan.codigo.toUpperCase(),
      nome: normalizeText(plan.nome),
      recursos: [...new Set(plan.recursos.map((item) => item.toUpperCase()))].sort(),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
  for (const code of ['INICIAL', 'BASICO', 'COMPLETO']) {
    if (!canonical.some((plan) => plan.codigo === code))
      errors.push({
        plano: code,
        codigo: 'PLAN_REQUIRED',
        mensagem: `O plano ${code} é obrigatório.`,
      });
  }
  if (new Set(canonical.map((plan) => plan.codigo)).size !== canonical.length)
    errors.push({
      plano: 'DESCONHECIDO',
      codigo: 'PLAN_DUPLICATED',
      mensagem: 'Existem planos duplicados.',
    });
  for (const plan of canonical) {
    for (const feature of plan.recursos)
      if (!known.has(feature))
        errors.push({
          plano: plan.codigo,
          codigo: 'FEATURE_UNKNOWN',
          mensagem: `Recurso desconhecido: ${feature}.`,
        });
    for (const mandatory of ['CADASTROS', 'ORDENS_SERVICO', 'MOTOR_LIMITADO'])
      if (!plan.recursos.includes(mandatory))
        errors.push({
          plano: plan.codigo,
          codigo: 'FEATURE_REQUIRED',
          mensagem: `O recurso ${mandatory} é obrigatório.`,
        });
  }
  const initial = new Set(canonical.find((plan) => plan.codigo === 'INICIAL')?.recursos ?? []);
  const basic = new Set(canonical.find((plan) => plan.codigo === 'BASICO')?.recursos ?? []);
  const complete = new Set(canonical.find((plan) => plan.codigo === 'COMPLETO')?.recursos ?? []);
  for (const feature of initial)
    if (!basic.has(feature))
      errors.push({
        plano: 'BASICO',
        codigo: 'PLAN_HIERARCHY_INVALID',
        mensagem: `O Básico deve incluir ${feature}.`,
      });
  for (const feature of basic)
    if (!complete.has(feature))
      errors.push({
        plano: 'COMPLETO',
        codigo: 'PLAN_HIERARCHY_INVALID',
        mensagem: `O Completo deve incluir ${feature}.`,
      });
  return {
    valido: errors.length === 0,
    erros: errors,
    planos: canonical,
    hash_sha256: hashJson(canonical),
  };
}

function plansValue(value: unknown): CommercialPlanInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const plan = objectValue(item);
    return {
      codigo: scalarText(plan.codigo).toUpperCase(),
      nome: scalarText(plan.nome),
      recursos: Array.isArray(plan.recursos)
        ? plan.recursos.map((feature) => scalarText(feature).toUpperCase())
        : [],
    };
  });
}

export class AdminService {
  private readonly repository = new AdminRepository();
  private readonly passwordService: PasswordService;

  constructor(
    private readonly environment: Environment,
    private readonly database: Database,
  ) {
    this.passwordService = new PasswordService(environment.auth.passwordPepper);
  }

  listUsers(user: AuthenticatedUser, query: UserListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const usuarios = await this.repository.listUsers(client, query);
        return { total: usuarios.length, usuarios };
      },
    );
  }

  async saveUser(user: AuthenticatedUser, raw: SaveUserInput, metadata: AdminAuditMetadata) {
    const input: SaveUserInput = {
      ...raw,
      name: normalizeText(raw.name),
      employeeNumber: normalizeText(raw.employeeNumber).toUpperCase(),
      email: raw.email?.trim() ? raw.email.trim().toLowerCase() : null,
      specialties: raw.specialties.map(normalizeText).filter(Boolean),
      scopeIds: raw.scopeIds.map(normalizeText).filter(Boolean),
    };
    if (!input.id && !input.temporaryPassword) {
      fail(
        'ADMIN_TEMPORARY_PASSWORD_REQUIRED',
        'Informe uma senha temporária para o novo usuário.',
        422,
      );
    }
    if (input.technicalRoleId && !input.areaId) {
      fail('ADMIN_TECHNICAL_AREA_REQUIRED', 'O cargo técnico exige uma área técnica.', 422);
    }
    const passwordHash = input.temporaryPassword
      ? await this.passwordService.hash(input.temporaryPassword)
      : null;

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = input.id ? await this.repository.findUser(client, input.id) : null;
        if (input.id && !before) fail('ADMIN_USER_NOT_FOUND', 'Usuário não encontrado.', 404);
        const saved = await this.repository.saveUser(
          client,
          user.tenantId,
          user.id,
          input,
          passwordHash,
        );
        const all = await this.repository.listUsers(client, {
          search: input.employeeNumber,
          profile: null,
          status: null,
          limit: 10,
        });
        const usuario = all.find((candidate) => candidate.id === saved.id);
        if (!usuario) throw new Error('O usuário salvo não pôde ser relido.');
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          `ADMIN_USER_${saved.mode === 'insert' ? 'CREATED' : 'UPDATED'}`,
          'iam.users',
          saved.id,
          before,
          usuario,
          metadata,
        );
        return { saved: true, mode: saved.mode, usuario, sessoes_revogadas: saved.revoked };
      },
    );
  }

  async importUsers(user: AuthenticatedUser, input: BulkUserImportInput, metadata: AdminAuditMetadata) {
    if (input.rows.length === 0 || input.rows.length > 500) {
      fail('ADMIN_USER_IMPORT_LIMIT', 'A planilha deve conter de 1 a 500 usuários.', 422);
    }
    const emails = new Set<string>();
    const registrations = new Set<string>();
    const rowNumbers = new Set<number>();
    const prepared: Array<BulkUserImportInput['rows'][number]> = [];
    for (const row of input.rows) {
      const name = normalizeText(row.name);
      const email = normalizeText(row.email).toLowerCase();
      const employeeNumber = normalizeText(row.employeeNumber).toUpperCase();
      const areaName = normalizeText(row.areaName);
      const roleName = normalizeText(row.roleName);
      const emailKey = email.toLocaleLowerCase('pt-BR');
      const registrationKey = employeeNumber.toLocaleUpperCase('pt-BR');
      if (name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !/^[A-Z0-9._-]{3,40}$/u.test(employeeNumber)) {
        fail('ADMIN_USER_IMPORT_ROW_INVALID', `Dados inválidos na linha ${row.rowNumber}.`, 422, { linha: row.rowNumber });
      }
      if (!areaName || !roleName || normalizeText(row.areaCode).length < 2 || normalizeText(row.roleCode).length < 2) {
        fail('ADMIN_USER_IMPORT_STRUCTURE_REQUIRED', `Área e cargo são obrigatórios na linha ${row.rowNumber}.`, 422, { linha: row.rowNumber });
      }
      if (rowNumbers.has(row.rowNumber) || emails.has(emailKey) || registrations.has(registrationKey)) {
        fail('ADMIN_USER_IMPORT_DUPLICATE_ROW', `A linha ${row.rowNumber} repete uma linha, e-mail ou matrícula da própria planilha.`, 422, { linha: row.rowNumber });
      }
      rowNumbers.add(row.rowNumber);
      emails.add(emailKey);
      registrations.add(registrationKey);
      prepared.push({ ...row, name, email, employeeNumber, areaName, roleName, areaCode: normalizeText(row.areaCode).toUpperCase().replace(/\s+/gu, '_'), roleCode: normalizeText(row.roleCode).toUpperCase().replace(/\s+/gu, '_') });
    }

    const passwordHashes: string[] = [];
    for (const row of prepared) {
      if (row.temporaryPassword.length < 12) {
        fail('ADMIN_TEMPORARY_PASSWORD_INVALID', `Senha temporária inválida na linha ${row.rowNumber}.`, 422, { linha: row.rowNumber });
      }
      passwordHashes.push(await this.passwordService.hash(row.temporaryPassword));
    }

    const batchId = randomUUID();
    const batchRecords: { id: string; rowNumber: number; userId: string; raw: Record<string, unknown>; normalized: Record<string, unknown> }[] = [];
    let createdAreas = 0;
    let createdRoles = 0;
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 9142026))', [user.tenantId]);
        const activeAreas = [...await this.repository.listAreas(client, 'ATIVO')];
        const areaCache = new Map<string, Record<string, unknown>>();
        const cacheArea = (area: Record<string, unknown>) => {
          areaCache.set(importKey(adminRowText(area, 'codigo')), area);
          areaCache.set(importKey(adminRowText(area, 'nome')), area);
        };
        activeAreas.forEach(cacheArea);
        const roleCache = new Map<string, Record<string, unknown>>();
        const cacheRole = (role: Record<string, unknown>) => {
          roleCache.set(`${adminRowText(role, 'area_id')}:${importKey(adminRowText(role, 'codigo'))}`, role);
          roleCache.set(`${adminRowText(role, 'area_id')}:${importKey(adminRowText(role, 'nome'))}`, role);
        };
        (await this.repository.listRoles(client, null, 'ATIVO')).forEach(cacheRole);
        const createdUsers: { id: string; row: (typeof prepared)[number]; area: Record<string, unknown>; role: Record<string, unknown> }[] = [];

        for (let index = 0; index < prepared.length; index += 1) {
          const row = prepared[index];
          if (!row) continue;
          const identityRole = await this.repository.requireIdentityRole(client, row.profile);
          if (identityRole.role_type === 'ADMIN' || row.profile.toLocaleUpperCase('pt-BR') === 'ADMIN') {
            fail('ADMIN_USER_IMPORT_ADMIN_PROFILE_BLOCKED', `O perfil TI deve ser atribuído individualmente (linha ${row.rowNumber}).`, 422, { linha: row.rowNumber });
          }
          const duplicate = await client.query<{ id: string }>(
            `SELECT id FROM iam.users WHERE tenant_id=$1 AND deleted_at IS NULL
             AND (lower(email)=lower($2) OR upper(employee_number)=upper($3)) LIMIT 1`,
            [user.tenantId, row.email, row.employeeNumber],
          );
          if (duplicate.rowCount) {
            fail('ADMIN_USER_IMPORT_USER_EXISTS', `E-mail ou matrícula já cadastrado (linha ${row.rowNumber}).`, 409, { linha: row.rowNumber });
          }

          let area = areaCache.get(importKey(row.areaCode)) ?? areaCache.get(importKey(row.areaName));
          if (!area) {
            const areaId = await this.repository.saveArea(client, user.tenantId, user.id, {
              id: null,
              code: row.areaCode,
              name: row.areaName,
              description: 'Criada pela importação de equipe.',
              status: 'ATIVO',
              defaultSignatureRequired: false,
            });
            area = { id: areaId, codigo: row.areaCode, nome: row.areaName, status: 'ATIVO' };
            cacheArea(area);
            createdAreas += 1;
            await this.repository.audit(client, user.tenantId, user.id, 'ADMIN_TECHNICAL_AREA_CREATED_BY_TEAM_IMPORT', 'iam.technical_areas', areaId, null, area, metadata);
          }
          const areaId = adminRowText(area, 'id');
          if (!areaId) throw new Error(`Não foi possível resolver a área da linha ${row.rowNumber}.`);
          const roleKey = `${areaId}:${importKey(row.roleCode)}`;
          let role = roleCache.get(roleKey) ?? roleCache.get(`${areaId}:${importKey(row.roleName)}`);
          if (role) {
            const existingCode = importKey(adminRowText(role, 'codigo'));
            const existingName = importKey(adminRowText(role, 'nome'));
            if (existingCode !== importKey(row.roleCode) || existingName !== importKey(row.roleName)) {
              fail('ADMIN_USER_IMPORT_ROLE_CONFLICT', `O cargo da linha ${row.rowNumber} conflita com outro código ou nome já cadastrado na área.`, 409, { linha: row.rowNumber, area: row.areaName, cargo: row.roleName });
            }
          }
          if (!role) {
            const conflict = await this.repository.findRoleConflict(
              client,
              user.tenantId,
              areaId,
              row.roleCode,
              row.roleName,
            );
            if (conflict) {
              fail('ADMIN_USER_IMPORT_ROLE_CONFLICT', `O cargo da linha ${row.rowNumber} conflita com outro código ou nome já cadastrado na área.`, 409, { linha: row.rowNumber, area: row.areaName, cargo: row.roleName, codigoExistente: conflict.code, nomeExistente: conflict.name });
            }
            const roleId = await this.repository.saveRole(client, user.tenantId, user.id, {
              id: null,
              areaId,
              code: row.roleCode,
              name: row.roleName,
              description: 'Criado pela importação de equipe.',
              status: 'ATIVO',
              canSign: false,
            });
            role = { id: roleId, area_id: areaId, codigo: row.roleCode, nome: row.roleName, status: 'ATIVO' };
            cacheRole(role);
            createdRoles += 1;
            await this.repository.audit(client, user.tenantId, user.id, 'ADMIN_TECHNICAL_ROLE_CREATED_BY_TEAM_IMPORT', 'iam.technical_roles', roleId, null, role, metadata);
          }
          const roleId = adminRowText(role, 'id');
          const saved = await this.repository.saveUser(client, user.tenantId, user.id, {
            id: null,
            name: row.name,
            email: row.email,
            employeeNumber: row.employeeNumber,
            profile: row.profile,
            status: row.status,
            temporaryPassword: null,
            areaId,
            technicalRoleId: roleId || null,
            specialties: [],
            scopeIds: [],
          }, passwordHashes[index] ?? null);
          const normalized = {
            nome: row.name,
            email: row.email,
            matricula: row.employeeNumber,
            perfil: row.profile,
            area_id: areaId,
            area: adminRowText(area, 'nome'),
            cargo_id: roleId,
            cargo: adminRowText(role, 'nome'),
            status: row.status,
          };
          await this.repository.audit(client, user.tenantId, user.id, 'ADMIN_USER_CREATED_BY_TEAM_IMPORT', 'iam.users', saved.id, null, normalized, metadata);
          createdUsers.push({ id: saved.id, row, area, role });
          batchRecords.push({
            id: randomUUID(),
            rowNumber: row.rowNumber,
            userId: saved.id,
            raw: { nome: row.name, email: row.email, matricula: row.employeeNumber, perfil_acesso: row.profile, area_tecnica: row.areaName, cargo_tecnico: row.roleName, status: row.status },
            normalized,
          });
        }

        const safeFingerprintRows = prepared.map((row) => ({ rowNumber: row.rowNumber, name: row.name, email: row.email, employeeNumber: row.employeeNumber, profile: row.profile, status: row.status, areaCode: row.areaCode, areaName: row.areaName, roleCode: row.roleCode, roleName: row.roleName }));
        const fingerprint = createHash('sha256').update(JSON.stringify(safeFingerprintRows), 'utf8').digest('hex');
        const validationHash = createHash('sha256').update(`VORQIX-USER-IMPORT:${batchId}:${fingerprint}`, 'utf8').digest('hex');
        await client.query(
          `INSERT INTO governance.import_batches (
             id,tenant_id,import_type,entity_type,source_file_name,source_sheet_name,status,
             total_rows,valid_rows,invalid_rows,validation_hash_sha256,headers,ignored_headers,
             result,created_by,confirmed_by,confirmed_at,content_fingerprint_sha256
           ) VALUES ($1,$2,'usuarios','iam.users',$3,$4,'CONFIRMED',$5,$5,0,$6,$7,'[]'::jsonb,$8,$9,$9,clock_timestamp(),$10)`,
          [batchId, user.tenantId, normalizeText(input.fileName), normalizeText(input.sheetName), createdUsers.length, validationHash, JSON.stringify(input.headers), JSON.stringify({ criados: createdUsers.length, atualizados: 0, areas_criadas: createdAreas, cargos_criados: createdRoles }), user.id, fingerprint],
        );
        for (const record of batchRecords) {
          await client.query(
            `INSERT INTO governance.import_records (
               id,tenant_id,import_batch_id,source_row_number,entity_type,entity_id,
               operation,status,raw_data,normalized_data,errors,after_data,applied_at
             ) VALUES ($1,$2,$3,$4,'iam.users',$5,'CRIAR','APPLIED',$6,$7,'[]'::jsonb,$7,clock_timestamp())`,
            [record.id, user.tenantId, batchId, record.rowNumber, record.userId, JSON.stringify(record.raw), JSON.stringify(record.normalized)],
          );
        }
        await this.repository.audit(client, user.tenantId, user.id, 'ADMIN_USERS_IMPORT_CONFIRMED', 'governance.import_batches', batchId, null, {
          tipo: 'usuarios', arquivo_nome: input.fileName, total: createdUsers.length, areas_criadas: createdAreas, cargos_criados: createdRoles,
        }, metadata);
      },
    );
    return { imported: true, lote_id: batchId, total: batchRecords.length, areas_criadas: createdAreas, cargos_criados: createdRoles };
  }

  async unlockUser(user: AuthenticatedUser, userId: string, metadata: AdminAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = await this.repository.findUser(client, userId);
        if (!before) fail('ADMIN_USER_NOT_FOUND', 'Usuário não encontrado.', 404);
        await this.repository.unlockUser(client, userId);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_USER_UNLOCKED',
          'iam.users',
          userId,
          before,
          { unlocked: true },
          metadata,
        );
        return { unlocked: true, usuario_id: userId };
      },
    );
  }

  async resetPassword(
    user: AuthenticatedUser,
    userId: string,
    password: string,
    metadata: AdminAuditMetadata,
  ) {
    const passwordHash = await this.passwordService.hash(password);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = await this.repository.findUser(client, userId);
        if (!before) fail('ADMIN_USER_NOT_FOUND', 'Usuário não encontrado.', 404);
        const revoked = await this.repository.resetPassword(client, userId, passwordHash);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_PASSWORD_RESET',
          'iam.users',
          userId,
          null,
          { primeiro_acesso: true, sessoes_revogadas: revoked },
          metadata,
        );
        return {
          password_reset: true,
          usuario_id: userId,
          primeiro_acesso: true,
          sessoes_revogadas: revoked,
        };
      },
    );
  }

  async revokeSessions(user: AuthenticatedUser, userId: string, metadata: AdminAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        if (!(await this.repository.findUser(client, userId)))
          fail('ADMIN_USER_NOT_FOUND', 'Usuário não encontrado.', 404);
        const revoked = await this.repository.revokeSessions(
          client,
          userId,
          'ADMIN_SESSION_REVOCATION',
        );
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_SESSIONS_REVOKED',
          'iam.sessions',
          userId,
          null,
          { sessoes_revogadas: revoked },
          metadata,
        );
        return { revoked: true, usuario_id: userId, sessoes_revogadas: revoked };
      },
    );
  }

  listAreas(user: AuthenticatedUser, status: 'ATIVO' | 'INATIVO' | null) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const areas = await this.repository.listAreas(client, status);
        return { total: areas.length, areas };
      },
    );
  }

  async saveArea(
    user: AuthenticatedUser,
    raw: SaveTechnicalAreaInput,
    metadata: AdminAuditMetadata,
  ) {
    const input = {
      ...raw,
      code: normalizeText(raw.code).toUpperCase().replace(/\s+/gu, '_'),
      name: normalizeText(raw.name),
      description: normalizeText(raw.description),
    };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = input.id
          ? (await this.repository.listAreas(client, null)).find((item) => item.id === input.id) ?? null
          : null;
        const id = await this.repository.saveArea(client, user.tenantId, user.id, input);
        const area = (await this.repository.listAreas(client, null)).find((item) => item.id === id);
        if (!area) throw new Error('A área salva não pôde ser relida.');
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          before ? 'ADMIN_TECHNICAL_AREA_UPDATED' : 'ADMIN_TECHNICAL_AREA_CREATED',
          'iam.technical_areas',
          id,
          before,
          area,
          metadata,
        );
        return { saved: true, area };
      },
    );
  }

  listRoles(user: AuthenticatedUser, areaId: string | null, status: 'ATIVO' | 'INATIVO' | null) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const cargos = await this.repository.listRoles(client, areaId, status);
        return { total: cargos.length, cargos };
      },
    );
  }

  async saveRole(
    user: AuthenticatedUser,
    raw: SaveTechnicalRoleInput,
    metadata: AdminAuditMetadata,
  ) {
    const input = {
      ...raw,
      code: normalizeText(raw.code).toUpperCase().replace(/\s+/gu, '_'),
      name: normalizeText(raw.name),
      description: normalizeText(raw.description),
    };
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = input.id
          ? (await this.repository.listRoles(client, input.areaId, null)).find((item) => item.id === input.id) ?? null
          : null;
        const conflict = await this.repository.findRoleConflict(
          client,
          user.tenantId,
          input.areaId,
          input.code,
          input.name,
          input.id,
        );
        if (conflict) {
          fail('ADMIN_TECHNICAL_ROLE_DUPLICATE', 'Já existe um cargo com esse código ou nome nesta área.', 409, {
            areaId: input.areaId,
            cargoId: conflict.id,
            codigo: conflict.code,
            nome: conflict.name,
          });
        }
        const id = await this.repository.saveRole(client, user.tenantId, user.id, input);
        const cargo = (await this.repository.listRoles(client, input.areaId, null)).find(
          (item) => item.id === id,
        );
        if (!cargo) throw new Error('O cargo salvo não pôde ser relido.');
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          before ? 'ADMIN_TECHNICAL_ROLE_UPDATED' : 'ADMIN_TECHNICAL_ROLE_CREATED',
          'iam.technical_roles',
          id,
          before,
          cargo,
          metadata,
        );
        return { saved: true, cargo };
      },
    );
  }

  permissionMatrix(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const rows = await this.repository.permissionMatrix(client);
        const profiles = await this.repository.identityRoles(client);
        return {
          chave: 'permissions.matrix.capabilities.v1',
          perfis: profiles.map((role) => {
            const profile = String(role.code);
            const capabilities = rows.filter((row) => row.role_code === profile);
            return {
              perfil: profile,
              id: String(role.id),
              nome: String(role.name),
              roleType: String(role.role_type),
              editavel: role.role_type !== 'ADMIN' && role.protected !== true,
              acesso_total: false,
              capacidades: capabilities.map((row) => ({
                id: String(row.code),
                nome: String(row.name),
                descricao: String(row.description),
                permitido: row.allowed === true,
                padrao: row.protected === true,
                acoes: capabilityActions(String(row.code)),
              })),
            };
          }),
        };
      },
    );
  }

  async provisionDefaultPermissionProfiles(user: AuthenticatedUser, metadata: AdminAuditMetadata) {
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.repository.ensureDefaultProfiles(client, user.tenantId);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_PERMISSION_DEFAULT_PROFILES_PROVISIONED',
          'iam.roles',
          user.tenantId,
          null,
          { perfis: ['GESTOR_TECNICO', 'OPERADOR', 'PCM', 'TECNICO', 'QUALIDADE', 'SEGURANCA', 'PRODUCAO'] },
          metadata,
        );
      },
    );
    return this.permissionMatrix(user);
  }

  async createPermissionProfile(user: AuthenticatedUser, rawName: string, metadata: AdminAuditMetadata) {
    const name = normalizeText(rawName);
    const code = name.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
      .toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 80);
    if (name.length < 3 || !code) fail('ADMIN_PROFILE_NAME_INVALID', 'Informe um nome de perfil com ao menos 3 caracteres.', 422);
    const matrix = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.repository.ensureDefaultProfiles(client, user.tenantId);
        const existing = await this.repository.identityRoles(client);
        if (existing.some((role) => String(role.code).toLocaleUpperCase('pt-BR') === code)) {
          fail('ADMIN_PROFILE_ALREADY_EXISTS', `Já existe um perfil com o código ${code}.`, 409);
        }
        const id = await this.repository.createCustomProfile(client, user.tenantId, code, name);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_PERMISSION_PROFILE_CREATED',
          'iam.roles',
          id,
          null,
          { id, perfil: code, nome: name, role_type: 'CUSTOM', permissoes_iniciais: [] },
          metadata,
        );
        return { id, code };
      },
    );
    const updated = await this.permissionMatrix(user);
    return { saved: true, perfil: updated.perfis.find((profile) => profile.perfil === matrix.code) };
  }

  async savePermissions(
    user: AuthenticatedUser,
    profile: AdminProfile,
    permissions: Readonly<Record<string, boolean>>,
    metadata: AdminAuditMetadata,
  ) {
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        await this.repository.savePermissions(client, profile, permissions, user.id);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_PERMISSION_MATRIX_UPDATED',
          'iam.role_capabilities',
          profile,
          null,
          { perfil: profile, permissoes: permissions },
          metadata,
        );
      },
    );
    const matrix = await this.permissionMatrix(user);
    return {
      saved: true,
      perfil: profile,
      matriz: matrix.perfis.find((item) => item.perfil === profile),
    };
  }

  company(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const company = await this.repository.company(client);
        if (!company)
          fail('ADMIN_COMPANY_NOT_FOUND', 'Identidade empresarial não encontrada.', 404);
        return company;
      },
    );
  }

  async saveCompany(
    user: AuthenticatedUser,
    name: string,
    logoDataUrl: string,
    metadata: AdminAuditMetadata,
  ) {
    const normalizedName = normalizeText(name);
    if (
      logoDataUrl &&
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(logoDataUrl)
    ) {
      fail('ADMIN_COMPANY_LOGO_INVALID', 'A logomarca deve ser PNG, JPEG ou WebP em Base64.', 422);
    }
    if (Buffer.byteLength(logoDataUrl, 'utf8') > 7_000_000) {
      fail('ADMIN_COMPANY_LOGO_TOO_LARGE', 'A logomarca excede o limite seguro de 5 MB.', 413);
    }
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const before = await this.repository.company(client);
        await this.repository.saveCompany(
          client,
          user.tenantId,
          user.id,
          normalizedName,
          logoDataUrl,
        );
        const empresa = await this.repository.company(client);
        if (!empresa) throw new Error('A identidade empresarial salva não pôde ser relida.');
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_COMPANY_IDENTITY_UPDATED',
          'platform.company_profiles',
          user.tenantId,
          before,
          empresa,
          metadata,
        );
        return { saved: true, empresa };
      },
    );
  }

  commercialAccess(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const row = (await this.repository.commercialAccess(client)) ?? {};
        const resources = Array.isArray(row.recursos) ? row.recursos.map(String) : [];
        const normalizedResources = resources.filter((code) => code in commercialFeatureNames);
        const fallback = Object.keys(commercialFeatureNames);
        const hasSubscription = row.status !== null && row.status !== undefined;
        const enabled = hasSubscription ? normalizedResources : fallback;
        const subscriptionStatus = scalarText(row.status, 'ACTIVE');
        const active = ['TRIAL', 'ACTIVE'].includes(subscriptionStatus);
        const windowOpen = row.janela_status === 'OPEN';
        return {
          schema_version: 'commercial-access.v1',
          plano: {
            codigo: scalarText(row.plano_codigo, 'COMPLETO'),
            nome: scalarText(row.plano_nome, 'Completo'),
          },
          status: active ? 'ATIVA' : 'BLOQUEADA',
          valido_ate: row.ends_at ?? '',
          recursos: enabled.map((code) => ({
            codigo: code,
            nome: commercialFeatureNames[code] ?? code,
          })),
          manutencao: {
            aberta: windowOpen,
            estado: windowOpen ? 'ABERTA' : 'FECHADA',
            motivo: scalarText(row.janela_motivo),
            expira_em: row.janela_expira_em ?? '',
            janela_id: row.janela_id ?? undefined,
          },
          acesso_integral: active,
          identidade_interna: null,
          usuario_id: user.id,
        };
      },
    );
  }

  configurationState(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const activeRow = await this.repository.activeConfiguration(client);
        const draftRow = await this.repository.configurationDraft(client, user.id);
        const accessRow = await this.repository.commercialAccess(client);
        const activeConfiguration = activeRow
          ? configurationValue(activeRow.configuracao)
          : configurationDefaults();
        const activeValidation = validateConfigurationSnapshot(activeConfiguration);
        const active = {
          id: scalarText(activeRow?.id),
          numero: Number(activeRow?.numero ?? 0),
          hash_sha256: scalarText(activeRow?.hash_sha256, activeValidation.hash_sha256),
          configuracao: activeValidation.configuracao,
          publicado_em: scalarText(activeRow?.publicado_em),
          publicado_por: scalarText(activeRow?.criado_por),
          integridade: activeRow
            ? activeValidation.valido
              ? 'VALIDA'
              : 'FALLBACK_SEGURO'
            : 'PADRAO_SEGURO',
        };
        const draftConfiguration = configurationValue(draftRow?.configuracao);
        const draftValidation = draftRow ? validateConfigurationSnapshot(draftConfiguration) : null;
        const resources = Array.isArray(accessRow?.recursos)
          ? accessRow.recursos.map((resource) => scalarText(resource)).filter(Boolean)
          : [];
        const enabled = accessRow?.status !== null && accessRow?.status !== undefined
          ? resources
          : Object.keys(commercialFeatureNames);
        const subscriptionStatus = scalarText(accessRow?.status, 'ACTIVE');
        const subscriptionActive = ['TRIAL', 'ACTIVE'].includes(subscriptionStatus);
        const windowOpen = accessRow?.janela_status === 'OPEN';
        return {
          catalogo: configurationCatalog.map((definition) => ({
            ...definition,
            ...(definition.opcoes ? { opcoes: [...definition.opcoes] } : {}),
          })),
          protegidas: [...protectedConfigurationKeys],
          acesso_comercial: {
            schema_version: 'commercial-access.v1',
            plano: {
              codigo: scalarText(accessRow?.plano_codigo, 'COMPLETO'),
              nome: scalarText(accessRow?.plano_nome, 'Completo'),
            },
            status: subscriptionActive ? 'ATIVA' : 'BLOQUEADA',
            valido_ate: accessRow?.ends_at ?? '',
            recursos: enabled.map((code) => ({
              codigo: code,
              nome: commercialFeatureNames[code] ?? code,
            })),
            manutencao: {
              aberta: windowOpen,
              estado: windowOpen ? 'ABERTA' : 'FECHADA',
              motivo: scalarText(accessRow?.janela_motivo),
              expira_em: accessRow?.janela_expira_em ?? '',
              ...(accessRow?.janela_id ? { janela_id: accessRow.janela_id } : {}),
            },
            acesso_integral: subscriptionActive,
            identidade_interna: null,
            usuario_id: user.id,
          },
          ativa: active,
          rascunho:
            draftRow && draftValidation
              ? {
                  id: scalarText(draftRow.id),
                  base_versao_id: scalarText(draftRow.base_versao_id),
                  configuracao: draftValidation.configuracao,
                  hash_sha256: scalarText(draftRow.hash_sha256, draftValidation.hash_sha256),
                  validacao: draftValidation,
                  atualizado_em: scalarText(draftRow.atualizado_em),
                }
              : null,
        };
      },
    );
  }

  validateConfiguration(
    _user: AuthenticatedUser,
    configuration: Readonly<Record<string, ConfigurationValue>>,
  ) {
    return validateConfigurationSnapshot(configuration);
  }

  saveConfigurationDraft(
    user: AuthenticatedUser,
    configuration: Readonly<Record<string, ConfigurationValue>>,
    baseVersionId: string,
    metadata: AdminAuditMetadata,
  ) {
    const validation = validateConfigurationSnapshot(configuration);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const active = await this.repository.activeConfiguration(client, true);
        const normalizedBaseId = baseVersionId || null;
        if (normalizedBaseId !== (active?.id ?? null)) {
          fail(
            'CONFIGURATION_BASE_VERSION_STALE',
            'A configuração ativa mudou. Reabra o motor antes de salvar.',
            409,
            { ativa_id: active?.id ?? '' },
          );
        }
        const draft = await this.repository.saveConfigurationDraft(
          client,
          user.tenantId,
          user.id,
          normalizedBaseId,
          validation.configuracao,
          validation.hash_sha256,
          validation,
          validation.valido,
        );
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_CONFIGURATION_DRAFT_SAVED',
          'platform.configuration_drafts',
          scalarText(draft.id),
          null,
          draft,
          metadata,
        );
        return {
          saved: true,
          rascunho: {
            id: scalarText(draft.id),
            base_versao_id: scalarText(draft.base_versao_id),
            configuracao: validation.configuracao,
            hash_sha256: validation.hash_sha256,
            validacao: validation,
            atualizado_em: draft.atualizado_em,
          },
        };
      },
    );
  }

  listConfigurationVersions(user: AuthenticatedUser, limit: number) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const versions = await this.repository.listConfigurationVersions(client, limit);
        return {
          total: versions.length,
          versoes: versions.map((version) => ({
            id: version.id,
            numero: version.numero,
            status: version.status === 'PUBLISHED' ? 'ATIVA' : 'PUBLICADA',
            origem: version.origem === 'ROLLBACK' ? 'ROLLBACK' : 'PUBLICACAO',
            base_versao_id: version.base_versao_id ?? '',
            hash_sha256: version.hash_sha256,
            valido: version.valido === true,
            criado_por: version.criado_por,
            criado_em: version.publicado_em ?? version.criado_em,
          })),
        };
      },
    );
  }

  publishConfiguration(user: AuthenticatedUser, draftId: string, metadata: AdminAuditMetadata) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const active = await this.repository.activeConfiguration(client, true);
        const draft = await this.repository.configurationDraft(client, user.id, true);
        if (draft?.id !== draftId)
          fail('CONFIGURATION_DRAFT_NOT_FOUND', 'Rascunho de configuração não encontrado.', 404);
        if ((draft.base_versao_id ?? null) !== (active?.id ?? null))
          fail(
            'CONFIGURATION_BASE_VERSION_STALE',
            'A configuração ativa mudou. Reabra o motor antes de publicar.',
            409,
            { ativa_id: active?.id ?? '' },
          );
        const validation = validateConfigurationSnapshot(configurationValue(draft.configuracao));
        if (!validation.valido)
          fail(
            'CONFIGURATION_INVALID',
            'A configuração possui inconsistências e não pode ser publicada.',
            422,
            validation,
          );
        if (active?.hash_sha256 === validation.hash_sha256)
          fail(
            'CONFIGURATION_UNCHANGED',
            'O rascunho não possui alterações em relação à versão ativa.',
            409,
          );
        const published = await this.repository.publishConfiguration(
          client,
          user.tenantId,
          user.id,
          {
            ...draft,
            configuracao: validation.configuracao,
            hash_sha256: validation.hash_sha256,
            validacao: validation,
          },
          'PUBLICATION',
        );
        await this.repository.closeConfigurationDraft(client, draftId);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_CONFIGURATION_PUBLISHED',
          'platform.configuration_versions',
          scalarText(published.id),
          active,
          published,
          metadata,
        );
        return {
          published: true,
          ativa: {
            id: scalarText(published.id),
            numero: Number(published.numero),
            hash_sha256: scalarText(published.hash_sha256),
            configuracao: configurationValue(published.configuracao),
            publicado_em: scalarText(published.publicado_em),
            publicado_por: scalarText(published.publicado_por),
            integridade: 'VALIDA',
          },
        };
      },
    );
  }

  rollbackConfiguration(
    user: AuthenticatedUser,
    versionId: string,
    baseVersionId: string,
    reason: string,
    metadata: AdminAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const active = await this.repository.activeConfiguration(client, true);
        if (baseVersionId !== scalarText(active?.id))
          fail(
            'CONFIGURATION_BASE_VERSION_STALE',
            'A configuração ativa mudou. Reabra o histórico antes do rollback.',
            409,
            { ativa_id: active?.id ?? '' },
          );
        const target = (await this.repository.listConfigurationVersions(client, 100)).find(
          (version) => version.id === versionId,
        );
        if (!target)
          fail('CONFIGURATION_VERSION_NOT_FOUND', 'Versão de configuração não encontrada.', 404);
        const validation = validateConfigurationSnapshot(configurationValue(target.configuracao));
        if (!validation.valido)
          fail(
            'CONFIGURATION_ROLLBACK_INVALID',
            'A versão selecionada não é compatível com o motor atual.',
            422,
            validation,
          );
        if (active?.hash_sha256 === validation.hash_sha256)
          fail('CONFIGURATION_UNCHANGED', 'A versão selecionada já está ativa.', 409);
        const draft = await this.repository.saveConfigurationDraft(
          client,
          user.tenantId,
          user.id,
          (active?.id as string | null) ?? null,
          validation.configuracao,
          validation.hash_sha256,
          validation,
          true,
        );
        const published = await this.repository.publishConfiguration(
          client,
          user.tenantId,
          user.id,
          draft,
          'ROLLBACK',
        );
        await this.repository.closeConfigurationDraft(client, scalarText(draft.id));
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'ADMIN_CONFIGURATION_ROLLED_BACK',
          'platform.configuration_versions',
          scalarText(published.id),
          active,
          { ...published, motivo: normalizeText(reason), versao_origem_id: versionId },
          metadata,
        );
        return {
          published: true,
          rollback_from_version_id: versionId,
          ativa: {
            id: scalarText(published.id),
            numero: Number(published.numero),
            hash_sha256: scalarText(published.hash_sha256),
            configuracao: configurationValue(published.configuracao),
            publicado_em: scalarText(published.publicado_em),
            publicado_por: scalarText(published.publicado_por),
            integridade: 'VALIDA',
          },
        };
      },
    );
  }

  platformMotorCatalog(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const access = await this.repository.commercialAccess(client);
        const active = await this.repository.activeCommercialCatalog(client);
        const draft = await this.repository.commercialCatalogDraft(client, user.id);
        const versions = await this.repository.listCommercialCatalogVersions(client, 20);
        const activePlans = plansValue(objectValue(active?.catalog).planos);
        const plans =
          activePlans.length > 0
            ? activePlans
            : defaultCommercialPlans.map((plan) => ({ ...plan, recursos: [...plan.recursos] }));
        const activeValidation = validateCommercialPlans(plans);
        const draftPlans = plansValue(objectValue(draft?.catalog).planos);
        const draftValidation = draft ? validateCommercialPlans(draftPlans) : null;
        const resources = Array.isArray(access?.recursos)
          ? access.recursos.map((item) => scalarText(item)).filter(Boolean)
          : Object.keys(commercialFeatureNames);
        const windowOpen = access?.janela_status === 'OPEN';
        return {
          schema_version: 'platform-motor-catalog.v1',
          gerado_em: new Date().toISOString(),
          ambiente: 'PRODUCAO',
          tenant_id: user.tenantId,
          assinatura: {
            plano: {
              codigo: scalarText(access?.plano_codigo, 'COMPLETO'),
              nome: scalarText(access?.plano_nome, 'Completo'),
            },
            status: ['TRIAL', 'ACTIVE'].includes(scalarText(access?.status, 'ACTIVE'))
              ? 'ATIVA'
              : 'BLOQUEADA',
            origem: 'BANCO_VERSIONADO',
            integridade: 'VALIDA',
            valido_ate: access?.ends_at ?? '',
            recursos: resources,
          },
          manutencao: {
            aberta: windowOpen,
            estado: windowOpen ? 'ABERTA' : 'FECHADA',
            motivo: scalarText(access?.janela_motivo),
            expira_em: access?.janela_expira_em ?? '',
            ...(access?.janela_id ? { janela_id: access.janela_id } : {}),
          },
          recursos: Object.entries(commercialFeatureNames).map(([codigo, nome]) => ({
            codigo,
            nome,
          })),
          planos: activeValidation.planos,
          politicas: {
            padrao: 'NEGAR_ACAO_NAO_CLASSIFICADA',
            regras: [
              { prefixo: 'admin.', recurso: 'CADASTROS' },
              { prefixo: 'gestor.', recurso: 'GESTAO_TECNICA' },
              { prefixo: 'operador.', recurso: 'ORDENS_SERVICO' },
              { prefixo: 'cmms.', recurso: 'INDICADORES' },
            ],
            acoes_nucleo: ['auth.login', 'auth.logout', 'sistema.health', 'sistema.warmup'],
          },
          protecoes: {
            identidade_assinada: true,
            janela_assinada: true,
            codigo_uso_unico: true,
            sessao_sem_cache: true,
            revalidacao_por_requisicao: true,
          },
          controle: {
            schema_version: 'platform-motor-control.v1',
            edicao_disponivel: windowOpen,
            ativa: {
              id: scalarText(active?.id),
              numero: Number(active?.numero ?? 0),
              origem: active
                ? active.origem === 'ROLLBACK'
                  ? 'ROLLBACK'
                  : 'PUBLICACAO'
                : 'PADRAO_EM_CODIGO',
              integridade: activeValidation.valido
                ? active
                  ? 'VALIDA'
                  : 'PADRAO_SEGURO'
                : 'INVALIDA',
              hash_sha256: scalarText(active?.hash_sha256, activeValidation.hash_sha256),
              publicado_em: scalarText(active?.publicado_em),
              publicado_por: scalarText(active?.publicado_por),
              planos: activeValidation.planos,
            },
            rascunho:
              draft && draftValidation
                ? {
                    id: draft.id,
                    base_versao_id: scalarText(draft.base_versao_id),
                    planos: draftValidation.planos,
                    hash_sha256: scalarText(draft.hash_sha256, draftValidation.hash_sha256),
                    validacao: draftValidation,
                    atualizado_em: draft.atualizado_em,
                    integridade: draftValidation.valido ? 'VALIDA' : 'INVALIDA',
                  }
                : null,
            historico: {
              integridade: 'VALIDA',
              total: versions.length,
              versoes: versions.map((version) => ({
                id: version.id,
                numero: version.numero,
                origem: version.origem === 'ROLLBACK' ? 'ROLLBACK' : 'PUBLICACAO',
                hash_sha256: version.hash_sha256,
                publicado_por: version.publicado_por,
                publicado_em: version.publicado_em,
                ativa: version.status === 'PUBLISHED',
              })),
            },
            limites: { versoes_retidas: 100, bytes_por_propriedade: 16_384 },
          },
        };
      },
    );
  }

  validatePlatformMotorCatalog(_user: AuthenticatedUser, plans: readonly CommercialPlanInput[]) {
    return validateCommercialPlans(plans);
  }

  savePlatformMotorCatalogDraft(
    user: AuthenticatedUser,
    plans: readonly CommercialPlanInput[],
    baseVersionId: string,
    metadata: AdminAuditMetadata,
  ) {
    const validation = validateCommercialPlans(plans);
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const window = await this.repository.openMaintenanceWindow(client);
        if (!window)
          fail(
            'MAINTENANCE_WINDOW_REQUIRED',
            'Abra uma janela de manutenção para editar o catálogo comercial.',
            423,
          );
        const active = await this.repository.activeCommercialCatalog(client, true);
        const normalizedBaseId = baseVersionId || null;
        if (normalizedBaseId !== (active?.id ?? null))
          fail('COMMERCIAL_CATALOG_BASE_STALE', 'O catálogo ativo mudou. Reabra o motor.', 409, {
            ativa_id: active?.id ?? '',
          });
        const draft = await this.repository.saveCommercialCatalogDraft(
          client,
          user.tenantId,
          user.id,
          normalizedBaseId,
          { planos: validation.planos },
          validation.hash_sha256,
          validation,
          validation.valido,
        );
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'PLATFORM_COMMERCIAL_CATALOG_DRAFT_SAVED',
          'platform.commercial_catalog_drafts',
          scalarText(draft.id),
          null,
          draft,
          metadata,
        );
        return {
          saved: true,
          rascunho: {
            id: draft.id,
            base_versao_id: scalarText(draft.base_versao_id),
            planos: validation.planos,
            hash_sha256: validation.hash_sha256,
            validacao: validation,
            atualizado_em: draft.atualizado_em,
            integridade: validation.valido ? 'VALIDA' : 'INVALIDA',
          },
        };
      },
    );
  }

  listPlatformMotorCatalogVersions(user: AuthenticatedUser, limit: number) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const versions = await this.repository.listCommercialCatalogVersions(client, limit);
        return {
          total: versions.length,
          versoes: versions.map((version) => ({
            id: version.id,
            numero: version.numero,
            origem: version.origem === 'ROLLBACK' ? 'ROLLBACK' : 'PUBLICACAO',
            hash_sha256: version.hash_sha256,
            publicado_por: version.publicado_por,
            publicado_em: version.publicado_em,
            ativa: version.status === 'PUBLISHED',
          })),
        };
      },
    );
  }

  publishPlatformMotorCatalog(
    user: AuthenticatedUser,
    draftId: string,
    metadata: AdminAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        if (!(await this.repository.openMaintenanceWindow(client)))
          fail(
            'MAINTENANCE_WINDOW_REQUIRED',
            'A janela de manutenção expirou ou foi encerrada.',
            423,
          );
        const active = await this.repository.activeCommercialCatalog(client, true);
        const draft = await this.repository.commercialCatalogDraft(client, user.id, true);
        if (draft?.id !== draftId)
          fail('COMMERCIAL_CATALOG_DRAFT_NOT_FOUND', 'Rascunho do catálogo não encontrado.', 404);
        if ((draft.base_versao_id ?? null) !== (active?.id ?? null))
          fail('COMMERCIAL_CATALOG_BASE_STALE', 'O catálogo ativo mudou. Reabra o motor.', 409, {
            ativa_id: active?.id ?? '',
          });
        const validation = validateCommercialPlans(plansValue(objectValue(draft.catalog).planos));
        if (!validation.valido)
          fail('COMMERCIAL_CATALOG_INVALID', 'O catálogo possui inconsistências.', 422, validation);
        if (active?.hash_sha256 === validation.hash_sha256)
          fail('COMMERCIAL_CATALOG_UNCHANGED', 'O rascunho não possui alterações.', 409);
        const published = await this.repository.publishCommercialCatalog(
          client,
          user.tenantId,
          user.id,
          {
            ...draft,
            catalog: { planos: validation.planos },
            hash_sha256: validation.hash_sha256,
            validacao: validation,
          },
          'PUBLICATION',
        );
        await this.repository.closeCommercialCatalogDraft(client, draftId);
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'PLATFORM_COMMERCIAL_CATALOG_PUBLISHED',
          'platform.commercial_catalog_versions',
          scalarText(published.id),
          active,
          published,
          metadata,
        );
        return {
          published: true,
          ativa: {
            id: published.id,
            numero: published.numero,
            origem: 'PUBLICACAO',
            integridade: 'VALIDA',
            hash_sha256: published.hash_sha256,
            publicado_em: published.publicado_em,
            publicado_por: published.publicado_por,
            planos: validation.planos,
          },
        };
      },
    );
  }

  rollbackPlatformMotorCatalog(
    user: AuthenticatedUser,
    versionId: string,
    baseVersionId: string,
    reason: string,
    metadata: AdminAuditMetadata,
  ) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        if (!(await this.repository.openMaintenanceWindow(client)))
          fail(
            'MAINTENANCE_WINDOW_REQUIRED',
            'Abra uma janela de manutenção para restaurar o catálogo comercial.',
            423,
          );
        const active = await this.repository.activeCommercialCatalog(client, true);
        if (baseVersionId !== scalarText(active?.id))
          fail(
            'COMMERCIAL_CATALOG_BASE_STALE',
            'O catálogo ativo mudou. Reabra o histórico.',
            409,
            { ativa_id: active?.id ?? '' },
          );
        const target = (await this.repository.listCommercialCatalogVersions(client, 100)).find(
          (version) => version.id === versionId,
        );
        if (!target)
          fail('COMMERCIAL_CATALOG_VERSION_NOT_FOUND', 'Versão do catálogo não encontrada.', 404);
        const validation = validateCommercialPlans(plansValue(objectValue(target.catalog).planos));
        if (!validation.valido)
          fail(
            'COMMERCIAL_CATALOG_ROLLBACK_INVALID',
            'A versão selecionada não é compatível com o motor atual.',
            422,
            validation,
          );
        if (active?.hash_sha256 === validation.hash_sha256)
          fail('COMMERCIAL_CATALOG_UNCHANGED', 'A versão selecionada já está ativa.', 409);
        const draft = await this.repository.saveCommercialCatalogDraft(
          client,
          user.tenantId,
          user.id,
          (active?.id as string | null) ?? null,
          { planos: validation.planos },
          validation.hash_sha256,
          validation,
          true,
        );
        const published = await this.repository.publishCommercialCatalog(
          client,
          user.tenantId,
          user.id,
          draft,
          'ROLLBACK',
        );
        await this.repository.closeCommercialCatalogDraft(client, scalarText(draft.id));
        await this.repository.audit(
          client,
          user.tenantId,
          user.id,
          'PLATFORM_COMMERCIAL_CATALOG_ROLLED_BACK',
          'platform.commercial_catalog_versions',
          scalarText(published.id),
          active,
          { ...published, motivo: normalizeText(reason), versao_origem_id: versionId },
          metadata,
        );
        return {
          published: true,
          rollback_from_version_id: versionId,
          ativa: {
            id: published.id,
            numero: published.numero,
            origem: 'ROLLBACK',
            integridade: 'VALIDA',
            hash_sha256: published.hash_sha256,
            publicado_em: published.publicado_em,
            publicado_por: published.publicado_por,
            planos: validation.planos,
          },
        };
      },
    );
  }

  listAudit(user: AuthenticatedUser, query: AuditListQuery) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const rows = await this.repository.listAudit(client, query);
        const eventos = rows.filter((row) => row.id !== null).map((row) => ({
          id: scalarText(row.id),
          usuario_id: scalarText(row.responsavel_id),
          responsavel: scalarText(row.responsavel),
          responsavel_tipo: scalarText(row.responsavel_tipo),
          perfil: scalarText(row.perfil),
          acao: scalarText(row.acao),
          entidade: scalarText(row.entidade),
          entidade_id: scalarText(row.registro),
          antes_json: row.antes === null ? undefined : JSON.stringify(row.antes),
          depois_json: row.depois === null ? undefined : JSON.stringify(row.depois),
          trace_id: scalarText(row.trace_id),
          origem: scalarText(row.origem),
          ip_address: scalarText(row.ip_address),
          user_agent: scalarText(row.user_agent),
          campos_ocultos: Array.isArray(row.campos_ocultos) ? row.campos_ocultos : [],
          criado_em: new Date(scalarText(row.data_hora)).toISOString(),
        }));
        return { total: Number(rows[0]?.total ?? 0), deslocamento: query.offset, eventos };
      },
    );
  }

  async monitoring(user: AuthenticatedUser) {
    const observedAt = new Date().toISOString();
    const telemetry = readCapabilityTelemetry(user.tenantId);
    let databaseHealth: { latencyMs: number } | null = null;
    try {
      databaseHealth = await this.database.healthcheck();
    } catch {
      return {
        health: {
          ok: false,
          app: 'fab-control-api',
          version: this.environment.release.api,
          spreadsheetId: 'primary-storage',
          serverTime: observedAt,
          environment: this.environment.release.environment,
          schemaVersion: this.environment.release.schema,
          databaseReady: false,
          databaseLatencyMs: null,
        },
        diagnostico: { dry_run: true, total_issues: 0, by_code: {}, issues: [] },
        cache: { provider: 'none', source_of_truth: 'primary-storage', stale: false },
        auditoria: { eventos_24h: 0, ultimo_evento: null },
        telemetria: {
          windowMinutes: 15,
          observedAt,
          source: 'process-memory',
          persistence: 'process-lifetime',
          modules: telemetry,
        },
      };
    }

    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const summary = await this.repository.monitoringSummary(client);
        const issues = await this.repository.monitoringIssues(client);
        const latestRows = await this.repository.listAudit(client, {
          search: '',
          actionGroup: null,
          entityType: null,
          responsibleId: null,
          limit: 1,
          offset: 0,
        });
        const byCode = issues.reduce<Record<string, number>>((counts, issue) => {
          counts[issue.code] = (counts[issue.code] ?? 0) + 1;
          return counts;
        }, {});
        const latest = latestRows[0];
        return {
          health: {
            ok: databaseHealth !== null,
            app: 'fab-control-api',
            version: this.environment.release.api,
            spreadsheetId: 'primary-storage',
            serverTime: new Date().toISOString(),
            environment: this.environment.release.environment,
            schemaVersion: this.environment.release.schema,
            databaseReady: databaseHealth !== null,
            databaseLatencyMs: databaseHealth?.latencyMs ?? null,
          },
          diagnostico: {
            dry_run: true,
            total_issues: issues.length,
            by_code: byCode,
            issues,
          },
          cache: {
            provider: 'none',
            source_of_truth: 'primary-storage',
            stale: false,
          },
          auditoria: {
            eventos_24h: Number(summary.audit_events_24h),
            ultimo_evento: latest
              ? {
                  id: scalarText(latest.id),
                  usuario_id: scalarText(latest.responsavel_id),
                  perfil: scalarText(latest.perfil),
                  acao: scalarText(latest.acao),
                  entidade: scalarText(latest.entidade),
                  entidade_id: scalarText(latest.registro),
                  antes_json: latest.antes === null ? undefined : JSON.stringify(latest.antes),
                  depois_json: latest.depois === null ? undefined : JSON.stringify(latest.depois),
                  criado_em: new Date(scalarText(latest.data_hora)).toISOString(),
                }
              : null,
          },
          telemetria: {
            windowMinutes: 15,
            observedAt,
            source: 'process-memory',
            persistence: 'process-lifetime',
            modules: telemetry,
          },
          tabelas_declaradas: Number(summary.declared_tables),
          verificado_em: new Date().toISOString(),
        };
      },
    );
  }

  listTechnicalAnalyses(user: AuthenticatedUser) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const analises = await this.repository.listTechnicalAnalyses(client);
        return { total: analises.length, analises };
      },
    );
  }

  listTechnicalDemands(user: AuthenticatedUser, limit: number) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const demandas = await this.repository.listTechnicalDemands(client, limit);
        return { total: demandas.length, demandas };
      },
    );
  }
}
