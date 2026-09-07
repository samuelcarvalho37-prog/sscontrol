import type { FastifyRequest } from 'fastify';

import { AppError } from '../../core/errors/app-error.js';
import { successEnvelope } from '../../core/http/envelope.js';
import type { AuthService } from './auth.service.js';
import type { AuthContext, RequestMetadata } from './auth.types.js';

interface LoginBody {
  readonly matricula: string;
  readonly senha: string;
}

interface FirstAccessBody {
  readonly change_token: string;
  readonly senha_atual: string;
  readonly nova_senha: string;
}

interface RecoveryBody {
  readonly matricula: string;
}

interface MaintenanceExchangeBody {
  readonly codigo: string;
}

function requestMetadata(request: FastifyRequest): RequestMetadata {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 2_048) : null,
    traceId: request.id,
  };
}

function authenticatedContext(request: FastifyRequest): AuthContext {
  if (request.auth) return request.auth;

  throw new AppError({
    code: 'AUTH_CONTEXT_MISSING',
    message: 'A identidade da sessão não está disponível.',
    statusCode: 401,
  });
}

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (request: FastifyRequest<{ Body: LoginBody }>) =>
    successEnvelope(
      request,
      'auth.login',
      await this.service.login(
        {
          employeeNumber: request.body.matricula,
          password: request.body.senha,
        },
        requestMetadata(request),
      ),
    );

  completeFirstAccess = async (request: FastifyRequest<{ Body: FirstAccessBody }>) =>
    successEnvelope(
      request,
      'auth.first-access',
      await this.service.completeFirstAccess(
        {
          changeToken: request.body.change_token,
          currentPassword: request.body.senha_atual,
          newPassword: request.body.nova_senha,
        },
        requestMetadata(request),
      ),
    );

  requestRecovery = async (request: FastifyRequest<{ Body: RecoveryBody }>) =>
    successEnvelope(
      request,
      'auth.recovery',
      await this.service.requestRecovery(request.body.matricula, requestMetadata(request)),
    );

  exchangeMaintenanceAccess = async (request: FastifyRequest<{ Body: MaintenanceExchangeBody }>) =>
    successEnvelope(
      request,
      'auth.maintenance.exchange',
      await this.service.exchangeMaintenanceAccess(
        { code: request.body.codigo },
        requestMetadata(request),
      ),
    );

  logout = async (request: FastifyRequest) => {
    await this.service.logout(authenticatedContext(request), requestMetadata(request));
    return successEnvelope(request, 'auth.logout', { logged_out: true });
  };

  session = (request: FastifyRequest) =>
    successEnvelope(request, 'auth.session', this.service.session(authenticatedContext(request)));
}
