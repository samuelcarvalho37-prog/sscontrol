import type { Environment } from '../../config/environment.js';
import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import { AuthRepository } from './auth.repository.js';
import type {
  AuthContext,
  AuthenticatedUser,
  FirstAccessInput,
  LoginInput,
  MaintenanceExchangeInput,
  RequestMetadata,
  SessionPurpose,
} from './auth.types.js';
import { verifyMaintenanceCode } from './maintenance-code.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const INVALID_CREDENTIALS = new AppError({
  code: 'AUTH_INVALID_CREDENTIALS',
  message: 'Matrícula ou senha inválida.',
  statusCode: 401,
});

const INVALID_SESSION = new AppError({
  code: 'AUTH_SESSION_INVALID',
  message: 'A sessão é inválida ou expirou.',
  statusCode: 401,
});

type LoginResult =
  | {
      readonly kind: 'AUTHENTICATED';
      readonly accessToken: string;
      readonly expiresAt: Date;
      readonly user: AuthenticatedUser;
    }
  | {
      readonly kind: 'FIRST_ACCESS';
      readonly changeToken: string;
      readonly expiresAt: Date;
      readonly user: AuthenticatedUser;
    }
  | {
      readonly kind: 'REJECTED';
      readonly reason: 'INVALID' | 'LOCKED';
    };

type MaintenanceExchangeResult =
  | {
      readonly kind: 'AUTHENTICATED';
      readonly accessToken: string;
      readonly expiresAt: Date;
      readonly user: AuthenticatedUser;
      readonly windowId: string;
      readonly reason: string;
    }
  | { readonly kind: 'REJECTED'; readonly reason: 'INVALID' | 'LOCKED' };

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

function normalizeEmployeeNumber(employeeNumber: string): string {
  return employeeNumber.trim().toUpperCase();
}

function roleSnapshot(user: AuthenticatedUser): string {
  return user.roles.join(',') || user.profile;
}

export class AuthService {
  private readonly repository = new AuthRepository();
  private readonly passwords: PasswordService;
  private readonly tokens: TokenService;

  constructor(
    private readonly environment: Environment,
    private readonly database: Database,
  ) {
    this.passwords = new PasswordService(environment.auth.passwordPepper);
    this.tokens = new TokenService(environment.auth.recoveryHmacSecret);
  }

  async login(input: LoginInput, metadata: RequestMetadata) {
    const employeeNumber = normalizeEmployeeNumber(input.employeeNumber);
    const employeeNumberDigest = this.tokens.digestEmployeeNumber(employeeNumber);

    const result = await this.database.withTransaction(
      { tenantId: this.environment.defaultTenantId },
      async (client): Promise<LoginResult> => {
        const credential = await this.repository.findCredentialForLogin(
          client,
          this.environment.defaultTenantId,
          employeeNumber,
        );

        if (!credential) {
          await this.passwords.consumeDummyVerification(input.password);
          await this.repository.recordLoginAttempt(client, {
            tenantId: this.environment.defaultTenantId,
            userId: null,
            employeeNumberDigest,
            successful: false,
            failureCode: 'USER_NOT_FOUND',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
          await this.passwords.consumeDummyVerification(input.password);
          await this.repository.recordLoginAttempt(client, {
            tenantId: credential.tenantId,
            userId: credential.userId,
            employeeNumberDigest,
            successful: false,
            failureCode: 'ACCOUNT_LOCKED',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'LOCKED' };
        }

        const usableCredential =
          credential.status === 'ACTIVE' &&
          credential.algorithm === 'ARGON2ID' &&
          credential.passwordHash !== null;
        let passwordMatches = false;
        if (usableCredential && credential.passwordHash) {
          passwordMatches = await this.passwords.verify(credential.passwordHash, input.password);
        } else {
          await this.passwords.consumeDummyVerification(input.password);
        }

        if (!passwordMatches) {
          await this.repository.registerFailedLogin(client, {
            tenantId: credential.tenantId,
            userId: credential.userId,
            maxAttempts: this.environment.auth.maxFailedAttempts,
            lockMinutes: this.environment.auth.lockMinutes,
          });
          await this.repository.recordLoginAttempt(client, {
            tenantId: credential.tenantId,
            userId: credential.userId,
            employeeNumberDigest,
            successful: false,
            failureCode: usableCredential ? 'PASSWORD_MISMATCH' : 'ACCOUNT_UNAVAILABLE',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        const purpose: SessionPurpose = credential.firstAccessRequired
          ? 'FIRST_ACCESS'
          : 'APPLICATION';
        const token = this.tokens.createSessionToken(purpose);
        const expiresAt =
          purpose === 'FIRST_ACCESS'
            ? addMinutes(new Date(), this.environment.auth.firstAccessMinutes)
            : addHours(new Date(), this.environment.auth.sessionHours);
        const identity = await this.repository.resolveUser(client, {
          sessionId: '',
          tenantId: credential.tenantId,
          userId: credential.userId,
          tokenHash: '',
          expiresAt,
          purpose,
          employeeNumber: credential.employeeNumber,
          name: credential.name,
          email: credential.email,
          userStatus: credential.status,
          firstAccessRequired: credential.firstAccessRequired,
          maintenanceWindowId: null,
          maintenanceWindowStatus: null,
          maintenanceWindowEndsAt: null,
          maintenanceReason: null,
        });
        if (identity.roles.length === 0) {
          await this.repository.recordLoginAttempt(client, {
            tenantId: credential.tenantId,
            userId: credential.userId,
            employeeNumberDigest,
            successful: false,
            failureCode: 'ROLE_NOT_ASSIGNED',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        await this.repository.registerSuccessfulLogin(
          client,
          credential.tenantId,
          credential.userId,
        );
        await this.repository.recordLoginAttempt(client, {
          tenantId: credential.tenantId,
          userId: credential.userId,
          employeeNumberDigest,
          successful: true,
          failureCode: null,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });

        const session = await this.repository.createSession(client, {
          tenantId: credential.tenantId,
          userId: credential.userId,
          tokenHash: token.hash,
          purpose,
          environment: this.environment.release.environment,
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
        const user = identity;

        await this.repository.writeAuditEvent(client, {
          tenantId: credential.tenantId,
          userId: credential.userId,
          roleSnapshot: roleSnapshot(user),
          action: 'AUTH_LOGIN_SUCCEEDED',
          entityType: 'iam.sessions',
          entityId: session.id,
          afterData: { purpose, expires_at: expiresAt.toISOString() },
          traceId: metadata.traceId,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        });

        return purpose === 'FIRST_ACCESS'
          ? {
              kind: 'FIRST_ACCESS',
              changeToken: token.raw,
              expiresAt,
              user,
            }
          : {
              kind: 'AUTHENTICATED',
              accessToken: token.raw,
              expiresAt,
              user,
            };
      },
    );

    if (result.kind === 'REJECTED') {
      if (result.reason === 'LOCKED') {
        throw new AppError({
          code: 'AUTH_ACCOUNT_LOCKED',
          message: 'Acesso temporariamente bloqueado. Tente novamente mais tarde.',
          statusCode: 423,
        });
      }
      throw INVALID_CREDENTIALS;
    }

    if (result.kind === 'FIRST_ACCESS') {
      return {
        authenticated: false,
        first_access_required: true,
        requires_password_change: true,
        first_access: true,
        change_token: result.changeToken,
        expires_at: result.expiresAt.toISOString(),
        expira_em: result.expiresAt.toISOString(),
        expira_ms: result.expiresAt.getTime(),
        user: this.publicUser(result.user),
        usuario: this.publicUser(result.user),
        ...this.releaseContract(),
      };
    }

    return {
      authenticated: true,
      first_access_required: false,
      requires_password_change: false,
      first_access: false,
      access_token: result.accessToken,
      token: result.accessToken,
      token_type: 'Bearer',
      expires_at: result.expiresAt.toISOString(),
      expira_em: result.expiresAt.toISOString(),
      expira_ms: result.expiresAt.getTime(),
      user: this.publicUser(result.user),
      usuario: this.publicUser(result.user),
      ...this.releaseContract(),
    };
  }

  async completeFirstAccess(input: FirstAccessInput, metadata: RequestMetadata) {
    this.passwords.assertPolicy(input.newPassword);
    if (input.currentPassword === input.newPassword) {
      throw new AppError({
        code: 'AUTH_PASSWORD_REUSE',
        message: 'A nova senha deve ser diferente da senha atual.',
        statusCode: 422,
      });
    }

    const changeTokenHash = this.tokens.hashSessionToken(input.changeToken);
    const newPasswordHash = await this.passwords.hash(input.newPassword);
    const applicationToken = this.tokens.createSessionToken('APPLICATION');
    const expiresAt = addHours(new Date(), this.environment.auth.sessionHours);

    const result = await this.database.withTransaction(
      { tenantId: this.environment.defaultTenantId },
      async (client) => {
        const session = await this.repository.findSessionByHash(
          client,
          this.environment.defaultTenantId,
          changeTokenHash,
          true,
        );
        if (
          session?.purpose !== 'FIRST_ACCESS' ||
          !session.firstAccessRequired ||
          session.userStatus !== 'ACTIVE'
        ) {
          return null;
        }

        const currentPasswordHash = await this.repository.getPasswordHash(
          client,
          session.tenantId,
          session.userId,
        );
        if (
          !currentPasswordHash ||
          !(await this.passwords.verify(currentPasswordHash, input.currentPassword))
        ) {
          return null;
        }

        await this.repository.changePassword(client, {
          tenantId: session.tenantId,
          userId: session.userId,
          passwordHash: newPasswordHash,
        });
        await this.repository.revokeAllUserSessions(
          client,
          session.tenantId,
          session.userId,
          'FIRST_ACCESS_COMPLETED',
        );
        const createdSession = await this.repository.createSession(client, {
          tenantId: session.tenantId,
          userId: session.userId,
          tokenHash: applicationToken.hash,
          purpose: 'APPLICATION',
          environment: this.environment.release.environment,
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
        const user = await this.repository.resolveUser(client, {
          ...session,
          sessionId: createdSession.id,
          tokenHash: applicationToken.hash,
          expiresAt,
          purpose: 'APPLICATION',
          firstAccessRequired: false,
        });
        await this.repository.writeAuditEvent(client, {
          tenantId: session.tenantId,
          userId: session.userId,
          roleSnapshot: roleSnapshot(user),
          action: 'AUTH_FIRST_ACCESS_COMPLETED',
          entityType: 'iam.users',
          entityId: session.userId,
          afterData: { password_changed: true },
          traceId: metadata.traceId,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        });
        return user;
      },
    );

    if (!result) {
      throw new AppError({
        code: 'AUTH_FIRST_ACCESS_INVALID',
        message: 'O acesso inicial é inválido, expirou ou a senha atual não confere.',
        statusCode: 401,
      });
    }

    return {
      authenticated: true,
      first_access_required: false,
      password_changed: true,
      requires_password_change: false,
      access_token: applicationToken.raw,
      token: applicationToken.raw,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
      expira_em: expiresAt.toISOString(),
      expira_ms: expiresAt.getTime(),
      user: this.publicUser(result),
      usuario: this.publicUser(result),
      ...this.releaseContract(),
    };
  }

  async exchangeMaintenanceAccess(input: MaintenanceExchangeInput, metadata: RequestMetadata) {
    const codeDigest = this.tokens.digestEmployeeNumber(`MAINTENANCE:${input.code}`);
    const result = await this.database.withTransaction(
      { tenantId: this.environment.defaultTenantId },
      async (client): Promise<MaintenanceExchangeResult> => {
        const window = await this.repository.findOpenMaintenanceWindow(
          client,
          this.environment.defaultTenantId,
        );
        if (!window) {
          await this.repository.recordLoginAttempt(client, {
            tenantId: this.environment.defaultTenantId,
            userId: null,
            employeeNumberDigest: codeDigest,
            successful: false,
            failureCode: 'MAINTENANCE_WINDOW_UNAVAILABLE',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        if (window.exchangeLockedUntil && window.exchangeLockedUntil.getTime() > Date.now()) {
          await this.repository.recordLoginAttempt(client, {
            tenantId: window.tenantId,
            userId: window.openedByUserId,
            employeeNumberDigest: codeDigest,
            successful: false,
            failureCode: 'MAINTENANCE_EXCHANGE_LOCKED',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return { kind: 'REJECTED', reason: 'LOCKED' };
        }

        const validCode = verifyMaintenanceCode(
          this.environment.auth.maintenanceHmacSecret,
          input.code,
          window.challengeHash,
        );
        if (!validCode) {
          await this.repository.registerFailedMaintenanceExchange(
            client,
            window.tenantId,
            window.id,
            this.environment.auth.maxFailedAttempts,
            this.environment.auth.lockMinutes,
          );
          await this.repository.recordLoginAttempt(client, {
            tenantId: window.tenantId,
            userId: window.openedByUserId,
            employeeNumberDigest: codeDigest,
            successful: false,
            failureCode: 'MAINTENANCE_CODE_MISMATCH',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          await this.repository.writeAuditEvent(client, {
            tenantId: window.tenantId,
            userId: window.openedByUserId,
            roleSnapshot: null,
            action: 'AUTH_MAINTENANCE_EXCHANGE_REJECTED',
            entityType: 'platform.maintenance_windows',
            entityId: window.id,
            afterData: { failure: 'CODE_MISMATCH' },
            traceId: metadata.traceId,
            userAgent: metadata.userAgent,
            ipAddress: metadata.ipAddress,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        const sessionRecord = {
          sessionId: '',
          tenantId: window.tenantId,
          userId: window.openedByUserId,
          tokenHash: '',
          expiresAt: window.endsAt,
          purpose: 'PLATFORM_MAINTENANCE' as const,
          employeeNumber: window.employeeNumber,
          name: window.name,
          email: window.email,
          userStatus: window.userStatus,
          firstAccessRequired: window.firstAccessRequired,
          maintenanceWindowId: window.id,
          maintenanceWindowStatus: 'OPEN',
          maintenanceWindowEndsAt: window.endsAt,
          maintenanceReason: window.reason,
        };
        const baseUser = await this.repository.resolveUser(client, sessionRecord);
        if (
          window.userStatus !== 'ACTIVE' ||
          window.firstAccessRequired ||
          baseUser.profile !== 'ADMIN'
        ) {
          await this.repository.writeAuditEvent(client, {
            tenantId: window.tenantId,
            userId: window.openedByUserId,
            roleSnapshot: roleSnapshot(baseUser),
            action: 'AUTH_MAINTENANCE_EXCHANGE_REJECTED',
            entityType: 'platform.maintenance_windows',
            entityId: window.id,
            afterData: { failure: 'OPERATOR_NOT_AUTHORIZED' },
            traceId: metadata.traceId,
            userAgent: metadata.userAgent,
            ipAddress: metadata.ipAddress,
          });
          return { kind: 'REJECTED', reason: 'INVALID' };
        }

        const consumed = await this.repository.consumeMaintenanceWindow(
          client,
          window.tenantId,
          window.id,
        );
        if (!consumed) return { kind: 'REJECTED', reason: 'INVALID' };

        const expiresAt = new Date(
          Math.min(
            window.endsAt.getTime(),
            addMinutes(new Date(), this.environment.auth.maintenanceSessionMinutes).getTime(),
          ),
        );
        const token = this.tokens.createSessionToken('PLATFORM_MAINTENANCE');
        const session = await this.repository.createSession(client, {
          tenantId: window.tenantId,
          userId: window.openedByUserId,
          tokenHash: token.hash,
          purpose: 'PLATFORM_MAINTENANCE',
          environment: this.environment.release.environment,
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          maintenanceWindowId: window.id,
          accessIntegral: true,
        });
        const user: AuthenticatedUser = {
          ...baseUser,
          profile: 'SISTEMA',
          roles: Object.freeze(['SYSTEM', ...baseUser.roles]),
        };
        await this.repository.recordLoginAttempt(client, {
          tenantId: window.tenantId,
          userId: window.openedByUserId,
          employeeNumberDigest: codeDigest,
          successful: true,
          failureCode: null,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
        await this.repository.writeAuditEvent(client, {
          tenantId: window.tenantId,
          userId: window.openedByUserId,
          roleSnapshot: 'SYSTEM',
          action: 'AUTH_MAINTENANCE_EXCHANGE_SUCCEEDED',
          entityType: 'platform.maintenance_windows',
          entityId: window.id,
          afterData: { session_id: session.id, expires_at: expiresAt.toISOString() },
          traceId: metadata.traceId,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        });
        return {
          kind: 'AUTHENTICATED',
          accessToken: token.raw,
          expiresAt,
          user,
          windowId: window.id,
          reason: window.reason,
        };
      },
    );

    if (result.kind === 'REJECTED') {
      throw new AppError({
        code: result.reason === 'LOCKED' ? 'AUTH_MAINTENANCE_LOCKED' : 'AUTH_MAINTENANCE_INVALID',
        message:
          result.reason === 'LOCKED'
            ? 'Acesso interno temporariamente bloqueado por tentativas inválidas.'
            : 'Código interno inválido, expirado ou já utilizado.',
        statusCode: result.reason === 'LOCKED' ? 423 : 401,
      });
    }

    return {
      authenticated: true,
      acesso_integral: true,
      access_token: result.accessToken,
      token: result.accessToken,
      token_type: 'Bearer',
      expires_at: result.expiresAt.toISOString(),
      expira_em: result.expiresAt.toISOString(),
      expira_ms: result.expiresAt.getTime(),
      user: this.publicUser(result.user),
      usuario: this.publicUser(result.user),
      manutencao: {
        aberta: true,
        estado: 'OPEN',
        motivo: result.reason,
        expira_em: result.expiresAt.toISOString(),
        janela_id: result.windowId,
        operador_nome: result.user.name,
        ambiente: this.environment.release.environment,
      },
      ...this.releaseContract(),
    };
  }

  async authenticate(rawToken: string): Promise<AuthContext> {
    const tokenHash = this.tokens.hashSessionToken(rawToken);
    const context = await this.database.withTransaction(
      { tenantId: this.environment.defaultTenantId },
      async (client) => {
        const session = await this.repository.findSessionByHash(
          client,
          this.environment.defaultTenantId,
          tokenHash,
          false,
        );
        if (!session || session.firstAccessRequired || session.userStatus !== 'ACTIVE') {
          return null;
        }

        const maintenanceSession = session.purpose === 'PLATFORM_MAINTENANCE';
        if (session.purpose !== 'APPLICATION' && !maintenanceSession) return null;
        if (
          maintenanceSession &&
          (!session.maintenanceWindowId ||
            session.maintenanceWindowStatus !== 'OPEN' ||
            !session.maintenanceWindowEndsAt ||
            session.maintenanceWindowEndsAt.getTime() <= Date.now())
        ) {
          return null;
        }

        const resolvedUser = await this.repository.resolveUser(client, session);
        const user: AuthenticatedUser = maintenanceSession
          ? {
              ...resolvedUser,
              profile: 'SISTEMA',
              roles: Object.freeze(['SYSTEM', ...resolvedUser.roles]),
            }
          : resolvedUser;
        await this.repository.updateLastUsed(client, session.tenantId, session.sessionId);
        return {
          sessionId: session.sessionId,
          tokenHash,
          expiresAt: session.expiresAt,
          purpose: session.purpose,
          maintenanceWindowId: session.maintenanceWindowId,
          maintenanceReason: session.maintenanceReason,
          user,
        } satisfies AuthContext;
      },
    );

    if (!context) throw INVALID_SESSION;
    return context;
  }

  async logout(context: AuthContext, metadata: RequestMetadata): Promise<void> {
    await this.database.withTransaction(
      { tenantId: context.user.tenantId, userId: context.user.id },
      async (client) => {
        await this.repository.revokeSession(
          client,
          context.user.tenantId,
          context.sessionId,
          'USER_LOGOUT',
        );
        await this.repository.writeAuditEvent(client, {
          tenantId: context.user.tenantId,
          userId: context.user.id,
          roleSnapshot: roleSnapshot(context.user),
          action: 'AUTH_LOGOUT',
          entityType: 'iam.sessions',
          entityId: context.sessionId,
          traceId: metadata.traceId,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        });
      },
    );
  }

  async requestRecovery(
    employeeNumberInput: string,
    metadata: RequestMetadata,
  ): Promise<{
    readonly accepted: true;
    readonly request_id: string;
    readonly message: string;
    readonly release_version: string;
  }> {
    const startedAt = performance.now();
    const employeeNumber = normalizeEmployeeNumber(employeeNumberInput);
    const employeeNumberDigest = this.tokens.digestEmployeeNumber(employeeNumber);
    // A referência sempre é gerada para não revelar se a matrícula existe.
    const recoveryMaterial = this.tokens.createRecoveryMaterial();

    await this.database.withTransaction(
      { tenantId: this.environment.defaultTenantId },
      async (client) => {
        const credential = await this.repository.findCredentialForLogin(
          client,
          this.environment.defaultTenantId,
          employeeNumber,
        );
        if (credential?.status !== 'ACTIVE') {
          await this.repository.recordLoginAttempt(client, {
            tenantId: this.environment.defaultTenantId,
            userId: credential?.userId ?? null,
            employeeNumberDigest,
            successful: false,
            failureCode: 'RECOVERY_REQUESTED',
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          });
          return;
        }

        const recent = await this.repository.hasRecentRecoveryRequest(
          client,
          credential.tenantId,
          credential.userId,
          this.environment.auth.recoveryCooldownMinutes,
        );
        if (recent) return;

        await this.repository.createRecoveryRequest(client, {
          tenantId: credential.tenantId,
          userId: credential.userId,
          publicReference: recoveryMaterial.publicReference,
          secretHash: recoveryMaterial.secretHash,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
        await this.repository.writeAuditEvent(client, {
          tenantId: credential.tenantId,
          userId: credential.userId,
          roleSnapshot: null,
          action: 'AUTH_RECOVERY_REQUESTED',
          entityType: 'iam.recovery_requests',
          entityId: recoveryMaterial.publicReference,
          traceId: metadata.traceId,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        });
      },
    );

    const remainingDelay = 250 - (performance.now() - startedAt);
    if (remainingDelay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remainingDelay);
      });
    }

    return {
      accepted: true,
      request_id: recoveryMaterial.publicReference,
      message: 'Se a matrícula estiver ativa, a solicitação será encaminhada ao administrador.',
      release_version: this.environment.release.app,
    };
  }

  session(context: AuthContext) {
    return {
      authenticated: true,
      expires_at: context.expiresAt.toISOString(),
      user: this.publicUser(context.user),
      acesso_integral: context.purpose === 'PLATFORM_MAINTENANCE',
      manutencao:
        context.purpose === 'PLATFORM_MAINTENANCE'
          ? {
              aberta: true,
              estado: 'OPEN',
              motivo: context.maintenanceReason,
              expira_em: context.expiresAt.toISOString(),
              janela_id: context.maintenanceWindowId,
              ambiente: this.environment.release.environment,
            }
          : null,
      ...this.releaseContract(),
    };
  }

  private publicUser(user: AuthenticatedUser) {
    return {
      id: user.id,
      matricula: user.employeeNumber,
      nome: user.name,
      email: user.email,
      perfil: user.profile,
      area_id: user.areaId,
      cargo_tecnico_id: user.technicalRoleId,
      papeis: user.roles,
      capacidades: user.capabilities,
    };
  }

  private releaseContract() {
    return {
      release_version: this.environment.release.app,
      api_version: this.environment.release.api,
      schema_version: this.environment.release.schema,
      contract_version: this.environment.release.contract,
      frontend_version: this.environment.release.frontend,
      warmup_required: true,
      warmup_action: 'sistema.warmup',
    } as const;
  }
}
