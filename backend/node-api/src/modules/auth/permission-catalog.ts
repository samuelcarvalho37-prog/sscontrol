import { CAPABILITY_CATALOG, type CapabilityDefinition } from './capability-catalog.js';
import { INTENT_CAPABILITIES } from './capability-intent-catalog.js';
const observationPermissions: CapabilityDefinition[] = [
  ['quality', 'Qualidade'],
  ['safety', 'Segurança'],
].map(([code, area]) => ({
  id: `maintenance.shared.observe.${code}`,
  legado: `maintenance.shared.observe.${code}`,
  nome: `Registrar acompanhamento de ${area}`,
  grupo: 'Solicitações e histórico',
  acao: 'Operação',
  impacto: `Registrar observações de ${area} na ordem, respeitando a habilitação técnica e o escopo da conta. Também exige a ação de registrar observação na ordem.`,
  critico: false,
  dependencias: ['access.post.shared.orders.id.observations'],
  feature: 'ORDENS_SERVICO',
  rota: null,
}));
export const PERMISSION_CATALOG = [
  ...CAPABILITY_CATALOG,
  ...INTENT_CAPABILITIES,
  ...observationPermissions,
].filter((item) => item.id !== 'access.post.maintenance.checklists.save');
export const permissionDefinition = (code: string) =>
  PERMISSION_CATALOG.find((item) => item.id === code);
