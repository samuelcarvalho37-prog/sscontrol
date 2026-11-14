import { CAPABILITY_CATALOG, type CapabilityDefinition } from './capability-catalog.js';

const resources = [
  { route: '/v1/cmms/plants/:plantId', label: 'plantas' },
  { route: '/v1/cmms/sectors/:sectorId', label: 'setores' },
  { route: '/v1/cmms/lines/:lineId', label: 'linhas' },
  { route: '/v1/cmms/assets/:assetId', label: 'ativos' },
  { route: '/v1/cmms/components/:componentId', label: 'componentes' },
  { route: '/v1/cmms/materials/:materialId', label: 'materiais' },
  { route: '/v1/maintenance/plans/:planId', label: 'planos de manutenção' },
];

export const INTENT_CAPABILITIES: readonly CapabilityDefinition[] = resources.flatMap(
  ({ route, label }) => {
    const original = CAPABILITY_CATALOG.find((item) => item.rota === `PATCH ${route}`);
    if (!original) throw new Error(`Permissão de edição ausente para ${route}.`);
    const intents = [
      {
        suffix: 'status',
        nome: `Ativar, desativar ou alterar situação de ${label}`,
        acao: 'Situação',
        impacto: `Alterar a situação de ${label}, sem permitir editar os demais dados ou arquivar registros.`,
        critico: false,
      },
      {
        suffix: 'archive',
        nome: `Arquivar ou restaurar ${label}`,
        acao: 'Arquivamento',
        impacto: `Arquivar ou restaurar ${label}, preservando as restrições de vínculos e auditoria. Não concede edição dos demais dados.`,
        critico: true,
      },
      ...(route.includes('/materials/')
        ? [
            {
              suffix: 'stock',
              nome: 'Alterar saldo e mínimo de estoque',
              acao: 'Estoque',
              impacto:
                'Alterar o saldo e o estoque mínimo de materiais, sem conceder alteração de custos ou dos demais dados.',
              critico: true,
            },
            {
              suffix: 'cost',
              nome: 'Alterar custo de materiais',
              acao: 'Custos',
              impacto:
                'Alterar o custo unitário de materiais, sem conceder movimentação de saldo ou edição dos demais dados.',
              critico: true,
            },
          ]
        : []),
    ];
    return intents.map((intent) => ({
      ...original,
      id: `${original.id}.${intent.suffix}`,
      nome: intent.nome,
      acao: intent.acao,
      impacto: intent.impacto,
      critico: intent.critico,
      dependencias: [],
      rota: null,
    }));
  },
);
