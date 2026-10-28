export interface BackupTable {
  readonly name: string;
}

export const BACKUP_FORMAT = 'FAB_CONTROL_TENANT_BACKUP_V2';
export const LEGACY_BACKUP_FORMAT = 'FAB_CONTROL_TENANT_BACKUP_V1';

export const backupScopes = Object.freeze([
  Object.freeze({
    id: 'OPERACIONAL',
    label: 'Dados operacionais',
    description: 'Estrutura, ativos, manutenção, almoxarifado e operação da empresa.',
    tables: Object.freeze([
      'cmms.plants',
      'cmms.sectors',
      'cmms.lines',
      'cmms.assets',
      'cmms.components',
      'cmms.materials',
      'cmms.material_value_sources',
      'cmms.parameter_definitions',
      'cmms.parameter_policies',
      'cmms.parameter_readings',
      'maintenance.checklist_templates',
      'maintenance.checklist_template_versions',
      'maintenance.checklist_version_validator_users',
      'maintenance.checklist_items',
      'maintenance.checklist_model_reviews',
      'maintenance.checklist_model_audit',
      'maintenance.maintenance_plans',
      'maintenance.maintenance_plan_versions',
      'maintenance.work_orders',
      'maintenance.plan_trigger_state',
      'maintenance.work_order_actions',
      'maintenance.executions',
      'maintenance.execution_checklist_items',
      'maintenance.evidence',
      'maintenance.material_usage',
      'maintenance.equipment_stops',
      'maintenance.maintenance_stops',
      'maintenance.operational_occurrences',
      'maintenance.operational_alerts',
      'maintenance.history_events',
      'maintenance.execution_locks',
      'maintenance.telemetry_sessions',
      'maintenance.shifts',
      'maintenance.production_entries',
      'workflow.service_calendars',
      'workflow.service_calendar_windows',
      'workflow.service_calendar_holidays',
      'workflow.sla_policies',
      'workflow.technical_demands',
      'workflow.demand_validator_requirements',
      'workflow.demand_events',
      'workflow.technical_signatures',
      'workflow.technical_signature_revocations',
      'workflow.technical_analyses',
      'workflow.notifications',
      'workflow.notification_recipients',
      'governance.technical_documents',
      'governance.document_revisions',
    ]),
  }),
  Object.freeze({
    id: 'IMPORTACOES',
    label: 'Histórico e linhas de importação',
    description: 'Lotes, dados das linhas lidas e registros de validação; não inclui o arquivo original.',
    tables: Object.freeze([
      'governance.import_batches',
      'governance.import_records',
      'governance.legacy_quarantine',
    ]),
  }),
  Object.freeze({
    id: 'ACESSOS',
    label: 'Permissões dos perfis',
    description: 'Permissões atribuídas a perfis e exceções por usuário; contas e senhas ficam intactas.',
    tables: Object.freeze(['iam.role_capabilities', 'iam.user_capabilities']),
  }),
  Object.freeze({
    id: 'CONFIGURACOES',
    label: 'Configurações versionadas',
    description: 'Versões e rascunhos de configuração do ambiente.',
    tables: Object.freeze(['platform.configuration_versions', 'platform.configuration_drafts']),
  }),
] as const);

export type BackupScopeId = (typeof backupScopes)[number]['id'];

export const defaultBackupScopes: readonly BackupScopeId[] = Object.freeze(['OPERACIONAL', 'IMPORTACOES']);

export function normalizeBackupScopes(scopes: readonly string[] | undefined): readonly BackupScopeId[] {
  if (scopes === undefined) return defaultBackupScopes;
  if (scopes.length === 0) throw new Error('Selecione pelo menos um escopo de backup.');
  const available = new Set<string>(backupScopes.map((scope) => scope.id));
  const normalized = [...new Set(scopes)];
  if (normalized.some((scope) => !available.has(scope))) {
    throw new Error('Escopo de backup inválido.');
  }
  return normalized as BackupScopeId[];
}

export function backupTablesForScopes(scopes: readonly string[]): readonly BackupTable[] {
  const selected = new Set(scopes);
  const tables = backupScopes
    .filter((scope) => selected.has(scope.id))
    .flatMap((scope) => scope.tables.map((name) => Object.freeze({ name })));
  return [...new Map(tables.map((table) => [table.name, table])).values()];
}

// Ordem de inserção respeita as dependências; a exclusão usa a ordem inversa.
export const backupTables: readonly BackupTable[] = Object.freeze(
  [
    'cmms.plants',
    'cmms.sectors',
    'cmms.lines',
    'cmms.assets',
    'cmms.components',
    'cmms.materials',
    'cmms.material_value_sources',
    'cmms.parameter_definitions',
    'cmms.parameter_policies',
    'cmms.parameter_readings',
    'maintenance.checklist_templates',
    'maintenance.checklist_template_versions',
    'maintenance.checklist_version_validator_users',
    'maintenance.checklist_items',
    'maintenance.checklist_model_reviews',
    'maintenance.checklist_model_audit',
    'maintenance.maintenance_plans',
    'maintenance.maintenance_plan_versions',
    'maintenance.work_orders',
    'maintenance.plan_trigger_state',
    'maintenance.work_order_actions',
    'maintenance.executions',
    'maintenance.execution_checklist_items',
    'maintenance.evidence',
    'maintenance.material_usage',
    'maintenance.equipment_stops',
    'maintenance.maintenance_stops',
    'maintenance.operational_occurrences',
    'maintenance.operational_alerts',
    'maintenance.history_events',
    'maintenance.execution_locks',
    'maintenance.telemetry_sessions',
    'maintenance.shifts',
    'maintenance.production_entries',
    'workflow.service_calendars',
    'workflow.service_calendar_windows',
    'workflow.service_calendar_holidays',
    'workflow.sla_policies',
    'workflow.technical_demands',
    'workflow.demand_validator_requirements',
    'workflow.demand_events',
    'workflow.technical_signatures',
    'workflow.technical_signature_revocations',
    'workflow.technical_analyses',
    'workflow.notifications',
    'workflow.notification_recipients',
    'governance.technical_documents',
    'governance.document_revisions',
    'governance.import_batches',
    'governance.import_records',
    'governance.legacy_quarantine',
  ].map((name) => Object.freeze({ name })),
);

export const protectedBackupDomains = Object.freeze([
  'Identidades, credenciais e sessões',
  'Assinaturas comerciais e recursos de plano',
  'Janelas de manutenção',
  'Trilha de auditoria imutável',
  'Metadados dos próprios backups',
]);
