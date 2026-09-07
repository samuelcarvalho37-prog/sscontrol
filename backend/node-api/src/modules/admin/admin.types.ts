export type AdminProfile = 'ADMIN' | 'GESTOR' | 'OPERADOR';
export type AdminStatus = 'ATIVO' | 'INATIVO';

export interface AdminAuditMetadata {
  readonly traceId: string;
  readonly ipAddress: string;
  readonly userAgent: string | null;
  readonly roleSnapshot: string;
}

export interface UserListQuery {
  readonly search: string;
  readonly profile: AdminProfile | null;
  readonly status: AdminStatus | null;
  readonly limit: number;
}

export interface SaveUserInput {
  readonly id: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly employeeNumber: string;
  readonly profile: AdminProfile;
  readonly status: AdminStatus;
  readonly temporaryPassword: string | null;
  readonly areaId: string | null;
  readonly technicalRoleId: string | null;
  readonly specialties: readonly string[];
  readonly scopeIds: readonly string[];
}

export interface SaveTechnicalAreaInput {
  readonly id: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: AdminStatus;
  readonly defaultSignatureRequired: boolean;
}

export interface SaveTechnicalRoleInput {
  readonly id: string | null;
  readonly areaId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: AdminStatus;
  readonly canSign: boolean;
}

export interface AuditListQuery {
  readonly search: string;
  readonly actionGroup: string | null;
  readonly entityType: string | null;
  readonly responsibleId: string | null;
  readonly limit: number;
}

export type AdminRow = Record<string, unknown>;
