import { jsonValue, optionalText, timestamp } from './legacy-values.js';
import type { SourceSheetSnapshot, SourceWorkbookSnapshot } from './source-snapshot.js';

export type ValidationSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKER';

export interface MigrationValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly sourceName: string;
  readonly rowNumber: number | null;
  readonly legacyId: string | null;
  readonly field: string | null;
  readonly message: string;
}

interface SourceRelation {
  readonly child: string;
  readonly field: string;
  readonly parent: string;
  readonly optional?: boolean;
}

const relations: readonly SourceRelation[] = [
  { child: 'usuarios', field: 'area_id', parent: 'areas_tecnicas', optional: true },
  { child: 'usuarios', field: 'cargo_id', parent: 'cargos_tecnicos', optional: true },
  { child: 'sessoes', field: 'usuario_id', parent: 'usuarios' },
  { child: 'setores', field: 'planta_id', parent: 'plantas' },
  { child: 'linhas', field: 'setor_id', parent: 'setores' },
  { child: 'ativos', field: 'linha_id', parent: 'linhas' },
  { child: 'componentes', field: 'ativo_id', parent: 'ativos' },
  { child: 'planos_manutencao', field: 'ativo_id', parent: 'ativos' },
  { child: 'planos_manutencao', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'planos_manutencao', field: 'setor_id', parent: 'setores', optional: true },
  { child: 'planos_manutencao', field: 'validado_por', parent: 'usuarios', optional: true },
  { child: 'planos_manutencao', field: 'devolvido_por', parent: 'usuarios', optional: true },
  {
    child: 'planos_manutencao',
    field: 'modelo_base_id',
    parent: 'planos_manutencao',
    optional: true,
  },
  {
    child: 'planos_manutencao',
    field: 'revisao_origem_id',
    parent: 'planos_manutencao',
    optional: true,
  },
  {
    child: 'planos_manutencao',
    field: 'substitui_plano_id',
    parent: 'planos_manutencao',
    optional: true,
  },
  {
    child: 'planos_manutencao',
    field: 'substituido_por',
    parent: 'planos_manutencao',
    optional: true,
  },
  {
    child: 'planos_manutencao',
    field: 'analise_origem_id',
    parent: 'analises_tecnicas',
    optional: true,
  },
  {
    child: 'planos_manutencao',
    field: 'ocorrencia_origem_id',
    parent: 'ocorrencias_operacionais',
    optional: true,
  },
  { child: 'plano_itens', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'plano_controle', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'plano_controle', field: 'ativo_id', parent: 'ativos' },
  { child: 'plano_controle', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'plano_controle', field: 'ultima_acao_id', parent: 'os_acoes', optional: true },
  { child: 'ordens_servico', field: 'ativo_id', parent: 'ativos' },
  { child: 'ordens_servico', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'ordens_servico', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'ordens_servico', field: 'solicitante_id', parent: 'usuarios' },
  { child: 'ordens_servico', field: 'responsavel_id', parent: 'usuarios', optional: true },
  { child: 'os_acoes', field: 'os_id', parent: 'ordens_servico' },
  { child: 'os_acoes', field: 'ativo_id', parent: 'ativos' },
  { child: 'os_acoes', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'os_acoes', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'os_acoes', field: 'responsavel_id', parent: 'usuarios', optional: true },
  { child: 'execucoes', field: 'acao_id', parent: 'os_acoes' },
  { child: 'execucoes', field: 'os_id', parent: 'ordens_servico' },
  { child: 'execucoes', field: 'ativo_id', parent: 'ativos' },
  { child: 'execucoes', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'execucoes', field: 'operador_id', parent: 'usuarios' },
  { child: 'checklist_execucao', field: 'execucao_id', parent: 'execucoes' },
  { child: 'checklist_execucao', field: 'acao_id', parent: 'os_acoes' },
  { child: 'checklist_execucao', field: 'plano_item_id', parent: 'plano_itens' },
  { child: 'checklist_execucao', field: 'responsavel_id', parent: 'usuarios', optional: true },
  { child: 'evidencias', field: 'execucao_id', parent: 'execucoes' },
  { child: 'evidencias', field: 'acao_id', parent: 'os_acoes' },
  {
    child: 'evidencias',
    field: 'checklist_execucao_id',
    parent: 'checklist_execucao',
    optional: true,
  },
  { child: 'evidencias', field: 'ativo_id', parent: 'ativos' },
  { child: 'evidencias', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'evidencias', field: 'usuario_id', parent: 'usuarios' },
  { child: 'materiais_uso', field: 'execucao_id', parent: 'execucoes' },
  { child: 'materiais_uso', field: 'acao_id', parent: 'os_acoes' },
  { child: 'materiais_uso', field: 'material_id', parent: 'materiais' },
  { child: 'materiais_uso', field: 'usuario_id', parent: 'usuarios' },
  { child: 'parametros', field: 'ativo_id', parent: 'ativos' },
  { child: 'parametros', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'parametros', field: 'registrado_por', parent: 'usuarios', optional: true },
  { child: 'paradas_equipamento', field: 'ativo_id', parent: 'ativos' },
  { child: 'paradas_equipamento', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'paradas_equipamento', field: 'os_id', parent: 'ordens_servico', optional: true },
  { child: 'paradas_equipamento', field: 'acao_id', parent: 'os_acoes', optional: true },
  { child: 'paradas_equipamento', field: 'execucao_id', parent: 'execucoes', optional: true },
  { child: 'paradas_equipamento', field: 'iniciada_por', parent: 'usuarios' },
  { child: 'paradas_equipamento', field: 'finalizada_por', parent: 'usuarios', optional: true },
  { child: 'paradas_manutencao', field: 'ativo_id', parent: 'ativos' },
  { child: 'paradas_manutencao', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'paradas_manutencao', field: 'os_id', parent: 'ordens_servico' },
  { child: 'paradas_manutencao', field: 'acao_id', parent: 'os_acoes' },
  { child: 'paradas_manutencao', field: 'execucao_id', parent: 'execucoes', optional: true },
  { child: 'paradas_manutencao', field: 'usuario_id', parent: 'usuarios' },
  { child: 'ocorrencias_operacionais', field: 'ativo_id', parent: 'ativos' },
  {
    child: 'ocorrencias_operacionais',
    field: 'componente_id',
    parent: 'componentes',
    optional: true,
  },
  { child: 'ocorrencias_operacionais', field: 'usuario_id', parent: 'usuarios' },
  { child: 'ocorrencias_operacionais', field: 'os_id', parent: 'ordens_servico', optional: true },
  { child: 'ocorrencias_operacionais', field: 'acao_id', parent: 'os_acoes', optional: true },
  {
    child: 'ocorrencias_operacionais',
    field: 'parada_id',
    parent: 'paradas_equipamento',
    optional: true,
  },
  {
    child: 'ocorrencias_operacionais',
    field: 'demanda_tecnica_id',
    parent: 'demandas_tecnicas',
    optional: true,
  },
  {
    child: 'ocorrencias_operacionais',
    field: 'analise_tecnica_id',
    parent: 'analises_tecnicas',
    optional: true,
  },
  { child: 'areas_tecnicas', field: 'criado_por', parent: 'usuarios', optional: true },
  { child: 'cargos_tecnicos', field: 'area_id', parent: 'areas_tecnicas' },
  { child: 'cargos_tecnicos', field: 'criado_por', parent: 'usuarios', optional: true },
  { child: 'demandas_tecnicas', field: 'area_origem_id', parent: 'areas_tecnicas', optional: true },
  { child: 'demandas_tecnicas', field: 'area_atual_id', parent: 'areas_tecnicas', optional: true },
  {
    child: 'demandas_tecnicas',
    field: 'cargo_atual_id',
    parent: 'cargos_tecnicos',
    optional: true,
  },
  { child: 'demandas_tecnicas', field: 'responsavel_atual_id', parent: 'usuarios', optional: true },
  { child: 'demandas_tecnicas', field: 'criado_por', parent: 'usuarios' },
  { child: 'demanda_tramitacoes', field: 'demanda_id', parent: 'demandas_tecnicas' },
  { child: 'demanda_tramitacoes', field: 'de_area_id', parent: 'areas_tecnicas', optional: true },
  { child: 'demanda_tramitacoes', field: 'de_cargo_id', parent: 'cargos_tecnicos', optional: true },
  { child: 'demanda_tramitacoes', field: 'de_usuario_id', parent: 'usuarios', optional: true },
  { child: 'demanda_tramitacoes', field: 'para_area_id', parent: 'areas_tecnicas', optional: true },
  {
    child: 'demanda_tramitacoes',
    field: 'para_cargo_id',
    parent: 'cargos_tecnicos',
    optional: true,
  },
  { child: 'demanda_tramitacoes', field: 'para_usuario_id', parent: 'usuarios', optional: true },
  { child: 'assinaturas_tecnicas', field: 'demanda_id', parent: 'demandas_tecnicas' },
  { child: 'assinaturas_tecnicas', field: 'usuario_id', parent: 'usuarios' },
  { child: 'assinaturas_tecnicas', field: 'area_id', parent: 'areas_tecnicas' },
  { child: 'assinaturas_tecnicas', field: 'cargo_id', parent: 'cargos_tecnicos', optional: true },
  { child: 'analises_tecnicas', field: 'demanda_id', parent: 'demandas_tecnicas', optional: true },
  {
    child: 'analises_tecnicas',
    field: 'ocorrencia_id',
    parent: 'ocorrencias_operacionais',
    optional: true,
  },
  { child: 'analises_tecnicas', field: 'ativo_id', parent: 'ativos' },
  { child: 'analises_tecnicas', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'analises_tecnicas', field: 'autor_id', parent: 'usuarios' },
  { child: 'analises_tecnicas', field: 'area_id', parent: 'areas_tecnicas' },
  { child: 'analises_tecnicas', field: 'cargo_id', parent: 'cargos_tecnicos', optional: true },
  { child: 'notificacoes', field: 'usuario_id', parent: 'usuarios', optional: true },
  { child: 'notificacoes', field: 'area_id', parent: 'areas_tecnicas', optional: true },
  { child: 'turnos', field: 'planta_id', parent: 'plantas' },
  { child: 'turnos', field: 'setor_id', parent: 'setores', optional: true },
  { child: 'turnos', field: 'linha_id', parent: 'linhas', optional: true },
  { child: 'apontamentos_producao', field: 'turno_id', parent: 'turnos' },
  { child: 'apontamentos_producao', field: 'ativo_id', parent: 'ativos' },
  { child: 'apontamentos_producao', field: 'usuario_id', parent: 'usuarios', optional: true },
  { child: 'sla_politicas', field: 'area_id', parent: 'areas_tecnicas', optional: true },
  { child: 'historico', field: 'ativo_id', parent: 'ativos' },
  { child: 'historico', field: 'componente_id', parent: 'componentes', optional: true },
  { child: 'historico', field: 'os_id', parent: 'ordens_servico', optional: true },
  { child: 'historico', field: 'acao_id', parent: 'os_acoes', optional: true },
  { child: 'historico', field: 'execucao_id', parent: 'execucoes', optional: true },
  { child: 'historico', field: 'usuario_id', parent: 'usuarios', optional: true },
  { child: 'execucao_locks', field: 'ativo_id', parent: 'ativos' },
  { child: 'execucao_locks', field: 'acao_id', parent: 'os_acoes' },
  { child: 'execucao_locks', field: 'usuario_id', parent: 'usuarios' },
  { child: 'execucao_locks', field: 'sessao_id', parent: 'sessoes' },
  { child: 'telemetria_sessoes', field: 'sessao_id', parent: 'sessoes' },
  { child: 'telemetria_sessoes', field: 'usuario_id', parent: 'usuarios' },
  { child: 'telemetria_sessoes', field: 'ativo_id', parent: 'ativos', optional: true },
  { child: 'telemetria_sessoes', field: 'acao_id', parent: 'os_acoes', optional: true },
  { child: 'audit_log', field: 'usuario_id', parent: 'usuarios', optional: true },
  { child: 'checklist_modelo_validacoes', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'checklist_modelo_validacoes', field: 'usuario_id', parent: 'usuarios' },
  { child: 'modelo_checklist_auditoria', field: 'plano_id', parent: 'planos_manutencao' },
  { child: 'modelo_checklist_auditoria', field: 'item_id', parent: 'plano_itens', optional: true },
  { child: 'modelo_checklist_auditoria', field: 'usuario_id', parent: 'usuarios', optional: true },
  {
    child: 'configuracao_versoes',
    field: 'base_versao_id',
    parent: 'configuracao_versoes',
    optional: true,
  },
  { child: 'configuracao_versoes', field: 'criado_por', parent: 'usuarios', optional: true },
  { child: 'configuracao_rascunhos', field: 'usuario_id', parent: 'usuarios' },
  {
    child: 'configuracao_rascunhos',
    field: 'base_versao_id',
    parent: 'configuracao_versoes',
    optional: true,
  },
  { child: 'importacao_lotes', field: 'criado_por', parent: 'usuarios' },
  { child: 'importacao_lotes', field: 'confirmado_por', parent: 'usuarios', optional: true },
  { child: 'importacao_lotes', field: 'rollback_por', parent: 'usuarios', optional: true },
  { child: 'importacao_registros', field: 'lote_id', parent: 'importacao_lotes' },
  { child: 'documentos_tecnicos', field: 'responsavel_id', parent: 'usuarios', optional: true },
  { child: 'documentos_tecnicos', field: 'criado_por', parent: 'usuarios' },
  { child: 'documento_revisoes', field: 'documento_id', parent: 'documentos_tecnicos' },
  { child: 'documento_revisoes', field: 'criado_por', parent: 'usuarios' },
];

const jsonFieldsBySource: Readonly<Record<string, readonly string[]>> = {
  usuarios: ['especialidades_json', 'escopo_ids_json'],
  planos_manutencao: ['analise_tecnica_json'],
  plano_itens: ['opcoes_json'],
  ordens_servico: ['analise_tecnica_json'],
  os_acoes: ['analise_tecnica_json'],
  checklist_execucao: ['opcoes_json'],
  demandas_tecnicas: ['areas_validadoras_json', 'usuarios_validadores_json'],
  analises_tecnicas: ['relatorio_tecnico_json'],
  turnos: ['dias_semana_json'],
  checklist_validacao_regras: ['regra_json'],
  modelo_checklist_auditoria: ['antes_json', 'depois_json'],
  audit_log: ['antes_json', 'depois_json'],
  dashboard_cache: ['valor_json'],
  configuracao_versoes: ['configuracao_json', 'validacao_json'],
  configuracao_rascunhos: ['configuracao_json', 'validacao_json'],
  importacao_lotes: ['cabecalhos_json', 'cabecalhos_ignorados_json', 'resultado_json'],
  importacao_registros: ['raw_json', 'normalizado_json', 'erros_json', 'antes_json', 'depois_json'],
  legado_quarentena: ['payload_json'],
};

function sheetMap(snapshot: SourceWorkbookSnapshot): ReadonlyMap<string, SourceSheetSnapshot> {
  return new Map(snapshot.sheets.map((sheet) => [sheet.name, sheet]));
}

export function validateSourceSnapshot(
  snapshot: SourceWorkbookSnapshot,
): readonly MigrationValidationIssue[] {
  const issues: MigrationValidationIssue[] = [];
  const sheets = sheetMap(snapshot);
  const ids = new Map<string, Set<string>>();

  for (const sheet of snapshot.sheets) {
    const sourceIds = new Set<string>();
    for (const row of sheet.rows) {
      if (sheet.contract.handling === 'MIGRATE' && row.legacyId === null) {
        issues.push({
          code: 'LEGACY_ID_MISSING',
          severity: 'BLOCKER',
          sourceName: sheet.name,
          rowNumber: row.rowNumber,
          legacyId: null,
          field: sheet.contract.legacyIdColumn,
          message: 'Identificador legado obrigatório ausente.',
        });
      } else if (row.legacyId !== null) {
        if (sourceIds.has(row.legacyId)) {
          issues.push({
            code: 'DUPLICATE_LEGACY_ID',
            severity: 'BLOCKER',
            sourceName: sheet.name,
            rowNumber: row.rowNumber,
            legacyId: row.legacyId,
            field: sheet.contract.legacyIdColumn,
            message: 'Identificador legado duplicado na aba.',
          });
        }
        sourceIds.add(row.legacyId);
      }

      for (const field of jsonFieldsBySource[sheet.name] ?? []) {
        try {
          jsonValue(row.payload[field], field, null);
        } catch (error) {
          issues.push({
            code: 'INVALID_JSON',
            severity: 'BLOCKER',
            sourceName: sheet.name,
            rowNumber: row.rowNumber,
            legacyId: row.legacyId,
            field,
            message: error instanceof Error ? error.message : `JSON inválido em ${field}.`,
          });
        }
      }

      for (const [field, value] of Object.entries(row.payload)) {
        if (!field.endsWith('_em') || optionalText(value) === null) continue;
        try {
          timestamp(value, field);
        } catch (error) {
          issues.push({
            code: 'INVALID_TIMESTAMP',
            severity: 'BLOCKER',
            sourceName: sheet.name,
            rowNumber: row.rowNumber,
            legacyId: row.legacyId,
            field,
            message: error instanceof Error ? error.message : `Data inválida em ${field}.`,
          });
        }
      }
    }
    ids.set(sheet.name, sourceIds);
    for (const header of sheet.extraHeaders) {
      issues.push({
        code: 'EXTRA_HEADER',
        severity: 'WARNING',
        sourceName: sheet.name,
        rowNumber: null,
        legacyId: null,
        field: header,
        message: `Cabeçalho adicional preservado no snapshot: ${header}.`,
      });
    }
  }

  for (const relation of relations) {
    const child = sheets.get(relation.child);
    const parentIds = ids.get(relation.parent);
    if (!child || !parentIds) continue;
    for (const row of child.rows) {
      const reference = optionalText(row.payload[relation.field]);
      if (reference === null && relation.optional === true) continue;
      if (reference === null || !parentIds.has(reference)) {
        issues.push({
          code: 'ORPHAN_REFERENCE',
          severity: 'BLOCKER',
          sourceName: child.name,
          rowNumber: row.rowNumber,
          legacyId: row.legacyId,
          field: relation.field,
          message: `${relation.field}=${reference ?? '(vazio)'} não existe em ${relation.parent}.`,
        });
      }
    }
  }

  for (const unknownSheet of snapshot.unknownSheets) {
    issues.push({
      code: 'UNKNOWN_SHEET',
      severity: 'WARNING',
      sourceName: unknownSheet,
      rowNumber: null,
      legacyId: null,
      field: null,
      message: 'Aba não declarada foi mantida fora da carga e deve ser revisada.',
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: readonly MigrationValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'BLOCKER' || issue.severity === 'ERROR');
}
