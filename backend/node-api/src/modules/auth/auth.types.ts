export type SessionPurpose = 'APPLICATION' | 'FIRST_ACCESS' | 'PLATFORM_MAINTENANCE';

export interface AuthenticatedUser {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly profile: 'ADMIN' | 'GESTOR' | 'OPERADOR' | 'SISTEMA';
  readonly areaId: string | null;
  readonly technicalRoleId: string | null;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
}

export interface AuthContext {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly purpose: SessionPurpose;
  readonly maintenanceWindowId: string | null;
  readonly maintenanceReason: string | null;
  readonly user: AuthenticatedUser;
}

export interface RequestMetadata {
  readonly ipAddress: string;
  readonly userAgent: string | null;
  readonly traceId: string;
}

export interface LoginInput {
  readonly employeeNumber: string;
  readonly password: string;
}

export interface FirstAccessInput {
  readonly changeToken: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface MaintenanceExchangeInput {
  readonly code: string;
}
