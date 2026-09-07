export interface ImportField {
  readonly key: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly required: boolean;
  readonly example: string | number | boolean;
}

export interface ImportModel {
  readonly type: string;
  readonly entity: ImportEntity;
  readonly group: string;
  readonly name: string;
  readonly description: string;
  readonly fields: readonly ImportField[];
}

export type ImportEntity =
  | 'plantas'
  | 'setores'
  | 'linhas'
  | 'ativos'
  | 'componentes'
  | 'materiais';

function field(
  key: string,
  label: string,
  example: string | number | boolean,
  required = false,
  aliases: readonly string[] = [],
): ImportField {
  return { key, label, aliases, required, example };
}

export const IMPORT_MAX_ROWS = 250;
export const IMPORT_MAX_CELL_CHARACTERS = 500;

export const importModels: readonly ImportModel[] = Object.freeze([
  {
    type: 'plantas',
    entity: 'plantas',
    group: 'Estrutura',
    name: 'Plantas e unidades',
    description: 'Cria ou atualiza unidades raiz da implantação.',
    fields: [
      field('id', 'ID', '', false, ['id_planta']),
      field('tag', 'TAG', 'PLT-01', true, ['codigo', 'codigo_planta']),
      field('nome', 'Nome', 'Planta Principal', true, ['planta', 'unidade']),
      field('status', 'Status', 'ATIVO', false, ['ativo']),
    ],
  },
  {
    type: 'setores',
    entity: 'setores',
    group: 'Estrutura',
    name: 'Setores',
    description: 'Vincula setores a uma planta já cadastrada.',
    fields: [
      field('id', 'ID', '', false, ['id_setor']),
      field('planta_id', 'Planta', 'PLT-01', true, ['id_planta', 'planta']),
      field('tag', 'TAG', 'MAN', true, ['codigo', 'codigo_setor']),
      field('nome', 'Nome', 'Manutenção', true, ['setor']),
      field('status', 'Status', 'ATIVO', false, ['ativo']),
    ],
  },
  {
    type: 'linhas',
    entity: 'linhas',
    group: 'Estrutura',
    name: 'Linhas de produção',
    description: 'Vincula linhas a um setor já cadastrado.',
    fields: [
      field('id', 'ID', '', false, ['id_linha']),
      field('setor_id', 'Setor', 'MAN', true, ['id_setor', 'setor']),
      field('tag', 'TAG', 'L01', true, ['codigo', 'codigo_linha']),
      field('nome', 'Nome', 'Linha 01', true, ['linha']),
      field('status', 'Status', 'ATIVO', false, ['ativo']),
    ],
  },
  {
    type: 'ativos',
    entity: 'ativos',
    group: 'Cadastro técnico',
    name: 'Equipamentos e ativos',
    description: 'Cadastra equipamentos vinculados a linhas existentes.',
    fields: [
      field('id', 'ID', '', false, ['id_ativo', 'id_equipamento']),
      field('linha_id', 'Linha', 'L01', true, ['id_linha', 'linha']),
      field('tag', 'TAG', 'EQ-001', true, ['codigo', 'tag_equipamento']),
      field('nome', 'Nome', 'Prensa Hidráulica 01', true, ['equipamento', 'ativo']),
      field('tipo', 'Tipo', 'Prensa', false, ['tipo_equipamento']),
      field('criticidade', 'Criticidade', 'ALTA', false, ['classificacao']),
      field('status', 'Status', 'OPERANDO', false, ['situacao']),
      field('saude_pct', 'Saúde (%)', 100, false, ['saude', 'saude_percentual']),
      field('horimetro_atual', 'Horímetro atual', 0, false, ['horimetro', 'horas_atuais']),
      field('fabricante', 'Fabricante', 'WEG'),
      field('modelo', 'Modelo', 'PH-100'),
      field('numero_serie', 'Número de série', 'SN-001', false, ['serie']),
      field('localizacao_tecnica', 'Localização técnica', 'Produção / Linha 01', false, [
        'local',
        'localizacao',
      ]),
    ],
  },
  {
    type: 'componentes',
    entity: 'componentes',
    group: 'Cadastro técnico',
    name: 'Componentes',
    description: 'Cadastra componentes vinculados a equipamentos existentes.',
    fields: [
      field('id', 'ID', '', false, ['id_componente']),
      field('ativo_id', 'Ativo', 'EQ-001', true, ['id_ativo', 'id_equipamento', 'ativo']),
      field('tag', 'TAG', 'CMP-001', true, ['codigo', 'codigo_componente']),
      field('nome', 'Nome', 'Motor principal', true, ['componente']),
      field('tipo', 'Tipo', 'Motor', false, ['tipo_componente']),
      field('criticidade', 'Criticidade', 'ALTA', false, ['classificacao']),
      field('status', 'Status', 'OPERANDO', false, ['situacao']),
      field('vida_util_horas', 'Vida útil (h)', 4000, false, ['vida_horas']),
      field('vida_util_dias', 'Vida útil (dias)', 365, false, ['vida_dias']),
      field('horas_acumuladas', 'Horas acumuladas', 0, false, ['horas']),
      field('instalado_em', 'Instalado em', '2026-08-10', false, ['data_instalacao']),
      field('fabricante', 'Fabricante', 'WEG'),
      field('modelo', 'Modelo', 'W22'),
      field('numero_serie', 'Número de série', 'SN-CMP-001', false, ['serie']),
      field('localizacao_tecnica', 'Localização técnica', 'Painel principal', false, [
        'local',
        'localizacao',
      ]),
    ],
  },
  {
    type: 'materiais',
    entity: 'materiais',
    group: 'Almoxarifado',
    name: 'Materiais e peças',
    description: 'Cadastra itens de estoque utilizados em execuções.',
    fields: [
      field('id', 'ID', '', false, ['id_material']),
      field('sku', 'SKU', 'ROL-6205', true, ['codigo', 'codigo_material']),
      field('nome', 'Nome', 'Rolamento 6205', true, ['material', 'descricao']),
      field('unidade', 'Unidade', 'un', false, ['un']),
      field('estoque_atual', 'Estoque atual', 10, false, ['saldo', 'quantidade']),
      field('estoque_minimo', 'Estoque mínimo', 3, false, ['minimo']),
      field('status', 'Status', 'ATIVO', false, ['ativo']),
    ],
  },
]);

export function importModel(type: string): ImportModel | null {
  return importModels.find((model) => model.type === type) ?? null;
}
