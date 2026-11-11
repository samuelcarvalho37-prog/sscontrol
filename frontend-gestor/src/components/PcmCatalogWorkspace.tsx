import { Filter } from 'lucide-react'
import { filterPcmCatalog } from './pcmCatalogFilters'
import type { PcmColumnRules, PcmColumnRule } from './pcmCatalogFilters'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { actionAdminEntity, listAdminEntity, saveAdminEntity } from '../services/api/catalog'
import { listAdminChecklistModels, getAdminChecklistDetail } from '../services/api/checklists'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminEntity, AdminEntityRecord } from '../types/catalog'
import type { AdminChecklistPlan } from '../types/checklists'
import { AssetIcon, CheckIcon, MoreIcon, SettingsIcon, StopIcon } from './Icons'

export type AdminCatalogScope = 'structure' | 'assets' | 'inventory' | 'maintenance'

interface PcmCatalogWorkspaceProps {
  scope: AdminCatalogScope
  onSessionExpired: () => void
  onOpenImports: () => void
  showImports?: boolean
  approvalOnly?: boolean
}

type FieldType = 'text' | 'number' | 'date' | 'select' | 'reference' | 'checklist'

interface FieldDefinition {
  key: string
  label: string
  type?: FieldType
  required?: boolean
  options?: Array<{ value: string; label: string }>
  reference?: AdminEntity
  referenceLabel?: string
  dependsOn?: { field: string; targetField: string }
  help?: string
}

interface EntityDefinition {
  entity: AdminEntity
  singular: string
  label: string
  description: string
  columns: Array<{ key: string; label: string }>
  fields: FieldDefinition[]
  defaults: AdminEntityRecord
}

const STATUS_OPTIONS = [
  { value: 'ATIVO', label: 'Ativo' },
  { value: 'INATIVO', label: 'Inativo' },
]

const CRITICALITY_OPTIONS = [
  { value: 'BAIXA', label: 'Baixa' },
  { value: 'MEDIA', label: 'Média' },
  { value: 'ALTA', label: 'Alta' },
  { value: 'CRITICA', label: 'Crítica' },
]

const OPERATIONAL_STATUS_OPTIONS = [
  { value: 'OPERANDO', label: 'Operando' },
  { value: 'PARADO', label: 'Parado' },
  { value: 'INSPECAO', label: 'Em inspeção' },
  { value: 'MANUTENCAO_PROGRAMADA', label: 'Manutenção programada' },
  { value: 'MANUTENCAO_NAO_PROGRAMADA', label: 'Manutenção não programada' },
  { value: 'INDISPONIVEL', label: 'Indisponível' },
  { value: 'INATIVO', label: 'Cadastro inativo' },
]

const LEGACY_OPERATIONAL_STATUSES: Readonly<Record<string, string>> = {
  OPERATING: 'OPERANDO',
  STOPPED: 'PARADO',
  INSPECTION: 'INSPECAO',
  MAINTENANCE_PLANNED: 'MANUTENCAO_PROGRAMADA',
  MAINTENANCE_UNPLANNED: 'MANUTENCAO_NAO_PROGRAMADA',
  UNAVAILABLE: 'INDISPONIVEL',
}

function normalizeOperationalStatus(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return LEGACY_OPERATIONAL_STATUSES[normalized] ?? normalized
}

const EQUIPMENT_TYPE_OPTIONS = [
  { value: 'PRODUCTION_MACHINE', label: 'Máquina de produção' },
  { value: 'ELECTRIC_MOTOR', label: 'Motor elétrico' },
  { value: 'PUMP', label: 'Bomba' },
  { value: 'COMPRESSOR', label: 'Compressor' },
  { value: 'GEARBOX', label: 'Redutor' },
  { value: 'CONVEYOR', label: 'Transportador / esteira' },
  { value: 'BOILER', label: 'Caldeira / utilidade' },
  { value: 'ELECTRICAL_PANEL', label: 'Painel elétrico' },
  { value: 'INSTRUMENT', label: 'Sensor / instrumento' },
  { value: 'OTHER', label: 'Outro equipamento' },
]

const LEGACY_EQUIPMENT_TYPES: Readonly<Record<string, string>> = {
  MAQUINA: 'PRODUCTION_MACHINE',
  MACHINE: 'PRODUCTION_MACHINE',
  MOTOR: 'ELECTRIC_MOTOR',
  MOTOR_ELETRICO: 'ELECTRIC_MOTOR',
  BOMBA: 'PUMP',
  REDUTOR: 'GEARBOX',
  TRANSPORTADOR: 'CONVEYOR',
  ESTEIRA: 'CONVEYOR',
  CALDEIRA: 'BOILER',
  PAINEL_ELETRICO: 'ELECTRICAL_PANEL',
  INSTRUMENTO: 'INSTRUMENT',
  SENSOR: 'INSTRUMENT',
  OUTRO: 'OTHER',
}

function normalizeEquipmentType(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return LEGACY_EQUIPMENT_TYPES[normalized] ?? normalized
}

const COMPONENT_TYPE_OPTIONS = [
  { value: 'BEARING', label: 'Rolamento' },
  { value: 'FILTER', label: 'Filtro' },
  { value: 'MECHANICAL', label: 'Mecânico' },
  { value: 'ELECTRICAL', label: 'Elétrico' },
  { value: 'PNEUMATIC', label: 'Pneumático' },
  { value: 'HYDRAULIC', label: 'Hidráulico' },
  { value: 'INSTRUMENTATION', label: 'Instrumentação' },
  { value: 'SAFETY_DEVICE', label: 'Dispositivo de segurança' },
  { value: 'STRUCTURAL', label: 'Estrutural' },
  { value: 'COMPONENT', label: 'Componente genérico' },
  { value: 'OTHER', label: 'Outro componente' },
]

const LEGACY_COMPONENT_TYPES: Readonly<Record<string, string>> = {
  ROLAMENTO: 'BEARING',
  FILTRO: 'FILTER',
  MECANICO: 'MECHANICAL',
  MECÂNICO: 'MECHANICAL',
  ELETRICO: 'ELECTRICAL',
  ELÉTRICO: 'ELECTRICAL',
  PNEUMATICO: 'PNEUMATIC',
  PNEUMÁTICO: 'PNEUMATIC',
  HIDRAULICO: 'HYDRAULIC',
  HIDRÁULICO: 'HYDRAULIC',
  INSTRUMENTACAO: 'INSTRUMENTATION',
  INSTRUMENTAÇÃO: 'INSTRUMENTATION',
  SEGURANCA: 'SAFETY_DEVICE',
  SEGURANÇA: 'SAFETY_DEVICE',
  ESTRUTURAL: 'STRUCTURAL',
  COMPONENTE: 'COMPONENT',
  OUTRO: 'OTHER',
}

function normalizeComponentType(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return LEGACY_COMPONENT_TYPES[normalized] ?? normalized
}

const MATERIAL_UNIT_OPTIONS = [
  { value: 'un', label: 'Unidade (un)' },
  { value: 'pc', label: 'Peça (pc)' },
  { value: 'cj', label: 'Conjunto (cj)' },
  { value: 'cx', label: 'Caixa (cx)' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'g', label: 'Grama (g)' },
  { value: 'l', label: 'Litro (l)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'm', label: 'Metro (m)' },
  { value: 'm2', label: 'Metro quadrado (m²)' },
  { value: 'm3', label: 'Metro cúbico (m³)' },
  { value: 'rl', label: 'Rolo (rl)' },
]

const TRIGGER_UNIT_OPTIONS = [
  { value: 'dias', label: 'Dias' },
  { value: 'h', label: 'Horas de horímetro' },
  { value: 'bar', label: 'Pressão (bar)' },
  { value: 'psi', label: 'Pressão (psi)' },
  { value: '°C', label: 'Temperatura (°C)' },
  { value: 'mm/s', label: 'Vibração (mm/s)' },
  { value: 'A', label: 'Corrente (A)' },
  { value: 'V', label: 'Tensão (V)' },
  { value: '%', label: 'Percentual (%)' },
]

const RECURRENCE_OPTIONS = [
  { value: '1', label: 'Diária · 1 dia' },
  { value: '7', label: 'Semanal · 7 dias' },
  { value: '15', label: 'Quinzenal · 15 dias' },
  { value: '30', label: 'Mensal · 30 dias' },
  { value: '60', label: 'Bimestral · 60 dias' },
  { value: '90', label: 'Trimestral · 90 dias' },
  { value: '180', label: 'Semestral · 180 dias' },
  { value: '365', label: 'Anual · 365 dias' },
]

const ESTIMATED_TIME_OPTIONS = [
  { value: '15', label: '15 minutos' },
  { value: '30', label: '30 minutos' },
  { value: '45', label: '45 minutos' },
  { value: '60', label: '1 hora' },
  { value: '90', label: '1h30' },
  { value: '120', label: '2 horas' },
  { value: '180', label: '3 horas' },
  { value: '240', label: '4 horas' },
  { value: '480', label: '1 turno · 8 horas' },
]

const ENTITY_DEFINITIONS: Record<AdminEntity, EntityDefinition> = {
  plantas: {
    entity: 'plantas', singular: 'planta', label: 'Plantas e unidades', description: 'Raízes da estrutura organizacional.',
    columns: [{ key: 'tag', label: 'TAG' }, { key: 'nome', label: 'Nome' }, { key: 'status', label: 'Status' }, { key: 'atualizado_em', label: 'Atualizado em' }],
    fields: [
      { key: 'tag', label: 'TAG / código', required: true, help: 'Código curto e estável, como PLT-01.' },
      { key: 'nome', label: 'Nome da planta', required: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    ],
    defaults: { id: '', tag: '', nome: '', status: 'ATIVO' },
  },
  setores: {
    entity: 'setores', singular: 'setor', label: 'Setores', description: 'Áreas produtivas e técnicas vinculadas a uma planta.',
    columns: [{ key: 'tag', label: 'TAG' }, { key: 'nome', label: 'Nome' }, { key: 'planta_id', label: 'Planta' }, { key: 'status', label: 'Status' }],
    fields: [
      { key: 'planta_id', label: 'Planta', type: 'reference', reference: 'plantas', referenceLabel: 'nome', required: true },
      { key: 'tag', label: 'TAG / código', required: true },
      { key: 'nome', label: 'Nome do setor', required: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    ],
    defaults: { id: '', planta_id: '', tag: '', nome: '', status: 'ATIVO' },
  },
  linhas: {
    entity: 'linhas', singular: 'linha', label: 'Linhas de produção', description: 'Linhas vinculadas aos setores da planta.',
    columns: [{ key: 'tag', label: 'TAG' }, { key: 'nome', label: 'Nome' }, { key: 'setor_id', label: 'Setor' }, { key: 'status', label: 'Status' }],
    fields: [
      { key: 'setor_id', label: 'Setor', type: 'reference', reference: 'setores', referenceLabel: 'nome', required: true },
      { key: 'tag', label: 'TAG / código', required: true },
      { key: 'nome', label: 'Nome da linha', required: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    ],
    defaults: { id: '', setor_id: '', tag: '', nome: '', status: 'ATIVO' },
  },
  ativos: {
    entity: 'ativos', singular: 'ativo', label: 'Ativos', description: 'Cadastro técnico dos equipamentos monitorados.',
    columns: [{ key: 'tag', label: 'TAG' }, { key: 'nome', label: 'Equipamento' }, { key: 'linha_id', label: 'Linha' }, { key: 'criticidade', label: 'Criticidade' }, { key: 'status', label: 'Status' }, { key: 'saude_pct', label: 'Saúde' }],
    fields: [
      { key: 'planta_contexto', label: 'Planta', type: 'reference', reference: 'plantas', referenceLabel: 'nome', required: true, help: 'Filtra os setores e evita procurar em toda a fábrica.' },
      { key: 'setor_contexto', label: 'Setor', type: 'reference', reference: 'setores', referenceLabel: 'nome', dependsOn: { field: 'planta_contexto', targetField: 'planta_id' }, required: true },
      { key: 'linha_id', label: 'Linha', type: 'reference', reference: 'linhas', referenceLabel: 'nome', dependsOn: { field: 'setor_contexto', targetField: 'setor_id' }, required: true },
      { key: 'tag', label: 'TAG / código', required: true },
      { key: 'nome', label: 'Nome do equipamento', required: true },
      { key: 'tipo', label: 'Tipo de equipamento', type: 'select', options: EQUIPMENT_TYPE_OPTIONS, required: true },
      { key: 'criticidade', label: 'Criticidade', type: 'select', options: CRITICALITY_OPTIONS, required: true },
      { key: 'status', label: 'Status operacional', type: 'select', options: OPERATIONAL_STATUS_OPTIONS, required: true },
      { key: 'saude_pct', label: 'Saúde (%)', type: 'number' },
      { key: 'horimetro_atual', label: 'Horímetro atual', type: 'number' },
      { key: 'fabricante', label: 'Fabricante' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'numero_serie', label: 'Número de série' },
      { key: 'localizacao_tecnica', label: 'Localização técnica' },
    ],
    defaults: { id: '', planta_contexto: '', setor_contexto: '', linha_id: '', tag: '', nome: '', tipo: 'PRODUCTION_MACHINE', criticidade: 'MEDIA', status: 'OPERANDO', saude_pct: 100, horimetro_atual: 0 },
  },
  componentes: {
    entity: 'componentes', singular: 'componente', label: 'Componentes', description: 'Partes e subconjuntos vinculados aos equipamentos.',
    columns: [{ key: 'tag', label: 'TAG' }, { key: 'nome', label: 'Componente' }, { key: 'ativo_id', label: 'Ativo' }, { key: 'criticidade', label: 'Criticidade' }, { key: 'status', label: 'Status' }, { key: 'horas_acumuladas', label: 'Horas' }],
    fields: [
      { key: 'planta_contexto', label: 'Planta', type: 'reference', reference: 'plantas', referenceLabel: 'nome', required: true },
      { key: 'setor_contexto', label: 'Setor', type: 'reference', reference: 'setores', referenceLabel: 'nome', dependsOn: { field: 'planta_contexto', targetField: 'planta_id' }, required: true },
      { key: 'linha_contexto', label: 'Linha', type: 'reference', reference: 'linhas', referenceLabel: 'nome', dependsOn: { field: 'setor_contexto', targetField: 'setor_id' }, required: true },
      { key: 'ativo_id', label: 'Ativo', type: 'reference', reference: 'ativos', referenceLabel: 'nome', dependsOn: { field: 'linha_contexto', targetField: 'linha_id' }, required: true },
      { key: 'tag', label: 'TAG / código', required: true },
      { key: 'nome', label: 'Nome do componente', required: true },
      { key: 'tipo', label: 'Tipo de componente', type: 'select', options: COMPONENT_TYPE_OPTIONS, required: true },
      { key: 'criticidade', label: 'Criticidade', type: 'select', options: CRITICALITY_OPTIONS, required: true },
      { key: 'status', label: 'Status operacional', type: 'select', options: OPERATIONAL_STATUS_OPTIONS, required: true },
      { key: 'vida_util_horas', label: 'Vida útil (horas)', type: 'number' },
      { key: 'vida_util_dias', label: 'Vida útil (dias)', type: 'number' },
      { key: 'horas_acumuladas', label: 'Horas acumuladas', type: 'number' },
      { key: 'instalado_em', label: 'Data de instalação', type: 'date' },
      { key: 'fabricante', label: 'Fabricante' },
      { key: 'modelo', label: 'Modelo' },
      { key: 'numero_serie', label: 'Número de série' },
      { key: 'localizacao_tecnica', label: 'Localização técnica' },
    ],
    defaults: { id: '', planta_contexto: '', setor_contexto: '', linha_contexto: '', ativo_id: '', tag: '', nome: '', tipo: 'MECHANICAL', criticidade: 'MEDIA', status: 'OPERANDO', vida_util_horas: 0, vida_util_dias: 0, horas_acumuladas: 0 },
  },
  materiais: {
    entity: 'materiais', singular: 'material', label: 'Materiais e peças', description: 'Itens utilizados nas execuções de manutenção.',
    columns: [{ key: 'sku', label: 'SKU' }, { key: 'nome', label: 'Nome técnico' }, { key: 'nome_facil', label: 'Nome para consulta' }, { key: 'valor_unitario', label: 'Custo unitário' }, { key: 'unidade', label: 'Unidade' }, { key: 'estoque_atual', label: 'Saldo' }, { key: 'estoque_minimo', label: 'Mínimo' }, { key: 'status', label: 'Status' }],
    fields: [
      { key: 'sku', label: 'SKU / código', required: true },
      { key: 'nome', label: 'Nome do material', required: true },
      { key: 'nome_facil', label: 'Nome para consulta', help: 'Descrição simples exibida para o técnico durante a execução.' },
      { key: 'unidade', label: 'Unidade', type: 'select', options: MATERIAL_UNIT_OPTIONS, required: true },
      { key: 'valor_unitario', label: 'Custo unitário (R$)', type: 'number', required: true, help: 'Valor aplicado à OS quando esta peça sair do estoque.' },
      { key: 'estoque_atual', label: 'Estoque atual', type: 'number' },
      { key: 'estoque_minimo', label: 'Estoque mínimo', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, required: true },
    ],
    defaults: { id: '', sku: '', nome: '', nome_facil: '', unidade: 'un', valor_unitario: 0, estoque_atual: 0, estoque_minimo: 0, status: 'ATIVO' },
  },
  planos: {
    entity: 'planos', singular: 'plano', label: 'Planos programados', description: 'Programações que seguem para validação técnica antes de chegar ao Operador.',
    columns: [{ key: 'nome', label: 'Plano' }, { key: 'ativo_id', label: 'Ativo' }, { key: 'tipo', label: 'Tipo' }, { key: 'gatilho_tipo', label: 'Gatilho' }, { key: 'gatilho_valor', label: 'Intervalo' }, { key: 'workflow_status', label: 'Situação do plano' }],
    fields: [
      { key: 'planta_contexto', label: 'Planta', type: 'reference', reference: 'plantas', referenceLabel: 'nome', required: true },
      { key: 'setor_contexto', label: 'Setor', type: 'reference', reference: 'setores', referenceLabel: 'nome', dependsOn: { field: 'planta_contexto', targetField: 'planta_id' }, required: true },
      { key: 'linha_contexto', label: 'Linha', type: 'reference', reference: 'linhas', referenceLabel: 'nome', dependsOn: { field: 'setor_contexto', targetField: 'setor_id' }, required: true },
      { key: 'ativo_id', label: 'Ativo', type: 'reference', reference: 'ativos', referenceLabel: 'nome', dependsOn: { field: 'linha_contexto', targetField: 'linha_id' }, required: true },
      { key: 'componente_id', label: 'Componente (opcional)', type: 'reference', reference: 'componentes', referenceLabel: 'nome', dependsOn: { field: 'ativo_id', targetField: 'ativo_id' } },
      { key: 'checklist_versao_id', label: 'Checklist validado', type: 'checklist', required: true, help: 'Somente modelos publicados, com etapas e compatíveis com o ativo selecionado.' },
      { key: 'nome', label: 'Nome do plano', required: true },
      { key: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'PREVENTIVA', label: 'Preventiva' }, { value: 'PREDITIVA', label: 'Preditiva' }, { value: 'INSPECAO', label: 'Inspeção' }, { value: 'CORRETIVA', label: 'Corretiva planejada' }, { value: 'MELHORIA', label: 'Melhoria planejada' }, { value: 'LUBRIFICACAO', label: 'Lubrificação planejada' }, { value: 'BASEADA_CONDICAO', label: 'Baseada em condição' }], required: true },
      { key: 'criticidade', label: 'Criticidade', type: 'select', options: CRITICALITY_OPTIONS, required: true },
      { key: 'gatilho_tipo', label: 'Tipo de gatilho', type: 'select', options: [{ value: 'HORAS', label: 'Por horas acumuladas do equipamento' }, { value: 'DIAS', label: 'A cada intervalo de dias' }, { value: 'PARAMETRO', label: 'Quando um parâmetro atingir o limite' }], required: true },
      { key: 'gatilho_valor', label: 'Valor do gatilho', type: 'number', required: true },
      { key: 'unidade', label: 'Unidade', type: 'select', options: TRIGGER_UNIT_OPTIONS, help: 'Preenchida automaticamente ao trocar o gatilho; pode ser ajustada.' },
      { key: 'recorrencia_dias', label: 'Periodicidade', type: 'select', options: RECURRENCE_OPTIONS },
      { key: 'tempo_estimado_min', label: 'Tempo estimado', type: 'select', options: ESTIMATED_TIME_OPTIONS },
      { key: 'requer_bloqueio', label: 'Requer bloqueio', type: 'select', options: [{ value: 'SIM', label: 'Sim' }, { value: 'NAO', label: 'Não' }] },
      { key: 'requer_evidencia', label: 'Requer evidência', type: 'select', options: [{ value: 'SIM', label: 'Sim' }, { value: 'NAO', label: 'Não' }] },
      { key: 'max_sessoes', label: 'Máximo de sessões', type: 'select', options: [{ value: '1', label: '1 sessão' }, { value: '2', label: '2 sessões' }, { value: '3', label: '3 sessões' }, { value: '4', label: '4 sessões' }, { value: '5', label: '5 sessões' }] },
      { key: 'modo_parada_manutencao', label: 'Modo de parada', type: 'select', options: [{ value: 'DECISAO_EXECUTOR', label: 'Decisão do executor' }, { value: 'OBRIGATORIA', label: 'Parada obrigatória' }, { value: 'SEM_PARADA', label: 'Executar sem parada' }] },
    ],
    defaults: { id: '', planta_contexto: '', setor_contexto: '', linha_contexto: '', ativo_id: '', componente_id: '', checklist_versao_id: '', nome: '', tipo: 'PREVENTIVA', criticidade: 'MEDIA', gatilho_tipo: 'DIAS', gatilho_valor: 30, unidade: 'dias', recorrencia_dias: 30, tempo_estimado_min: 60, requer_bloqueio: 'SIM', requer_evidencia: 'NAO', max_sessoes: 1, modo_parada_manutencao: 'DECISAO_EXECUTOR', status: 'ATIVO', workflow_status: 'RASCUNHO' },
  },
  plano_itens: {
    entity: 'plano_itens', singular: 'item', label: 'Itens de checklist', description: 'Itens técnicos dos planos.',
    columns: [{ key: 'ordem', label: 'Ordem' }, { key: 'titulo', label: 'Item' }, { key: 'plano_id', label: 'Plano' }, { key: 'tipo_resposta', label: 'Resposta' }, { key: 'obrigatorio', label: 'Obrigatório' }],
    fields: [], defaults: { id: '' },
  },
}

const SCOPE_ENTITIES: Record<AdminCatalogScope, AdminEntity[]> = {
  structure: ['plantas', 'setores', 'linhas'],
  assets: ['ativos', 'componentes'],
  inventory: ['materiais'],
  maintenance: ['planos'],
}

const SCOPE_REFERENCES: Record<AdminCatalogScope, AdminEntity[]> = {
  structure: ['plantas', 'setores', 'linhas'],
  assets: ['plantas', 'setores', 'linhas', 'ativos', 'componentes', 'planos'],
  inventory: ['materiais'],
  maintenance: ['plantas', 'setores', 'linhas', 'ativos', 'componentes', 'planos'],
}

const EMPTY_STATE_CONTENT: Record<AdminEntity, { title: string; description: string }> = {
  plantas: { title: 'Nenhuma planta cadastrada', description: 'Cadastre a primeira unidade. Depois, a área Ações permitirá editar, desativar, reativar ou excluir quando não houver vínculos.' },
  setores: { title: 'Nenhum setor cadastrado', description: 'Cadastre um setor vinculado à planta. Registros utilizados serão desativados em vez de apagados.' },
  linhas: { title: 'Nenhuma linha cadastrada', description: 'Cadastre uma linha vinculada ao setor. O histórico será preservado quando a linha deixar de operar.' },
  ativos: { title: 'Nenhum equipamento cadastrado', description: 'Após o cadastro, Ações permitirá editar, colocar em operação, registrar parada, desativar, reativar e excluir somente equipamentos nunca utilizados.' },
  componentes: { title: 'Nenhum componente cadastrado', description: 'Após o cadastro, Ações permitirá editar, desativar, reativar e excluir somente componentes sem planos, OS ou histórico.' },
  materiais: { title: 'Nenhum material cadastrado', description: 'Cadastre o primeiro item. Materiais já movimentados permanecem rastreáveis e podem apenas ser desativados.' },
  planos: { title: 'Nenhum plano programado', description: 'Crie um rascunho. Ações permitirá editar ou excluir o rascunho; versões validadas ficam protegidas e exigem nova revisão.' },
  plano_itens: { title: 'Nenhum item de checklist', description: 'Os itens são administrados pelo construtor de checklists.' },
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function formatCell(key: string, value: unknown): string {
  if (key === 'saude_pct' && value !== '' && value !== undefined) return `${value}%`
  if (key === 'status' || key === 'workflow_status') return statusLabel(value)
  if (key.endsWith('_em') && value) {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
  }
  return valueText(value)
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function isProtectedPlan(record: AdminEntityRecord): boolean {
  return ['EM_VALIDACAO_GESTAO', 'VALIDADO', 'ATIVO', 'OBSOLETO'].includes(upper(record.workflow_status))
}

function statusLabel(value: unknown): string {
  const labels: Record<string, string> = {
    ATIVO: 'Ativo',
    INATIVO: 'Inativo',
    OPERANDO: 'Operando',
    PARADO: 'Parado',
    INSPECAO: 'Em inspeção',
    MANUTENCAO_PROGRAMADA: 'Manutenção programada',
    MANUTENCAO_NAO_PROGRAMADA: 'Manutenção não programada',
    INDISPONIVEL: 'Indisponível',
    RASCUNHO: 'Rascunho',
    EM_VALIDACAO_GESTAO: 'Em validação',
    DEVOLVIDO_CORRECAO: 'Devolvido para correção',
    VALIDADO: 'Validado',
    OBSOLETO: 'Obsoleto',
  }
  return labels[upper(value)] ?? valueText(value)
}

export function PcmCatalogWorkspace({
  scope,
  onSessionExpired,
  onOpenImports,
  showImports = true,
  approvalOnly = false,
}: PcmCatalogWorkspaceProps) {
  const scopeEntities = SCOPE_ENTITIES[scope]
  const [selectedEntity, setSelectedEntity] = useState<AdminEntity>(scopeEntities[0])
  const [records, setRecords] = useState<Partial<Record<AdminEntity, AdminEntityRecord[]>>>({})
  const [checklistModels, setChecklistModels] = useState<AdminChecklistPlan[]>([])
  const [columnFilters, setColumnFilters] = useState<PcmColumnRules>({})
  const [filterKey, setFilterKey] = useState<string | null>(null)
  const [previewPlan, setPreviewPlan] = useState(false)
  const [planStep, setPlanStep] = useState(0)
  const [loadingChecklistDefaults, setLoadingChecklistDefaults] = useState(false)
  const [editing, setEditing] = useState<AdminEntityRecord | null | undefined>(undefined)
  const [draft, setDraft] = useState<AdminEntityRecord>({ id: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionRecord, setActionRecord] = useState<AdminEntityRecord | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setSelectedEntity(SCOPE_ENTITIES[scope][0])
    setEditing(undefined)
    setActionRecord(null)
  }, [scope])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const entities = approvalOnly ? ['planos' as AdminEntity] : SCOPE_REFERENCES[scope]
    const [lists, models] = await Promise.all([
      Promise.all(entities.map((entity) => listAdminEntity(entity, signal))),
      scope === 'maintenance' && !approvalOnly ? listAdminChecklistModels(signal) : Promise.resolve([]),
    ])
    setRecords(Object.fromEntries(lists.map((list) => [list.entidade, list.rows])))
    setChecklistModels(models)
  }, [approvalOnly, scope])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void loadData(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os cadastros.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadData, onSessionExpired])

  useAutoRefresh(async () => {
    try {
      await loadData()
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar os cadastros.')
    }
  }, {
    enabled: editing === undefined && !actionRecord && !saving && !actionBusy,
    intervalMs: 20_000,
  })

  const [assetContext, setAssetContext] = useState<AdminEntityRecord | null>(null)
  const definition = ENTITY_DEFINITIONS[selectedEntity]
  const hasColumnFilters = Object.values(columnFilters).some(rule => rule.value || rule.order)
  const editingReadOnly = approvalOnly || (selectedEntity === 'planos' && Boolean(editing && isProtectedPlan(editing)))
  useEffect(() => { setColumnFilters({}); setFilterKey(null) }, [selectedEntity])
  const visibleRecords = useMemo(() => filterPcmCatalog((records[selectedEntity] ?? []).filter(record => !assetContext || selectedEntity !== 'componentes' || String(record.ativo_id) === String(assetContext.id)), columnFilters, (row, key) => key.endsWith('_id') ? displayCell(key, row[key]) : row[key]), [records, selectedEntity, assetContext, columnFilters])
  const activeFilter = filterKey ? columnFilters[filterKey] ?? { value: '', operator: 'contains' as const, order: '' as const } : null
  const activeColumn = definition.columns.find(column => column.key === filterKey)
  const numericFilter = ['saude_pct', 'horas_acumuladas', 'gatilho_valor', 'estoque_atual', 'estoque_minimo', 'valor_unitario'].includes(filterKey ?? '')
  const choiceFilter = ['status', 'criticidade', 'gatilho_tipo', 'workflow_status', 'tipo', 'unidade'].includes(filterKey ?? '')
  const knownChoices = filterKey === 'criticidade' ? CRITICALITY_OPTIONS : filterKey === 'status' ? definition.fields.find(field => field.key === 'status')?.options ?? [] : []
  const filterChoices = filterKey ? [...new Set([...knownChoices.map(option => option.value), ...(records[selectedEntity] ?? []).map(record => String(record[filterKey] ?? '')).filter(Boolean)])] : []
  function updateColumnFilter(patch: Partial<PcmColumnRule>) {
    if (!filterKey) return
    setColumnFilters(current => {
      const next = { ...current }
      if (patch.order) for (const key of Object.keys(next)) next[key] = { ...next[key], order: '' }
      next[filterKey] = { ...(current[filterKey] ?? { value: '', operator: numericFilter || choiceFilter ? 'eq' : 'contains' }), ...patch }
      return next
    })
  }
  function toggleColumnFilter(key: string) {
    setFilterKey(current => current === key ? null : key)
    setColumnFilters(current => current[key] ? current : { ...current, [key]: { value: '', operator: ['saude_pct', 'horas_acumuladas', 'gatilho_valor', 'estoque_atual', 'estoque_minimo', 'valor_unitario', 'status', 'criticidade', 'gatilho_tipo', 'workflow_status', 'tipo', 'unidade'].includes(key) ? 'eq' : 'contains', order: '' } })
  }

  function referenceLabel(entity: AdminEntity, id: unknown): string {
    const item = (records[entity] ?? []).find((record) => String(record.id) === String(id))
    return item ? `${valueText(item.tag || item.sku || item.id)} · ${valueText(item.nome)}` : valueText(id)
  }

  function displayCell(key: string, value: unknown): string {
    const relation: Partial<Record<string, AdminEntity>> = {
      planta_id: 'plantas', setor_id: 'setores', linha_id: 'linhas', ativo_id: 'ativos', componente_id: 'componentes', plano_id: 'planos',
    }
    return relation[key] ? referenceLabel(relation[key] as AdminEntity, value) : formatCell(key, value)
  }

  function addLocationContext(next: AdminEntityRecord): AdminEntityRecord {
    let lineId = selectedEntity === 'ativos' ? next.linha_id : ''
    if (selectedEntity === 'componentes' || selectedEntity === 'planos') {
      const asset = (records.ativos ?? []).find((item) => String(item.id) === String(next.ativo_id))
      lineId = asset?.linha_id ?? ''
    }
    if (!lineId) return next
    const line = (records.linhas ?? []).find((item) => String(item.id) === String(lineId))
    const sector = (records.setores ?? []).find((item) => String(item.id) === String(line?.setor_id))
    return {
      ...next,
      planta_contexto: sector?.planta_id ?? '',
      setor_contexto: line?.setor_id ?? '',
      ...(selectedEntity === 'ativos' ? {} : { linha_contexto: lineId }),
    }
  }

  function openEditor(record?: AdminEntityRecord) {
    const base: AdminEntityRecord = record ? { ...record } : { ...definition.defaults, ...(selectedEntity === 'componentes' && assetContext ? { ativo_id: assetContext.id } : {}) }
    const normalizedBase = selectedEntity === 'ativos'
      ? {
          ...base,
          tipo: normalizeEquipmentType(base.tipo),
          status: normalizeOperationalStatus(base.status),
        }
      : selectedEntity === 'componentes'
        ? {
            ...base,
            tipo: normalizeComponentType(base.tipo),
            status: normalizeOperationalStatus(base.status),
          }
        : base
    const next = addLocationContext(normalizedBase)
    setPlanStep(0)
    setEditing(record ?? null)
    setDraft(next)
    setError('')
    setNotice('')
  }

  function openActions(record: AdminEntityRecord) {
    setActionRecord(record)
    setActionError('')
    setConfirmDelete(false)
  }

  function updateDraftField(field: FieldDefinition, rawValue: string) {
    setDraft((current) => {
      const next: AdminEntityRecord = {
        ...current,
        [field.key]: field.type === 'number'
          ? (rawValue === '' ? '' : Number(rawValue))
          : rawValue,
      }

      if (field.key === 'planta_contexto') {
        next.setor_contexto = ''
        next.linha_contexto = ''
        if (selectedEntity === 'ativos') next.linha_id = ''
        next.ativo_id = ''
        next.componente_id = ''
      }
      if (field.key === 'setor_contexto') {
        next.linha_contexto = ''
        if (selectedEntity === 'ativos') next.linha_id = ''
        next.ativo_id = ''
        next.componente_id = ''
      }
      if (field.key === 'linha_contexto') {
        next.ativo_id = ''
        next.componente_id = ''
      }
      if (field.key === 'ativo_id') next.componente_id = ''
      if (field.key === 'ativo_id' || field.key === 'componente_id') next.checklist_versao_id = ''
      if (field.key === 'gatilho_tipo') {
        if (rawValue === 'HORAS') {
          next.unidade = 'h'
          next.recorrencia_dias = 0
        } else if (rawValue === 'DIAS') {
          next.unidade = 'dias'
          next.gatilho_valor = Number(next.gatilho_valor) || 30
          next.recorrencia_dias = Number(next.recorrencia_dias) || 30
        } else if (rawValue === 'PARAMETRO') {
          next.unidade = ['dias', 'h'].includes(String(next.unidade)) ? 'bar' : next.unidade
          next.recorrencia_dias = 0
        }
      }
      if (field.key === 'gatilho_valor' && String(next.gatilho_tipo) === 'DIAS') next.recorrencia_dias = Number(rawValue)
      if (field.key === 'recorrencia_dias' && String(next.gatilho_tipo) === 'DIAS') {
        next.gatilho_valor = Number(rawValue)
      }
      return next
    })
  }

  async function chooseChecklist(versionId: string) {
    updateDraftField({ key: 'checklist_versao_id', label: 'Checklist' }, versionId)
    const model = checklistModels.find(item => String(item.versao_id) === versionId)
    if (!model) return
    setLoadingChecklistDefaults(true)
    try {
      const detail = await getAdminChecklistDetail(model.id)
      setDraft(current => String(current.checklist_versao_id) !== versionId ? current : { ...current, tempo_estimado_min: detail.plano.tempo_estimado_min ?? current.tempo_estimado_min, requer_bloqueio: detail.plano.requer_bloqueio ?? current.requer_bloqueio, modo_parada_manutencao: detail.plano.modo_parada_manutencao ?? current.modo_parada_manutencao })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as pré-configurações do checklist.') }
    finally { setLoadingChecklistDefaults(false) }
  }
  function planFieldStep(key: string): number {
    return ['nome', 'tipo', 'criticidade'].includes(key) ? 0 : ['planta_contexto', 'setor_contexto', 'linha_contexto', 'ativo_id', 'componente_id', 'checklist_versao_id'].includes(key) ? 1 : 2
  }
  function planReviewValue(field: FieldDefinition): string {
    const value = draft[field.key]
    if (!value && field.key === 'componente_id') return 'Ativo completo'
    if (field.reference) {
      const record = (records[field.reference] ?? []).find(item => String(item.id) === String(value))
      return record ? String(record.nome || record.tag || 'Sem nome') : 'Não selecionado'
    }
    if (field.type === 'checklist') return checklistModels.find(model => String(model.versao_id) === String(value))?.nome || 'Não selecionado'
    const option = field.options?.find(item => String(item.value) === String(value))
    if (option) return option.label
    if (field.key === 'tempo_estimado_min') return `${Number(value) || 0} min`
    return displayCell(field.key, value)
  }
  function advancePlanStep() {
    const missing = definition.fields.filter(field => planFieldStep(field.key) === planStep && field.required && valueText(draft[field.key]) === '—')
    if (missing.length) { setError(`Preencha: ${missing.map(field => field.label).join(', ')}.`); return }
    setError(''); setPlanStep(current => Math.min(3, current + 1))
  }

  function referenceOptions(field: FieldDefinition): AdminEntityRecord[] {
    let options = field.reference ? records[field.reference] ?? [] : []
    if (field.dependsOn) {
      const expected = draft[field.dependsOn.field]
      options = options.filter((item) => String(item[field.dependsOn?.targetField ?? '']) === String(expected))
    }
    const currentId = String(draft[field.key] ?? '')
    options = options.filter((item) => upper(item.status) !== 'INATIVO' || String(item.id) === currentId)
    return [...options].sort((left, right) => (
      valueText(left[field.referenceLabel ?? 'nome'])
        .localeCompare(valueText(right[field.referenceLabel ?? 'nome']), 'pt-BR')
    ))
  }

  function checklistOptions(): AdminChecklistPlan[] {
    const assetId = String(draft.ativo_id ?? '')
    const componentId = String(draft.componente_id ?? '')
    const selectedVersionId = String(draft.checklist_versao_id ?? '')
    return checklistModels
      .filter((model) => {
        const versionId = String(model.versao_id ?? '')
        if (versionId === selectedVersionId) return true
        if (!model.operacional || Number(model.itens_count ?? 0) < 1) return false
        if (String(model.ativo_id ?? '') !== assetId) return false
        const modelComponent = String(model.componente_id ?? '')
        return modelComponent === componentId
      })
      .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'))
  }

  function relationSummary(record: AdminEntityRecord): Array<{ label: string; value: number }> {
    if (selectedEntity === 'ativos') {
      return [
        { label: 'Componentes', value: (records.componentes ?? []).filter((item) => String(item.ativo_id) === String(record.id)).length },
        { label: 'Planos', value: (records.planos ?? []).filter((item) => String(item.ativo_id) === String(record.id)).length },
      ]
    }
    if (selectedEntity === 'componentes') {
      return [
        { label: 'Planos', value: (records.planos ?? []).filter((item) => String(item.componente_id) === String(record.id)).length },
      ]
    }
    if (selectedEntity === 'planos') {
      return [
        { label: 'Etapas', value: Number(record.plano_itens_count ?? 0) },
        { label: 'Revisão', value: Number(record.revisao || 1) },
      ]
    }
    return []
  }

  async function performStatusAction(status: string, action: 'ALTERAR_STATUS' | 'PUBLICAR' = 'ALTERAR_STATUS') {
    if (!actionRecord) return
    setActionBusy(true)
    setActionError('')
    try {
      const result = await actionAdminEntity({
        entidade: selectedEntity,
        id: actionRecord.id,
        acao: action,
        status,
      })
      if (!result.row) throw new Error('O servidor não retornou o cadastro atualizado.')
      setRecords((current) => ({
        ...current,
        [selectedEntity]: (current[selectedEntity] ?? []).map((record) => (
          record.id === result.row?.id ? result.row : record
        )),
      }))
      setActionRecord(result.row)
      setNotice(`${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} atualizado para ${statusLabel(status)} com auditoria.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setActionError(cause instanceof Error ? cause.message : 'Não foi possível alterar o status.')
    } finally {
      setActionBusy(false)
    }
  }

  async function deleteRecord() {
    if (!actionRecord) return
    setActionBusy(true)
    setActionError('')
    try {
      await actionAdminEntity({
        entidade: selectedEntity,
        id: actionRecord.id,
        acao: 'EXCLUIR',
      })
      setRecords((current) => ({
        ...current,
        [selectedEntity]: (current[selectedEntity] ?? []).filter((record) => record.id !== actionRecord.id),
      }))
      setActionRecord(null)
      setConfirmDelete(false)
      setNotice(`${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} excluído. A operação foi registrada na auditoria.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setActionError(cause instanceof Error ? cause.message : 'Não foi possível excluir o cadastro.')
    } finally {
      setActionBusy(false)
    }
  }

  async function save() {
    const missing = definition.fields.filter((field) => field.required && valueText(draft[field.key]) === '—')
    if (missing.length) {
      setError(`Preencha: ${missing.map((field) => field.label).join(', ')}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await saveAdminEntity(selectedEntity, draft)
      setRecords((current) => {
        const list = current[selectedEntity] ?? []
        const next = result.mode === 'update'
          ? list.map((record) => (record.id === result.row.id ? result.row : record))
          : [result.row, ...list]
        return { ...current, [selectedEntity]: next }
      })
      setEditing(undefined)
      setNotice(`${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} ${result.mode === 'insert' ? 'criado' : 'atualizado'} com auditoria.${selectedEntity === 'planos' ? ' O plano foi salvo em rascunho. No fluxo atual, o Administrador publica a versão.' : ''}`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o cadastro.')
    } finally {
      setSaving(false)
    }
  }

  const selectedStatus = upper(actionRecord?.status)
  const selectedWorkflow = upper(actionRecord?.workflow_status)
  const selectedRelations = actionRecord ? relationSummary(actionRecord) : []
  const canDeleteSelected = Boolean(actionRecord) && (
    selectedEntity !== 'planos'
    || (
      selectedWorkflow === 'RASCUNHO'
      && !actionRecord?.revisao_origem_id
      && !actionRecord?.substitui_plano_id
    )
  )

  if (loading) return <div className="dashboard-loading">Carregando cadastros administrativos…</div>

  return (
    <section className="pcm-resource-catalog-workspace pcm-catalog-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Cadastro não concluído.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      {editing === undefined && !actionRecord ? <>
      <section className="pcm-resource-catalog-summary" data-single={scopeEntities.length === 1 && !showImports} aria-label="Listas disponíveis">
        {scopeEntities.map((entity) => {
          const item = ENTITY_DEFINITIONS[entity]
          return <button key={entity} type="button" className={selectedEntity === entity ? 'is-active' : ''} onClick={() => { setSelectedEntity(entity); setAssetContext(null); setEditing(undefined); setActionRecord(null) }}><span>{item.label}</span><small>{records[entity]?.length ?? 0}</small></button>
        })}
        {showImports ? (
          <button type="button" className="pcm-resource-catalog-import" onClick={onOpenImports}><SettingsIcon /><span><strong>Importar</strong><small>Usar modelo .xlsx</small></span></button>
        ) : null}
      </section>

      {assetContext ? <div className="pcm-asset-context"><strong>Componentes de {String(assetContext.nome)}</strong><button type="button" onClick={() => { setAssetContext(null); setSelectedEntity('ativos') }}>Ativos</button></div> : null}
      <section className="pcm-resource-catalog-panel">
        {selectedEntity === 'planos' && previewPlan ? <section className="pcm-plan-example" aria-label="Plano de exemplo"><header><strong>Exemplo fictício · não salvo</strong><button type="button" onClick={() => setPreviewPlan(false)}>Fechar exemplo</button></header><dl><dt>Plano</dt><dd>Inspeção mensal do compressor</dd><dt>Tipo</dt><dd>Preventiva</dd><dt>Programação</dt><dd>A cada 30 dias</dd><dt>Checklist</dt><dd>Inspeção técnica · 6 etapas</dd><dt>Tempo sugerido</dt><dd>35 min · estimativa indicativa</dd><dt>Parada</dt><dd>Decisão do executor</dd></dl><p>Este exemplo não gera ordens nem altera os dados da empresa.</p></section> : null}
        <header>
          <div><h2>{definition.label}</h2><button type="button" className="pcm-resource-help" aria-label="Ajuda desta lista" title={definition.description}>?</button></div>
          <div>{selectedEntity === 'planos' ? <button type="button" onClick={() => setPreviewPlan(current => !current)}>Ver exemplo</button> : null}{!approvalOnly ? <button className="primary-button" type="button" onClick={() => openEditor()}>Novo {definition.singular}</button> : null}</div>
        </header>
        {selectedEntity === 'planos' ? <p className="pcm-resource-rule" title="O plano nasce em rascunho e só pode ser publicado com um checklist validado. As assinaturas configuradas continuam obrigatórias."><CheckIcon />Publicação vinculada a checklist validado</p> : null}
        {filterKey && activeFilter && activeColumn ? <section className="pcm-column-filter" onKeyDown={event => { if (event.key === 'Escape') setFilterKey(null) }} aria-label={`Filtrar ${activeColumn.label}`}>
          <strong>{activeColumn.label}</strong>
          {numericFilter ? <label>Comparação<select value={activeFilter.operator} onChange={event => updateColumnFilter({ operator: event.target.value as PcmColumnRule['operator'] })}><option value="eq">Igual a</option><option value="neq">Diferente de</option><option value="lt">Menor que</option><option value="lte">Até</option><option value="gt">Maior que</option><option value="gte">A partir de</option></select></label> : null}
          {choiceFilter ? <label>Valor<select value={activeFilter.value} onChange={event => updateColumnFilter({ value: event.target.value })}><option value="">Todos</option>{filterChoices.map(value => <option key={value} value={value}>{knownChoices.find(option => option.value === value)?.label ?? displayCell(filterKey, value)}</option>)}</select></label> : <label>{numericFilter ? 'Valor' : 'Contém'}<input autoFocus key={filterKey} type={numericFilter ? 'number' : 'text'} step="any" value={activeFilter.value} onChange={event => updateColumnFilter({ value: event.target.value })} /></label>}
          <details className="pcm-column-order"><summary>Ordenar</summary><label>Ordem<select value={activeFilter.order ?? ''} onChange={event => updateColumnFilter({ order: event.target.value as PcmColumnRule['order'] })}><option value="">Original</option><option value="asc">{filterKey === 'criticidade' ? 'Baixa → crítica' : numericFilter ? 'Menor → maior' : 'A → Z'}</option><option value="desc">{filterKey === 'criticidade' ? 'Crítica → baixa' : numericFilter ? 'Maior → menor' : 'Z → A'}</option></select></label></details>
          <button type="button" onClick={() => { setColumnFilters(current => { const next = { ...current }; delete next[filterKey]; return next }); setFilterKey(null) }}>Limpar coluna</button><button type="button" onClick={() => setFilterKey(null)}>Concluir</button>
        </section> : null}
        {hasColumnFilters ? <div className="pcm-column-filter-summary"><span>{visibleRecords.length} resultado(s)</span><button type="button" onClick={() => { setColumnFilters({}); setFilterKey(null) }}>Limpar filtros</button></div> : null}
        <div className="pcm-resource-catalog-table">
          <table>
            <thead><tr>{definition.columns.map((column) => <th key={column.key}>{column.key === 'linha_id' ? column.label : <button type="button" className="pcm-column-trigger" aria-expanded={filterKey === column.key} aria-label={`Filtrar ${column.label}`} data-active={Boolean(columnFilters[column.key]?.value || columnFilters[column.key]?.order)} onClick={() => toggleColumnFilter(column.key)}>{column.label}<Filter size={12} /></button>}</th>)}<th>Detalhes</th></tr></thead>
            <tbody>{visibleRecords.length ? visibleRecords.map((record) => <tr key={record.id}>{definition.columns.map((column) => <td key={column.key} title={displayCell(column.key, record[column.key])}>{selectedEntity === 'ativos' && column.key === 'nome' ? <button type="button" className="pcm-asset-open" title="Ver componentes deste ativo" onClick={() => { setAssetContext(record); setSelectedEntity('componentes'); setEditing(undefined); setActionRecord(null) }}>{displayCell(column.key, record[column.key])}</button> : <span className={column.key === 'status' || column.key === 'workflow_status' ? `pcm-resource-catalog-chip pcm-resource-catalog-chip--${String(record[column.key] || '').toLowerCase()}` : ''}>{displayCell(column.key, record[column.key])}</span>}</td>)}<td><button className="pcm-resource-catalog-manage" type="button" onClick={() => openActions(record)}><MoreIcon />{approvalOnly ? 'Revisar' : 'Abrir'}</button></td></tr>) : <tr><td colSpan={definition.columns.length + 1}><div className="pcm-resource-empty-state pcm-resource-catalog-empty"><AssetIcon /><strong>{hasColumnFilters ? 'Nenhum resultado para esses filtros' : EMPTY_STATE_CONTENT[selectedEntity].title}</strong><span>{hasColumnFilters ? 'Ajuste as colunas ou limpe os filtros para ver a lista completa.' : approvalOnly ? 'Não há planos disponíveis para homologação.' : EMPTY_STATE_CONTENT[selectedEntity].description}</span>{hasColumnFilters ? <button type="button" onClick={() => { setColumnFilters({}); setFilterKey(null) }}>Limpar filtros</button> : !approvalOnly ? <button type="button" onClick={() => openEditor()}>Criar {definition.singular}</button> : null}</div></td></tr>}</tbody>
          </table>
        </div>
      </section>

      </> : null}
      {actionRecord ? (
        <div className="pcm-resource-page">
          <section className="pcm-resource-entity-actions" role="region" aria-labelledby="pcm-resource-entity-actions-title">
            <header>
              <div><h2 id="pcm-resource-entity-actions-title">{valueText(actionRecord.nome || actionRecord.tag || definition.label)}</h2></div>
              <button type="button" disabled={actionBusy} onClick={() => setActionRecord(null)}>← {definition.label}</button>
            </header>
            <div className="pcm-resource-entity-actions__body">
              <section className="pcm-resource-entity-actions__identity">
                <AssetIcon />
                <span><strong>{valueText(actionRecord.tag || actionRecord.sku || actionRecord.nome)}</strong><small>{valueText(actionRecord.nome)}</small></span>
                <i className={`pcm-resource-catalog-chip pcm-resource-catalog-chip--${String(actionRecord.workflow_status || actionRecord.status || '').toLowerCase()}`}>{statusLabel(actionRecord.workflow_status || actionRecord.status)}</i>
              </section>

              {selectedRelations.length ? <section className="pcm-resource-entity-actions__relations">{selectedRelations.map((relation) => <article key={relation.label}><strong>{relation.value}</strong><small>{relation.label}</small></article>)}</section> : null}
              {actionError ? <div className="dashboard-error" role="alert"><strong>Ação não concluída.</strong><span>{actionError}</span></div> : null}

              <section className="pcm-resource-entity-actions__commands">
                <button type="button" disabled={actionBusy} onClick={() => { const record = actionRecord; setActionRecord(null); openEditor(record) }}>
                  <AssetIcon /><span><strong>{approvalOnly || (selectedEntity === 'planos' && isProtectedPlan(actionRecord)) ? 'Visualizar cadastro' : 'Editar cadastro'}</strong><small>{approvalOnly || (selectedEntity === 'planos' && isProtectedPlan(actionRecord)) ? 'Consulta sem edição operacional.' : 'Alterar dados técnicos e vínculos permitidos.'}</small></span>
                </button>

                {!approvalOnly && selectedEntity === 'ativos' ? (
                  <>
                    {selectedStatus !== 'OPERANDO' ? <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('OPERANDO')}><CheckIcon /><span><strong>Colocar em operação</strong><small>Reativa o equipamento para novos fluxos.</small></span></button> : null}
                    {selectedStatus !== 'PARADO' ? <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('PARADO')}><StopIcon /><span><strong>Registrar parada</strong><small>Mantém o cadastro ativo, mas sinaliza indisponibilidade.</small></span></button> : null}
                    {selectedStatus !== 'INATIVO' ? <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('INATIVO')}><StopIcon /><span><strong>Desativar equipamento</strong><small>Bloqueado enquanto existirem ordens ou execuções abertas.</small></span></button> : null}
                  </>
                ) : null}

                {!approvalOnly && ['plantas', 'setores', 'linhas', 'componentes', 'materiais'].includes(selectedEntity) ? (
                  selectedStatus === 'INATIVO'
                    ? <button type="button" disabled={actionBusy} onClick={() => void performStatusAction(selectedEntity === 'componentes' ? 'OPERANDO' : 'ATIVO')}><CheckIcon /><span><strong>Reativar cadastro</strong><small>Volta a disponibilizá-lo nos novos cadastros.</small></span></button>
                    : <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('INATIVO')}><StopIcon /><span><strong>Desativar cadastro</strong><small>Preserva histórico e vínculos existentes.</small></span></button>
                ) : null}

                {selectedEntity === 'planos' && isProtectedPlan(actionRecord) ? <div className="pcm-resource-entity-actions__guidance"><CheckIcon /><span><strong>{approvalOnly ? 'Plano já homologado' : 'Versão protegida'}</strong><small>{approvalOnly ? 'A consulta é somente leitura. O PCM administra revisões técnicas e checklists.' : 'Use o construtor de checklists para abrir uma nova revisão. A versão atual não pode ser alterada ou apagada.'}</small></span></div> : null}

                {approvalOnly && selectedEntity === 'planos' && selectedWorkflow === 'RASCUNHO' ? (
                  <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('ATIVO', 'PUBLICAR')}>
                    <CheckIcon /><span><strong>{approvalOnly ? 'Homologar e publicar plano' : 'Publicar plano'}</strong><small>{approvalOnly ? 'Confirma a revisão final, registra auditoria e libera o plano para o fluxo do PCM.' : 'Valida o vínculo com o checklist e disponibiliza o plano para criar intervenções.'}</small></span>
                  </button>
                ) : null}
                {!approvalOnly && selectedEntity === 'planos' && selectedWorkflow === 'RASCUNHO' ? <div className="pcm-resource-entity-actions__guidance"><CheckIcon /><span><strong>Aguardando publicação pelo Administrador</strong><small>No fluxo atual, o PCM prepara o plano. Após a publicação, cria e libera as ordens para execução técnica.</small></span></div> : null}

                {!approvalOnly && selectedEntity === 'planos' && selectedWorkflow === 'VALIDADO' ? (
                  selectedStatus === 'INATIVO'
                    ? <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('ATIVO')}><CheckIcon /><span><strong>Reativar plano</strong><small>Volta a disponibilizar o plano para novas intervenções.</small></span></button>
                    : <button type="button" disabled={actionBusy} onClick={() => void performStatusAction('INATIVO')}><StopIcon /><span><strong>Desativar plano</strong><small>Preserva as OS e execuções já vinculadas.</small></span></button>
                ) : null}

                {!approvalOnly && canDeleteSelected ? (
                  confirmDelete
                    ? <div className="pcm-resource-entity-actions__delete-confirm"><strong>{selectedEntity === 'planos' ? 'Arquivar este rascunho?' : 'Excluir definitivamente?'}</strong><span>{selectedEntity === 'planos' ? 'Ele deixará a biblioteca, mas continuará rastreável na auditoria.' : 'Esta ação só será aceita se o servidor confirmar que não existe qualquer vínculo operacional.'}</span><div><button type="button" disabled={actionBusy} onClick={() => setConfirmDelete(false)}>Cancelar exclusão</button><button className="is-danger" type="button" disabled={actionBusy} onClick={() => void deleteRecord()}>{actionBusy ? 'Processando…' : selectedEntity === 'planos' ? 'Confirmar arquivamento' : 'Confirmar exclusão'}</button></div></div>
                    : <button className="is-danger" type="button" disabled={actionBusy} onClick={() => setConfirmDelete(true)}><StopIcon /><span><strong>{selectedEntity === 'planos' ? 'Arquivar rascunho' : 'Excluir cadastro'}</strong><small>{selectedEntity === 'planos' ? 'Remove da operação sem apagar a trilha de auditoria.' : 'Disponível somente para registro nunca utilizado.'}</small></span></button>
                ) : null}
              </section>
            </div>
            <footer><span>As ações seguem as permissões e os vínculos deste registro.</span></footer>
          </section>
        </div>
      ) : null}

      {editing !== undefined ? (
        <div className="pcm-resource-page">
          <section role="region" aria-label={`${editing ? 'Editar' : 'Novo'} ${definition.singular}`}>
            <header><div><h2>{editingReadOnly ? `Consultar ${definition.singular}` : editing ? `Editar ${definition.singular}` : `Novo ${definition.singular}`}</h2></div></header>
            {selectedEntity === 'planos' && !editingReadOnly ? <nav className="pcm-plan-steps" aria-label="Cadastro do plano">{['Nome e tipo', 'Aplicação e checklist', 'Programação', 'Revisão'].map((label, index) => <span key={label} aria-current={planStep === index ? 'step' : undefined}>{index + 1}. {label}</span>)}</nav> : null}
            {selectedEntity === 'planos' && planStep === 3 && !editingReadOnly ? <div className="pcm-plan-review-sections">{['Identificação', 'Equipamento e checklist', 'Quando e como executar'].map((title, index) => <section key={title}><h3>{title}</h3><dl className="pcm-plan-review">{definition.fields.filter(field => planFieldStep(field.key) === index && field.key !== 'recorrencia_dias' && field.key !== 'unidade').map(field => <div key={field.key}><dt>{field.key === 'gatilho_valor' ? 'Intervalo ou limite' : field.label}</dt><dd>{planReviewValue(field)}{field.key === 'gatilho_valor' ? ` ${draft.unidade || ''}` : ''}</dd></div>)}</dl></section>)}</div> : null}
            <fieldset className="pcm-resource-catalog-form" disabled={editingReadOnly || saving || loadingChecklistDefaults}>
              {definition.fields.filter(field => selectedEntity !== 'planos' || editingReadOnly || (planStep < 3 && planFieldStep(field.key) === planStep)).filter(field => selectedEntity !== 'planos' || field.key !== 'recorrencia_dias').map((field) => {
                const fieldValue = draft[field.key] ?? ''
                if (field.type === 'select') {
                  const hasCurrentOption = field.options?.some((option) => option.value === String(fieldValue))
                  return (
                    <label key={field.key}>
                      <span title={field.help}>{field.label}{field.required ? ' *' : ''}</span>
                      <select value={String(fieldValue)} onChange={(event) => updateDraftField(field, event.target.value)}>
                        {fieldValue !== '' && !hasCurrentOption ? <option value={String(fieldValue)}>{String(fieldValue)} · valor atual</option> : null}
                        {field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select>

                    </label>
                  )
                }
                if (field.type === 'reference') {
                  const dependencyMissing = field.dependsOn && !draft[field.dependsOn.field]
                  return (
                    <label key={field.key}>
                      <span title={field.help}>{field.label}{field.required ? ' *' : ''}</span>
                      <select
                        value={String(fieldValue)}
                        disabled={Boolean(dependencyMissing)}
                        onChange={(event) => updateDraftField(field, event.target.value)}
                      >
                        <option value="">{dependencyMissing ? 'Selecione o campo anterior…' : field.required ? 'Selecione…' : 'Sem vínculo'}</option>
                        {referenceOptions(field).map((option) => <option value={option.id} key={option.id}>{valueText(option.tag || option.sku || option.id)} · {valueText(option[field.referenceLabel ?? 'nome'])}</option>)}
                      </select>

                    </label>
                  )
                }
                if (field.type === 'checklist') {
                  const options = checklistOptions()
                  return (
                    <label key={field.key}>
                      <span title={field.help}>{field.label}{field.required ? ' *' : ''}</span>
                      <select
                        value={String(fieldValue)}
                        disabled={!draft.ativo_id || loadingChecklistDefaults}
                        onChange={(event) => void chooseChecklist(event.target.value)}
                      >
                        <option value="">{draft.ativo_id ? 'Selecione um checklist publicado…' : 'Selecione primeiro o ativo…'}</option>
                        {options.map((option) => (
                          <option value={String(option.versao_id ?? '')} key={String(option.versao_id ?? option.id)}>
                            {option.nome} · R{option.revisao ?? 1} · {option.itens_count ?? 0} etapas
                          </option>
                        ))}
                      </select>
                      <small>{draft.ativo_id && !options.length ? 'Nenhum checklist publicado para este ativo e componente. Crie o modelo em Checklists e conclua as assinaturas configuradas para disponibilizá-lo aqui.' : 'Use uma versão publicada para este ativo e, quando informado, para este componente. O plano será salvo em rascunho.'}</small>
                    </label>
                  )
                }
                const inputValue = field.type === 'date' && fieldValue
                  ? String(fieldValue).slice(0, 10)
                  : String(fieldValue)
                return (
                  <label key={field.key}>
                    <span title={field.help}>{field.label}{field.required ? ' *' : ''}</span>
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={inputValue}
                      onChange={(event) => updateDraftField(field, event.target.value)}
                    />

                  </label>
                )
              })}
            </fieldset>
            <footer><span>{editingReadOnly ? 'Versões em validação, validadas ou obsoletas permanecem imutáveis.' : selectedEntity === 'planos' ? 'Salvar cria um rascunho. No fluxo atual, o Administrador publica o plano com um checklist publicado.' : 'A alteração será registrada na auditoria.'}</span><div><button type="button" disabled={saving} onClick={() => setEditing(undefined)}>{editingReadOnly ? 'Fechar' : 'Cancelar'}</button>{selectedEntity === 'planos' && !editingReadOnly && planStep > 0 ? <button type="button" onClick={() => setPlanStep(current => current - 1)}>Voltar</button> : null}{selectedEntity === 'planos' && !editingReadOnly && planStep < 3 ? <button type="button" disabled={saving || loadingChecklistDefaults} onClick={advancePlanStep}>Continuar</button> : null}{!editingReadOnly && (selectedEntity !== 'planos' || planStep === 3) ? <button className="primary-button" type="button" disabled={saving || loadingChecklistDefaults} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar cadastro'}</button> : null}</div></footer>
          </section>
        </div>
      ) : null}
    </section>
  )
}
