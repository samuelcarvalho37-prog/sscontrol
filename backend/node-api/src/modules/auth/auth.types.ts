export type SessionPurpose = 'APPLICATION' | 'FIRST_ACCESS' | 'PLATFORM_MAINTENANCE';
export type RoleType = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'CUSTOM';

export interface AuthenticatedUser {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly profile: string;
  readonly primaryRoleCode: string | null;
  readonly roleCodes: readonly string[];
  readonly roleType: RoleType | null;
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
  readonly host: string | undefined;
  readonly developmentTenantSlug: string | undefined;
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
