import type { AdminIntervention } from '../types/interventions'
import type { AdminEntityRecord } from '../types/catalog'

function dateOffset(days: number, hours = 9) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hours, 0, 0, 0)
  return date.toISOString()
}

export function createPcmDemoSnapshot() {
  const now = new Date().toISOString()
  const orders: AdminIntervention[] = [
    { id: 'demo-os-204', codigo: 'OS-2026-0204', origem: 'DEMO', tipo: 'CORRECTIVE', titulo: 'Vibração elevada no conjunto', descricao: 'Exemplo fictício de análise de vibração.', prioridade: 'CRITICAL', status: 'IN_PROGRESS', planejada_para: dateOffset(-2), criado_em: dateOffset(-4), ativo_tag: 'EQ-PA-01', ativo_nome: 'Pasteurizador contínuo', setor_nome: 'Pasteurização', responsavel_nome: 'Diego Martins' },
    { id: 'demo-os-219', codigo: 'OS-2026-0219', origem: 'DEMO', tipo: 'CORRECTIVE', titulo: 'Vazamento na bomba de transferência', descricao: 'Exemplo fictício de corretiva.', prioridade: 'HIGH', status: 'OPEN', planejada_para: dateOffset(-1), criado_em: dateOffset(-2), ativo_tag: 'EQ-TR-02', ativo_nome: 'Bomba sanitária', setor_nome: 'Processo', responsavel_nome: 'Camila Duarte' },
    { id: 'demo-os-225', codigo: 'OS-2026-0225', origem: 'DEMO', tipo: 'PREVENTIVE', titulo: 'Inspeção preventiva do tanque', descricao: 'Exemplo fictício de preventiva.', prioridade: 'HIGH', status: 'RELEASED', planejada_para: dateOffset(1), criado_em: dateOffset(-1), ativo_tag: 'EQ-TQ-01', ativo_nome: 'Tanque encamisado', setor_nome: 'Preparação', responsavel_nome: 'Rafael Martins' },
    { id: 'demo-os-231', codigo: 'OS-2026-0231', origem: 'DEMO', tipo: 'CORRECTIVE', titulo: 'Ajuste de alinhamento', descricao: 'Exemplo fictício em acompanhamento.', prioridade: 'MEDIUM', status: 'OPEN', planejada_para: dateOffset(3), criado_em: dateOffset(-1), ativo_tag: 'EQ-EM-01', ativo_nome: 'Envasadora automática', setor_nome: 'Envase', responsavel_nome: 'Diego Martins' },
    { id: 'demo-os-237', codigo: 'OS-2026-0237', origem: 'DEMO', tipo: 'PREVENTIVE', titulo: 'Lubrificação e inspeção', descricao: 'Exemplo fictício de preventiva.', prioridade: 'MEDIUM', status: 'OPEN', planejada_para: dateOffset(5), criado_em: dateOffset(0), ativo_tag: 'EQ-RO-01', ativo_nome: 'Rotuladora', setor_nome: 'Embalagem', responsavel_nome: 'Camila Duarte' },
    { id: 'demo-os-242', codigo: 'OS-2026-0242', origem: 'DEMO', tipo: 'CORRECTIVE', titulo: 'Troca de vedação', descricao: 'Exemplo fictício de corretiva.', prioridade: 'LOW', status: 'COMPLETED', planejada_para: dateOffset(-3), criado_em: dateOffset(-5), ativo_tag: 'EQ-TR-02', ativo_nome: 'Bomba sanitária', setor_nome: 'Processo', responsavel_nome: 'Rafael Martins' },
  ]

  const plans: AdminEntityRecord[] = [
    { id: 'demo-plano-001', versao_id: 'demo-versao-001', ativo_id: 'demo-ativo-001', codigo: 'PM-PA-030', nome: 'Inspeção do pasteurizador', ativo_tag: 'EQ-PA-01', ativo_nome: 'Pasteurizador contínuo', tipo: 'PREVENTIVE', recorrencia_dias: 30, versao_status: 'PUBLISHED', status: 'ACTIVE', plano_itens_count: 8 },
    { id: 'demo-plano-002', versao_id: 'demo-versao-002', ativo_id: 'demo-ativo-002', codigo: 'PM-TR-015', nome: 'Bomba sanitária', ativo_tag: 'EQ-TR-02', ativo_nome: 'Bomba sanitária', tipo: 'PREVENTIVE', recorrencia_dias: 15, versao_status: 'PUBLISHED', status: 'ACTIVE', plano_itens_count: 6 },
    { id: 'demo-plano-003', versao_id: 'demo-versao-003', ativo_id: 'demo-ativo-003', codigo: 'PM-TQ-060', nome: 'Tanque de preparação', ativo_tag: 'EQ-TQ-01', ativo_nome: 'Tanque encamisado', tipo: 'PREVENTIVE', recorrencia_dias: 60, versao_status: 'PUBLISHED', status: 'ACTIVE', plano_itens_count: 9 },
  ]

  return {
    orders,
    plans,
    data: {
      atualizado_em: now,
      atual: { ativos_parados: 2, ordens_abertas: 5, ordens_criticas: 1, ordens_atrasadas: 2, preventivas_proximas: 3, backlog_horas_estimadas: 54, ordens_sem_estimativa: 1, tecnicos_em_atividade: 3 },
      confiabilidade: { ativos_considerados: 12, falhas: 7, mttr_segundos: 13800, mtbf_segundos: 312000, disponibilidade_percentual: 97.4, reincidencias: 2, ativos_reincidentes: 2 },
      confiabilidade_mensal: [
        { mes: '2026-05', mttr_segundos: 18600 }, { mes: '2026-06', mttr_segundos: 16200 },
        { mes: '2026-07', mttr_segundos: 17400 }, { mes: '2026-08', mttr_segundos: 14400 },
        { mes: '2026-09', mttr_segundos: 15600 }, { mes: '2026-10', mttr_segundos: 13800 },
      ],
      falhas_por_ativo: [
        { ativo_id: 'demo-ativo-001', ativo_tag: 'EQ-PA-01', ativo_nome: 'Pasteurizador contínuo', setor_nome: 'Pasteurização', falhas: 3 },
        { ativo_id: 'demo-ativo-002', ativo_tag: 'EQ-TR-02', ativo_nome: 'Bomba sanitária', setor_nome: 'Processo', falhas: 2 },
        { ativo_id: 'demo-ativo-004', ativo_tag: 'EQ-EM-01', ativo_nome: 'Envasadora automática', setor_nome: 'Envase', falhas: 2 },
      ],
      falhas_por_setor: [
        { setor_id: 'demo-setor-01', setor_nome: 'Pasteurização', falhas: 3 },
        { setor_id: 'demo-setor-02', setor_nome: 'Processo', falhas: 2 },
        { setor_id: 'demo-setor-03', setor_nome: 'Envase', falhas: 2 },
      ],
      ativos_parados_lista: [
        { id: 'demo-ativo-001', ativo_tag: 'EQ-PA-01', ativo_nome: 'Pasteurizador contínuo', setor_nome: 'Pasteurização', motivo_parada: 'Vibração elevada', parada_iniciada_em: dateOffset(-1, 14), parada_status: 'ABERTA' },
        { id: 'demo-ativo-002', ativo_tag: 'EQ-TR-02', ativo_nome: 'Bomba sanitária', setor_nome: 'Processo', motivo_parada: 'Vazamento em vedação', parada_iniciada_em: dateOffset(0, 7), parada_status: 'ABERTA' },
      ],
      preventivas: [
        { id: 'demo-prev-001', codigo: 'PM-PA-030', ativo_tag: 'EQ-PA-01', programada_para: dateOffset(1) },
        { id: 'demo-prev-002', codigo: 'PM-TR-015', ativo_tag: 'EQ-TR-02', programada_para: dateOffset(3) },
        { id: 'demo-prev-003', codigo: 'PM-TQ-060', ativo_tag: 'EQ-TQ-01', programada_para: dateOffset(6) },
      ],
      tecnicos: [
        { id: 'demo-tec-001', nome: 'Diego Martins', execucoes: 2 },
        { id: 'demo-tec-002', nome: 'Camila Duarte', execucoes: 1 },
        { id: 'demo-tec-003', nome: 'Rafael Martins', execucoes: 1 },
      ],
      relatorios: {
        mttr_mensal: [
          { mes: '2026-05', mttr_segundos: 18600 }, { mes: '2026-06', mttr_segundos: 16200 },
          { mes: '2026-07', mttr_segundos: 17400 }, { mes: '2026-08', mttr_segundos: 14400 },
          { mes: '2026-09', mttr_segundos: 15600 }, { mes: '2026-10', mttr_segundos: 13800 },
        ],
        ordens: { abertas: 5, concluidas_no_periodo: 18, atrasadas: 2, por_tipo: [{ tipo: 'CORRECTIVE', quantidade: 9 }, { tipo: 'PREVENTIVE', quantidade: 7 }, { tipo: 'IMPROVEMENT', quantidade: 2 }], por_prioridade: [{ prioridade: 'CRITICAL', quantidade: 1 }, { prioridade: 'HIGH', quantidade: 2 }, { prioridade: 'MEDIUM', quantidade: 2 }] },
        preventivas: { programadas_no_periodo: 22, concluidas_no_prazo: 16, concluidas_com_atraso: 2, pendentes: 4 },
        tecnicos: [
          { id: 'demo-tec-001', nome: 'Diego Martins', execucoes: 8, segundos_apontados: 86400 },
          { id: 'demo-tec-002', nome: 'Camila Duarte', execucoes: 6, segundos_apontados: 64800 },
          { id: 'demo-tec-003', nome: 'Rafael Martins', execucoes: 4, segundos_apontados: 50400 },
        ],
        custos_materiais: { total: 2840, itens_consumidos: 16, ordens_com_consumo: 9, por_ativo: [{ ativo_tag: 'EQ-PA-01', ativo_nome: 'Pasteurizador contínuo', itens_consumidos: 5, custo_total: 1180 }] },
        estoque_baixo: { quantidade: 2, itens: [{ sku: 'VED-044', nome: 'Kit de vedação sanitária', unidade: 'un', estoque_atual: 1, estoque_minimo: 3, valor_unitario: 145 }] },
      },
    },
  }
}
