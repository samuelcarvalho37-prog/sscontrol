import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AdminService } from './admin.service.js';
import type { AdminProfile, AdminStatus } from './admin.types.js';

interface Params {
  readonly userId?: string;
  readonly areaId?: string;
  readonly roleId?: string;
  readonly profile?: AdminProfile;
}
interface UserQuery {
  readonly busca?: string;
  readonly perfil?: AdminProfile;
  readonly status?: AdminStatus;
  readonly limite?: number;
}
interface UserBody {
  readonly id?: string;
  readonly nome: string;
  readonly email?: string | null;
  readonly matricula: string;
  readonly perfil: AdminProfile;
  readonly status: AdminStatus;
  readonly senha_temporaria?: string;
  readonly area_id?: string | null;
  readonly cargo_id?: string | null;
  readonly especialidades?: string[];
  readonly escopo_ids?: string[];
}
interface ResetBody {
  readonly senha_temporaria: string;
}
interface AreaQuery {
  readonly status?: AdminStatus;
}
interface AreaBody {
  readonly id?: string;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao?: string;
  readonly status: AdminStatus;
  readonly exige_assinatura_padrao: boolean;
}
interface RoleQuery {
  readonly area_id?: string;
  readonly status?: AdminStatus;
}
interface RoleBody {
  readonly id?: string;
  readonly area_id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao?: string;
  readonly status: AdminStatus;
  readonly pode_assinar: boolean;
}
interface PermissionBody {
  readonly permissoes: Record<string, boolean>;
}
interface CompanyBody {
  readonly nome: string;
  readonly logo_data_url: string;
}
interface AuditQuery {
  readonly busca?: string;
  readonly grupo_acao?: string;
  readonly entidade?: string;
  readonly responsavel_id?: string;
  readonly limite?: number;
}
interface ConfigurationBody {
  readonly configuracao: Record<string, string | number | boolean>;
}
interface ConfigurationDraftBody extends ConfigurationBody {
  readonly base_versao_id: string;
}
interface PublishDraftBody {
  readonly rascunho_id: string;
}
interface VersionQuery {
  readonly limite?: number;
}
interface RollbackBody {
  readonly versao_id: string;
  readonly base_versao_id: string;
  readonly motivo: string;
}
interface CommercialPlan {
  readonly codigo: string;
  readonly nome: string;
  readonly recursos: readonly string[];
}
interface CommercialPlansBody {
  readonly planos: CommercialPlan[];
}
interface CommercialDraftBody extends CommercialPlansBody {
  readonly base_versao_id: string;
}

function user(request: FastifyRequest): AuthenticatedUser {
  if (request.auth) return request.auth.user;
  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A sessão autenticada não está disponível.',
    statusCode: 401,
  });
}

function id(params: Params, key: keyof Params): string {
  const value = params[key];
  if (value) return value;
  throw new AppError({
    code: 'ROUTE_IDENTIFIER_MISSING',
    message: 'Identificador obrigatório ausente.',
    statusCode: 400,
  });
}

function audit(request: FastifyRequest) {
  const authenticated = user(request);
  const agent = request.headers['user-agent'];
  return {
    traceId: request.id,
    ipAddress: request.ip,
    userAgent: typeof agent === 'string' ? agent.slice(0, 2_048) : null,
    roleSnapshot: authenticated.roles.join(',') || authenticated.profile,
  };
}

export class AdminController {
  constructor(private readonly service: AdminService) {}

  listUsers = async (request: FastifyRequest<{ Querystring: UserQuery }>) =>
    successEnvelope(
      request,
      'admin.users.list',
      await this.service.listUsers(user(request), {
        search: request.query.busca?.trim() ?? '',
        profile: request.query.perfil ?? null,
        status: request.query.status ?? null,
        limit: request.query.limite ?? 500,
      }),
    );
  createUser = async (request: FastifyRequest<{ Body: UserBody }>) =>
    successEnvelope(
      request,
      'admin.users.create',
      await this.service.saveUser(
        user(request),
        {
          id: null,
          name: request.body.nome,
          email: request.body.email ?? null,
          employeeNumber: request.body.matricula,
          profile: request.body.perfil,
          status: request.body.status,
          temporaryPassword: request.body.senha_temporaria ?? null,
          areaId: request.body.area_id ?? null,
          technicalRoleId: request.body.cargo_id ?? null,
          specialties: request.body.especialidades ?? [],
          scopeIds: request.body.escopo_ids ?? [],
        },
        audit(request),
      ),
    );
  updateUser = async (request: FastifyRequest<{ Params: Params; Body: UserBody }>) =>
    successEnvelope(
      request,
      'admin.users.update',
      await this.service.saveUser(
        user(request),
        {
          id: id(request.params, 'userId'),
          name: request.body.nome,
          email: request.body.email ?? null,
          employeeNumber: request.body.matricula,
          profile: request.body.perfil,
          status: request.body.status,
          temporaryPassword: request.body.senha_temporaria ?? null,
          areaId: request.body.area_id ?? null,
          technicalRoleId: request.body.cargo_id ?? null,
          specialties: request.body.especialidades ?? [],
          scopeIds: request.body.escopo_ids ?? [],
        },
        audit(request),
      ),
    );
  unlockUser = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'admin.users.unlock',
      await this.service.unlockUser(user(request), id(request.params, 'userId'), audit(request)),
    );
  resetPassword = async (request: FastifyRequest<{ Params: Params; Body: ResetBody }>) =>
    successEnvelope(
      request,
      'admin.users.reset-password',
      await this.service.resetPassword(
        user(request),
        id(request.params, 'userId'),
        request.body.senha_temporaria,
        audit(request),
      ),
    );
  revokeSessions = async (request: FastifyRequest<{ Params: Params }>) =>
    successEnvelope(
      request,
      'admin.users.revoke-sessions',
      await this.service.revokeSessions(
        user(request),
        id(request.params, 'userId'),
        audit(request),
      ),
    );
  listAreas = async (request: FastifyRequest<{ Querystring: AreaQuery }>) =>
    successEnvelope(
      request,
      'admin.technical-areas.list',
      await this.service.listAreas(user(request), request.query.status ?? null),
    );
  createArea = async (request: FastifyRequest<{ Body: AreaBody }>) =>
    successEnvelope(
      request,
      'admin.technical-areas.create',
      await this.service.saveArea(
        user(request),
        {
          id: null,
          code: request.body.codigo,
          name: request.body.nome,
          description: request.body.descricao ?? '',
          status: request.body.status,
          defaultSignatureRequired: request.body.exige_assinatura_padrao,
        },
        audit(request),
      ),
    );
  updateArea = async (request: FastifyRequest<{ Params: Params; Body: AreaBody }>) =>
    successEnvelope(
      request,
      'admin.technical-areas.update',
      await this.service.saveArea(
        user(request),
        {
          id: id(request.params, 'areaId'),
          code: request.body.codigo,
          name: request.body.nome,
          description: request.body.descricao ?? '',
          status: request.body.status,
          defaultSignatureRequired: request.body.exige_assinatura_padrao,
        },
        audit(request),
      ),
    );
  listRoles = async (request: FastifyRequest<{ Querystring: RoleQuery }>) =>
    successEnvelope(
      request,
      'admin.technical-roles.list',
      await this.service.listRoles(
        user(request),
        request.query.area_id ?? null,
        request.query.status ?? null,
      ),
    );
  createRole = async (request: FastifyRequest<{ Body: RoleBody }>) =>
    successEnvelope(
      request,
      'admin.technical-roles.create',
      await this.service.saveRole(
        user(request),
        {
          id: null,
          areaId: request.body.area_id,
          code: request.body.codigo,
          name: request.body.nome,
          description: request.body.descricao ?? '',
          status: request.body.status,
          canSign: request.body.pode_assinar,
        },
        audit(request),
      ),
    );
  updateRole = async (request: FastifyRequest<{ Params: Params; Body: RoleBody }>) =>
    successEnvelope(
      request,
      'admin.technical-roles.update',
      await this.service.saveRole(
        user(request),
        {
          id: id(request.params, 'roleId'),
          areaId: request.body.area_id,
          code: request.body.codigo,
          name: request.body.nome,
          description: request.body.descricao ?? '',
          status: request.body.status,
          canSign: request.body.pode_assinar,
        },
        audit(request),
      ),
    );
  permissionMatrix = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'admin.permissions.get',
      await this.service.permissionMatrix(user(request)),
    );
  savePermissions = async (request: FastifyRequest<{ Params: Params; Body: PermissionBody }>) =>
    successEnvelope(
      request,
      'admin.permissions.save',
      await this.service.savePermissions(
        user(request),
        id(request.params, 'profile') as AdminProfile,
        request.body.permissoes,
        audit(request),
      ),
    );
  company = async (request: FastifyRequest) =>
    successEnvelope(request, 'admin.company.get', await this.service.company(user(request)));
  saveCompany = async (request: FastifyRequest<{ Body: CompanyBody }>) =>
    successEnvelope(
      request,
      'admin.company.save',
      await this.service.saveCompany(
        user(request),
        request.body.nome,
        request.body.logo_data_url,
        audit(request),
      ),
    );
  commercialAccess = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'admin.commercial-access.get',
      await this.service.commercialAccess(user(request)),
    );
  configurationState = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'admin.configuration.get',
      await this.service.configurationState(user(request)),
    );
  validateConfiguration = async (request: FastifyRequest<{ Body: ConfigurationBody }>) =>
    successEnvelope(
      request,
      'admin.configuration.validate',
      await Promise.resolve(
        this.service.validateConfiguration(user(request), request.body.configuracao),
      ),
    );
  saveConfigurationDraft = async (request: FastifyRequest<{ Body: ConfigurationDraftBody }>) =>
    successEnvelope(
      request,
      'admin.configuration.draft.save',
      await this.service.saveConfigurationDraft(
        user(request),
        request.body.configuracao,
        request.body.base_versao_id,
        audit(request),
      ),
    );
  listConfigurationVersions = async (request: FastifyRequest<{ Querystring: VersionQuery }>) =>
    successEnvelope(
      request,
      'admin.configuration.versions.list',
      await this.service.listConfigurationVersions(user(request), request.query.limite ?? 50),
    );
  publishConfiguration = async (request: FastifyRequest<{ Body: PublishDraftBody }>) =>
    successEnvelope(
      request,
      'admin.configuration.publish',
      await this.service.publishConfiguration(
        user(request),
        request.body.rascunho_id,
        audit(request),
      ),
    );
  rollbackConfiguration = async (request: FastifyRequest<{ Body: RollbackBody }>) =>
    successEnvelope(
      request,
      'admin.configuration.rollback',
      await this.service.rollbackConfiguration(
        user(request),
        request.body.versao_id,
        request.body.base_versao_id,
        request.body.motivo,
        audit(request),
      ),
    );
  platformMotorCatalog = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'platform.motor.catalog.get',
      await this.service.platformMotorCatalog(user(request)),
    );
  validatePlatformMotorCatalog = async (request: FastifyRequest<{ Body: CommercialPlansBody }>) =>
    successEnvelope(
      request,
      'platform.motor.catalog.validate',
      await Promise.resolve(
        this.service.validatePlatformMotorCatalog(user(request), request.body.planos),
      ),
    );
  savePlatformMotorCatalogDraft = async (request: FastifyRequest<{ Body: CommercialDraftBody }>) =>
    successEnvelope(
      request,
      'platform.motor.catalog.draft.save',
      await this.service.savePlatformMotorCatalogDraft(
        user(request),
        request.body.planos,
        request.body.base_versao_id,
        audit(request),
      ),
    );
  listPlatformMotorCatalogVersions = async (
    request: FastifyRequest<{ Querystring: VersionQuery }>,
  ) =>
    successEnvelope(
      request,
      'platform.motor.catalog.versions.list',
      await this.service.listPlatformMotorCatalogVersions(
        user(request),
        request.query.limite ?? 20,
      ),
    );
  publishPlatformMotorCatalog = async (request: FastifyRequest<{ Body: PublishDraftBody }>) =>
    successEnvelope(
      request,
      'platform.motor.catalog.publish',
      await this.service.publishPlatformMotorCatalog(
        user(request),
        request.body.rascunho_id,
        audit(request),
      ),
    );
  rollbackPlatformMotorCatalog = async (request: FastifyRequest<{ Body: RollbackBody }>) =>
    successEnvelope(
      request,
      'platform.motor.catalog.rollback',
      await this.service.rollbackPlatformMotorCatalog(
        user(request),
        request.body.versao_id,
        request.body.base_versao_id,
        request.body.motivo,
        audit(request),
      ),
    );
  listAudit = async (request: FastifyRequest<{ Querystring: AuditQuery }>) =>
    successEnvelope(
      request,
      'admin.audit.list',
      await this.service.listAudit(user(request), {
        search: request.query.busca?.trim() ?? '',
        actionGroup: request.query.grupo_acao ?? null,
        entityType: request.query.entidade ?? null,
        responsibleId: request.query.responsavel_id ?? null,
        limit: request.query.limite ?? 200,
      }),
    );
  monitoring = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'admin.monitoring.state',
      await this.service.monitoring(user(request)),
    );
  listAnalyses = async (request: FastifyRequest) =>
    successEnvelope(
      request,
      'admin.technical-analyses.list',
      await this.service.listTechnicalAnalyses(user(request)),
    );
  listDemands = async (request: FastifyRequest<{ Querystring: { readonly limite?: number } }>) =>
    successEnvelope(
      request,
      'admin.technical-demands.list',
      await this.service.listTechnicalDemands(user(request), request.query.limite ?? 500),
    );
}
