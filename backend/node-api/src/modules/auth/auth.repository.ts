import type { PoolClient, QueryResultRow } from 'pg';

import type { AuthenticatedUser, SessionPurpose } from './auth.types.js';

export interface CredentialRecord {
  readonly userId: string;
  readonly tenantId: string;
  readonly employeeNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'ARCHIVED';
  readonly firstAccessRequired: boolean;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly credentialId: string | null;
  readonly algorithm: string | null;
  readonly passwordHash: string | null;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly purpose: SessionPurpose;
  readonly employeeNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly userStatus: string;
  readonly firstAccessRequired: boolean;
  readonly maintenanceWindowId: string | null;
  readonly maintenanceWindowStatus: string | null;
  readonly maintenanceWindowEndsAt: Date | null;
  readonly maintenanceReason: string | null;
}

export interface MaintenanceWindowRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly reason: string;
  readonly endsAt: Date;
  readonly challengeHash: string;
  readonly failedExchangeAttempts: number;
  readonly exchangeLockedUntil: Date | null;
  readonly openedByUserId: string;
  readonly employeeNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly userStatus: string;
  readonly firstAccessRequired: boolean;
}

interface CredentialRow extends QueryResultRow {
  user_id: string;
  tenant_id: string;
  employee_number: string;
  name: string;
  email: string | null;
  status: CredentialRecord['status'];
  first_access_required: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  credential_id: string | null;
  algorithm: string | null;
  password_hash: string | null;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  tenant_id: string;
  user_id: string;
  token_hash_sha256: string;
  expires_at: Date;
  purpose: SessionPurpose;
  employee_number: string;
  name: string;
  email: string | null;
  user_status: string;
  first_access_required: boolean;
  maintenance_window_id: string | null;
  maintenance_window_status: string | null;
  maintenance_window_ends_at: Date | null;
  maintenance_reason: string | null;
}

interface MaintenanceWindowRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  reason: string;
  ends_at: Date;
  challenge_hash: string;
  failed_exchange_attempts: number;
  exchange_locked_until: Date | null;
  opened_by_user_id: string;
  employee_number: string;
  name: string;
  email: string | null;
  user_status: string;
  first_access_required: boolean;
}

interface RoleRow extends QueryResultRow {
  code: string;
  role_type: 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'CUSTOM';
}

interface CapabilityRow extends QueryResultRow {
  code: string;
}

interface AssignmentRow extends QueryResultRow {
  technical_area_id: string;
  technical_role_id: string | null;
}

function mapCredential(row: CredentialRow): CredentialRecord {
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    employeeNumber: row.employee_number,
    name: row.name,
    email: row.email,
    status: row.status,
    firstAccessRequired: row.first_access_required,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    credentialId: row.credential_id,
    algorithm: row.algorithm,
    passwordHash: row.password_hash,
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    tokenHash: row.token_hash_sha256,
    expiresAt: row.expires_at,
    purpose: row.purpose,
    employeeNumber: row.employee_number,
    name: row.name,
    email: row.email,
    userStatus: row.user_status,
    firstAccessRequired: row.first_access_required,
    maintenanceWindowId: row.maintenance_window_id,
    maintenanceWindowStatus: row.maintenance_window_status,
    maintenanceWindowEndsAt: row.maintenance_window_ends_at,
    maintenanceReason: row.maintenance_reason,
  };
}

function mapMaintenanceWindow(row: MaintenanceWindowRow): MaintenanceWindowRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reason: row.reason,
    endsAt: row.ends_at,
    challengeHash: row.challenge_hash,
    failedExchangeAttempts: row.failed_exchange_attempts,
    exchangeLockedUntil: row.exchange_locked_until,
    openedByUserId: row.opened_by_user_id,
    employeeNumber: row.employee_number,
    name: row.name,
    email: row.email,
    userStatus: row.user_status,
    firstAccessRequired: row.first_access_required,
  };
}

function profileFromRoles(roles: readonly RoleRow[]): AuthenticatedUser['profile'] {
  if (roles.some((role) => role.role_type === 'ADMIN')) return 'ADMIN';
  if (roles.some((role) => role.role_type === 'MANAGER')) return 'GESTOR';
  return 'OPERADOR';
}

export class AuthRepository {
  async findCredentialForLogin(
    client: PoolClient,
    tenantId: string,
    employeeNumber: string,
  ): Promise<CredentialRecord | null> {
    const result = await client.query<CredentialRow>(
      `
        SELECT
          user_account.id AS user_id,
          user_account.tenant_id,
          user_account.employee_number,
          user_account.name,
          user_account.email,
          user_account.status,
          user_account.first_access_required,
          user_account.failed_login_attempts,
          user_account.locked_until,
          credential.id AS credential_id,
          credential.algorithm,
          credential.password_hash
        FROM iam.users user_account
        LEFT JOIN iam.credentials credential
          ON credential.tenant_id = user_account.tenant_id
         AND credential.user_id = user_account.id
         AND credential.credential_type = 'PASSWORD'
         AND credential.revoked_at IS NULL
        WHERE user_account.tenant_id = $1
          AND upper(user_account.employee_number) = upper($2)
          AND user_account.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF user_account
      `,
      [tenantId, employeeNumber],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : null;
  }

  async findSessionByHash(
    client: PoolClient,
    tenantId: string,
    tokenHash: string,
    lock: boolean,
  ): Promise<SessionRecord | null> {
    const result = await client.query<SessionRow>(
      `
        SELECT
          session.id AS session_id,
          session.tenant_id,
          session.user_id,
          session.token_hash_sha256,
          session.expires_at,
          COALESCE(session.scope->>'purpose', 'APPLICATION') AS purpose,
          user_account.employee_number,
          user_account.name,
          user_account.email,
          user_account.status AS user_status,
          user_account.first_access_required,
          session.maintenance_window_id,
          maintenance.status AS maintenance_window_status,
          maintenance.ends_at AS maintenance_window_ends_at,
          maintenance.reason AS maintenance_reason
        FROM iam.sessions session
        JOIN iam.users user_account
          ON user_account.tenant_id = session.tenant_id
         AND user_account.id = session.user_id
        LEFT JOIN platform.maintenance_windows maintenance
          ON maintenance.tenant_id = session.tenant_id
         AND maintenance.id = session.maintenance_window_id
        WHERE session.tenant_id = $1
          AND session.token_hash_sha256 = $2
          AND session.status = 'ACTIVE'
          AND session.revoked_at IS NULL
          AND session.expires_at > clock_timestamp()
          AND user_account.deleted_at IS NULL
        LIMIT 1
        ${lock ? 'FOR UPDATE OF session' : ''}
      `,
      [tenantId, tokenHash],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async resolveUser(client: PoolClient, session: SessionRecord): Promise<AuthenticatedUser> {
    const rolesResult = await client.query<RoleRow>(
      `
          SELECT role.code, role.role_type
          FROM iam.user_roles user_role
          JOIN iam.roles role
            ON role.tenant_id = user_role.tenant_id
           AND role.id = user_role.role_id
          WHERE user_role.tenant_id = $1
            AND user_role.user_id = $2
            AND user_role.valid_from <= clock_timestamp()
            AND (user_role.valid_until IS NULL OR user_role.valid_until > clock_timestamp())
            AND role.status = 'ACTIVE'
            AND role.deleted_at IS NULL
          ORDER BY role.code
        `,
      [session.tenantId, session.userId],
    );
    const capabilitiesResult = await client.query<CapabilityRow>(
      `
          WITH decisions AS (
            SELECT capability.code, role_capability.effect
            FROM iam.user_roles user_role
            JOIN iam.roles role
              ON role.tenant_id = user_role.tenant_id
             AND role.id = user_role.role_id
            JOIN iam.role_capabilities role_capability
              ON role_capability.tenant_id = role.tenant_id
             AND role_capability.role_id = role.id
            JOIN iam.capabilities capability
              ON capability.id = role_capability.capability_id
            WHERE user_role.tenant_id = $1
              AND user_role.user_id = $2
              AND user_role.valid_from <= clock_timestamp()
              AND (user_role.valid_until IS NULL OR user_role.valid_until > clock_timestamp())
              AND role.status = 'ACTIVE'
              AND role.deleted_at IS NULL
              AND capability.status = 'ACTIVE'

            UNION ALL

            SELECT capability.code, user_capability.effect
            FROM iam.user_capabilities user_capability
            JOIN iam.capabilities capability
              ON capability.id = user_capability.capability_id
            WHERE user_capability.tenant_id = $1
              AND user_capability.user_id = $2
              AND user_capability.valid_from <= clock_timestamp()
              AND (
                user_capability.valid_until IS NULL
                OR user_capability.valid_until > clock_timestamp()
              )
              AND capability.status = 'ACTIVE'
          )
          SELECT code
          FROM decisions
          GROUP BY code
          HAVING bool_or(effect = 'ALLOW') AND NOT bool_or(effect = 'DENY')
          ORDER BY code
        `,
      [session.tenantId, session.userId],
    );
    const assignmentResult = await client.query<AssignmentRow>(
      `
          SELECT technical_area_id, technical_role_id
          FROM iam.user_technical_assignments
          WHERE tenant_id = $1
            AND user_id = $2
            AND status = 'ACTIVE'
            AND valid_from <= clock_timestamp()
            AND (valid_until IS NULL OR valid_until > clock_timestamp())
          ORDER BY is_primary DESC, created_at
          LIMIT 1
        `,
      [session.tenantId, session.userId],
    );

    const assignment = assignmentResult.rows[0];
    return {
      id: session.userId,
      tenantId: session.tenantId,
      employeeNumber: session.employeeNumber,
      name: session.name,
      email: session.email,
      profile: profileFromRoles(rolesResult.rows),
      areaId: assignment?.technical_area_id ?? null,
      technicalRoleId: assignment?.technical_role_id ?? null,
      roles: rolesResult.rows.map((role) => role.code),
      capabilities: capabilitiesResult.rows.map((capability) => capability.code),
    };
  }

  async createSession(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string;
      readonly tokenHash: string;
      readonly purpose: SessionPurpose;
      readonly environment: string;
      readonly expiresAt: Date;
      readonly ipAddress: string;
      readonly userAgent: string | null;
      readonly maintenanceWindowId?: string | null;
      readonly accessIntegral?: boolean;
    },
  ): Promise<{ readonly id: string }> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO iam.sessions (
          tenant_id,
          user_id,
          token_hash_sha256,
          environment,
          scope,
          user_agent,
          ip_address,
          expires_at,
          maintenance_window_id
        )
        VALUES (
          $1, $2, $3, $4,
          jsonb_build_object('purpose', $5::text, 'access_integral', $9::boolean),
          $6, $7, $8, $10
        )
        RETURNING id
      `,
      [
        input.tenantId,
        input.userId,
        input.tokenHash,
        input.environment,
        input.purpose,
        input.userAgent,
        input.ipAddress,
        input.expiresAt,
        input.accessIntegral ?? false,
        input.maintenanceWindowId ?? null,
      ],
    );
    const createdSession = result.rows[0];
    if (!createdSession) {
      throw new Error('O PostgreSQL não retornou a sessão criada.');
    }
    return createdSession;
  }

  async findOpenMaintenanceWindow(
    client: PoolClient,
    tenantId: string,
  ): Promise<MaintenanceWindowRecord | null> {
    await client.query(
      `UPDATE platform.maintenance_windows
       SET status='EXPIRED'
       WHERE tenant_id=$1 AND status='OPEN' AND ends_at <= clock_timestamp()`,
      [tenantId],
    );
    const result = await client.query<MaintenanceWindowRow>(
      `SELECT maintenance_window.id,maintenance_window.tenant_id,maintenance_window.reason,
              maintenance_window.ends_at,maintenance_window.challenge_hash,
              maintenance_window.failed_exchange_attempts,
              maintenance_window.exchange_locked_until,
              maintenance_window.opened_by AS opened_by_user_id,
              user_account.employee_number,user_account.name,user_account.email,
              user_account.status AS user_status,user_account.first_access_required
       FROM platform.maintenance_windows maintenance_window
       JOIN iam.users user_account
         ON user_account.tenant_id=maintenance_window.tenant_id
        AND user_account.id=maintenance_window.opened_by
       WHERE maintenance_window.tenant_id=$1
         AND maintenance_window.status='OPEN'
         AND maintenance_window.starts_at <= clock_timestamp()
         AND maintenance_window.ends_at > clock_timestamp()
         AND maintenance_window.single_use_consumed_at IS NULL
         AND maintenance_window.challenge_hash IS NOT NULL
         AND user_account.deleted_at IS NULL
       LIMIT 1
       FOR UPDATE OF maintenance_window`,
      [tenantId],
    );
    return result.rows[0] ? mapMaintenanceWindow(result.rows[0]) : null;
  }

  async registerFailedMaintenanceExchange(
    client: PoolClient,
    tenantId: string,
    windowId: string,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<void> {
    await client.query(
      `UPDATE platform.maintenance_windows
       SET failed_exchange_attempts=failed_exchange_attempts + 1,
           exchange_locked_until=CASE
             WHEN failed_exchange_attempts + 1 >= $3
               THEN clock_timestamp() + make_interval(mins => $4)
             ELSE exchange_locked_until
           END
       WHERE tenant_id=$1 AND id=$2 AND status='OPEN'`,
      [tenantId, windowId, maxAttempts, lockMinutes],
    );
  }

  async consumeMaintenanceWindow(
    client: PoolClient,
    tenantId: string,
    windowId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE platform.maintenance_windows
       SET single_use_consumed_at=clock_timestamp(),
           failed_exchange_attempts=0,
           exchange_locked_until=NULL
       WHERE tenant_id=$1 AND id=$2 AND status='OPEN'
         AND single_use_consumed_at IS NULL
         AND ends_at > clock_timestamp()
       RETURNING id`,
      [tenantId, windowId],
    );
    return result.rowCount === 1;
  }

  async recordLoginAttempt(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string | null;
      readonly employeeNumberDigest: string;
      readonly successful: boolean;
      readonly failureCode: string | null;
      readonly ipAddress: string;
      readonly userAgent: string | null;
    },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO iam.login_attempts (
          tenant_id,
          user_id,
          employee_number_digest,
          successful,
          failure_code,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.tenantId,
        input.userId,
        input.employeeNumberDigest,
        input.successful,
        input.failureCode,
        input.ipAddress,
        input.userAgent,
      ],
    );
  }

  async registerFailedLogin(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string;
      readonly maxAttempts: number;
      readonly lockMinutes: number;
    },
  ): Promise<void> {
    await client.query(
      `
        UPDATE iam.users
        SET
          failed_login_attempts = failed_login_attempts + 1,
          locked_until = CASE
            WHEN failed_login_attempts + 1 >= $3
              THEN clock_timestamp() + make_interval(mins => $4)
            ELSE locked_until
          END
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, input.userId, input.maxAttempts, input.lockMinutes],
    );
  }

  async registerSuccessfulLogin(
    client: PoolClient,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE iam.users
        SET
          failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = clock_timestamp()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, userId],
    );
  }

  async updateLastUsed(client: PoolClient, tenantId: string, sessionId: string): Promise<void> {
    await client.query(
      `
        UPDATE iam.sessions
        SET last_used_at = clock_timestamp()
        WHERE tenant_id = $1
          AND id = $2
          AND (
            last_used_at IS NULL
            OR last_used_at < clock_timestamp() - interval '1 minute'
          )
      `,
      [tenantId, sessionId],
    );
  }

  async revokeSession(
    client: PoolClient,
    tenantId: string,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE iam.sessions
        SET
          status = 'REVOKED',
          revoked_at = clock_timestamp(),
          revocation_reason = $3
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'ACTIVE'
      `,
      [tenantId, sessionId, reason],
    );
  }

  async revokeAllUserSessions(
    client: PoolClient,
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE iam.sessions
        SET
          status = 'REVOKED',
          revoked_at = clock_timestamp(),
          revocation_reason = $3
        WHERE tenant_id = $1
          AND user_id = $2
          AND status = 'ACTIVE'
      `,
      [tenantId, userId, reason],
    );
  }

  async getPasswordHash(
    client: PoolClient,
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const result = await client.query<{ password_hash: string | null }>(
      `
        SELECT password_hash
        FROM iam.credentials
        WHERE tenant_id = $1
          AND user_id = $2
          AND credential_type = 'PASSWORD'
          AND revoked_at IS NULL
        LIMIT 1
        FOR UPDATE
      `,
      [tenantId, userId],
    );
    return result.rows[0]?.password_hash ?? null;
  }

  async changePassword(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string;
      readonly passwordHash: string;
    },
  ): Promise<void> {
    await client.query(
      `
        UPDATE iam.credentials
        SET
          algorithm = 'ARGON2ID',
          password_hash = $3,
          legacy_hash = NULL,
          legacy_algorithm = NULL,
          legacy_migration_status = 'REHASHED'
        WHERE tenant_id = $1
          AND user_id = $2
          AND credential_type = 'PASSWORD'
          AND revoked_at IS NULL
      `,
      [input.tenantId, input.userId, input.passwordHash],
    );
    await client.query(
      `
        UPDATE iam.users
        SET
          first_access_required = false,
          password_changed_at = clock_timestamp(),
          failed_login_attempts = 0,
          locked_until = NULL
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, input.userId],
    );
  }

  async hasRecentRecoveryRequest(
    client: PoolClient,
    tenantId: string,
    userId: string,
    cooldownMinutes: number,
  ): Promise<boolean> {
    const result = await client.query<{ recent: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM iam.recovery_requests
          WHERE tenant_id = $1
            AND user_id = $2
            AND created_at > clock_timestamp() - make_interval(mins => $3)
        ) AS recent
      `,
      [tenantId, userId, cooldownMinutes],
    );
    return result.rows[0]?.recent ?? false;
  }

  async createRecoveryRequest(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string;
      readonly publicReference: string;
      readonly secretHash: string;
      readonly ipAddress: string;
      readonly userAgent: string | null;
    },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO iam.recovery_requests (
          tenant_id,
          user_id,
          public_reference,
          secret_hash_sha256,
          requested_ip,
          requested_user_agent,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + interval '24 hours')
      `,
      [
        input.tenantId,
        input.userId,
        input.publicReference,
        input.secretHash,
        input.ipAddress,
        input.userAgent,
      ],
    );
    await client.query(
      `
        UPDATE iam.users
        SET
          recovery_reference = $3,
          recovery_requested_at = clock_timestamp()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, input.userId, input.publicReference],
    );
  }

  async writeAuditEvent(
    client: PoolClient,
    input: {
      readonly tenantId: string;
      readonly userId: string | null;
      readonly roleSnapshot: string | null;
      readonly action: string;
      readonly entityType: string;
      readonly entityId: string | null;
      readonly afterData?: Readonly<Record<string, unknown>>;
      readonly traceId: string;
      readonly userAgent: string | null;
      readonly ipAddress: string;
    },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO audit.events (
          tenant_id,
          user_id,
          role_snapshot,
          action,
          entity_type,
          entity_id,
          after_data,
          redacted_fields,
          trace_id,
          source,
          user_agent,
          ip_address
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          ARRAY['password', 'password_hash', 'token', 'token_hash_sha256'],
          $8, 'APPLICATION', $9, $10
        )
      `,
      [
        input.tenantId,
        input.userId,
        input.roleSnapshot,
        input.action,
        input.entityType,
        input.entityId,
        input.afterData ? JSON.stringify(input.afterData) : null,
        input.traceId,
        input.userAgent,
        input.ipAddress,
      ],
    );
  }
}
