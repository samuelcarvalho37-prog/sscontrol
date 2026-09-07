export type DocumentType =
  | 'MANUAL'
  | 'DIAGRAMA'
  | 'CERTIFICADO'
  | 'LAUDO'
  | 'PROCEDIMENTO'
  | 'FICHA_TECNICA'
  | 'OUTRO';

export type DocumentEntityType = 'EMPRESA' | 'PLANTA' | 'SETOR' | 'LINHA' | 'ATIVO' | 'COMPONENTE';

export type DocumentStatus = 'RASCUNHO' | 'EM_REVISAO' | 'VIGENTE' | 'OBSOLETO';

export interface DocumentMetadataInput {
  readonly documentId: string | null;
  readonly code: string | null;
  readonly title: string;
  readonly documentType: DocumentType;
  readonly entityType: DocumentEntityType;
  readonly entityId: string | null;
  readonly status: DocumentStatus;
  readonly validUntil: string | null;
  readonly responsibleId: string | null;
  readonly description: string | null;
  readonly observation: string | null;
}

export interface DocumentFileInput {
  readonly originalName: string;
  readonly mediaType: string;
  readonly encodedData: string;
}

export interface GovernanceAuditMetadata {
  readonly traceId: string;
  readonly userAgent: string | null;
  readonly ipAddress: string;
  readonly roleSnapshot: string;
}
