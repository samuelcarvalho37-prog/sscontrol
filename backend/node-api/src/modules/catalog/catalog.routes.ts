import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { CatalogController } from './catalog.controller.js';
import {
  assetHistoryQuerySchema,
  codeParamsSchema,
  createAssetBodySchema,
  createComponentBodySchema,
  createLineBodySchema,
  createMaterialBodySchema,
  createParameterBodySchema,
  createPlantBodySchema,
  createPolicyBodySchema,
  createReadingBodySchema,
  createScopedReadingBodySchema,
  createSectorBodySchema,
  identifierParamsSchema,
  listAssetsQuerySchema,
  listComponentsQuerySchema,
  listMaterialsQuerySchema,
  listReadingsQuerySchema,
  structureQuerySchema,
  updateAssetBodySchema,
  updateComponentBodySchema,
  updateLineBodySchema,
  updateMaterialBodySchema,
  updateParameterBodySchema,
  updatePlantBodySchema,
  updateSectorBodySchema,
} from './catalog.schemas.js';

const securedResponse = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['CMMS Catalog'],
};

export function createCatalogRoutes(controller: CatalogController): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/cmms/structure', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.read'),
      schema: {
        ...securedResponse,
        querystring: structureQuerySchema,
        summary: 'Consulta a árvore de plantas, setores e linhas.',
      },
      handler: controller.structure,
    });

    app.post('/v1/cmms/plants', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        body: createPlantBodySchema,
        summary: 'Cadastra uma planta.',
      },
      handler: controller.createPlant,
    });

    app.patch('/v1/cmms/plants/:plantId', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updatePlantBodySchema,
        summary: 'Altera ou desativa uma planta.',
      },
      handler: controller.updatePlant,
    });

    app.post('/v1/cmms/sectors', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        body: createSectorBodySchema,
        summary: 'Cadastra um setor em uma planta ativa.',
      },
      handler: controller.createSector,
    });

    app.patch('/v1/cmms/sectors/:sectorId', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateSectorBodySchema,
        summary: 'Altera ou desativa um setor.',
      },
      handler: controller.updateSector,
    });

    app.post('/v1/cmms/lines', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        body: createLineBodySchema,
        summary: 'Cadastra uma linha em um setor ativo.',
      },
      handler: controller.createLine,
    });

    app.patch('/v1/cmms/lines/:lineId', {
      preHandler: async (request) => app.authorize(request, 'cmms.structure.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateLineBodySchema,
        summary: 'Altera ou desativa uma linha.',
      },
      handler: controller.updateLine,
    });

    app.get('/v1/cmms/assets', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        querystring: listAssetsQuerySchema,
        summary: 'Pesquisa ativos com filtros e paginação por cursor.',
      },
      handler: controller.listAssets,
    });

    app.get('/v1/cmms/assets/resolve/:code', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        params: codeParamsSchema,
        summary: 'Resolve TAG ou QR Code de equipamento ou componente.',
      },
      handler: controller.resolveCode,
    });

    app.get('/v1/cmms/qr-context/:code', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        params: codeParamsSchema,
        summary: 'Resolve QR/TAG e entrega o contexto operacional completo em uma consulta.',
      },
      handler: controller.getQrContext,
    });

    app.get('/v1/cmms/assets/:assetId', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        summary: 'Consulta a ficha técnica completa de um ativo.',
      },
      handler: controller.getAsset,
    });

    app.get('/v1/cmms/assets/:assetId/history', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        querystring: assetHistoryQuerySchema,
        summary: 'Consulta o histórico técnico paginado de um ativo ou componente.',
      },
      handler: controller.getAssetHistory,
    });

    app.post('/v1/cmms/assets', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.manage'),
      schema: {
        ...securedResponse,
        body: createAssetBodySchema,
        summary: 'Cadastra um ativo e gera seu QR Code canônico.',
      },
      handler: controller.createAsset,
    });

    app.post('/v1/cmms/assets/:assetId/readings', {
      preHandler: async (request) => app.authorize(request, 'cmms.readings.create'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: createScopedReadingBodySchema,
        summary: 'Registra leitura manual pelo contexto do equipamento ou componente.',
      },
      handler: controller.createScopedReading,
    });

    app.patch('/v1/cmms/assets/:assetId', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateAssetBodySchema,
        summary: 'Altera estado e ficha técnica de um ativo.',
      },
      handler: controller.updateAsset,
    });

    app.get('/v1/cmms/assets/:assetId/components', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        summary: 'Lista os componentes de um ativo.',
      },
      handler: controller.listComponents,
    });

    app.get('/v1/cmms/components', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.read'),
      schema: {
        ...securedResponse,
        querystring: listComponentsQuerySchema,
        summary: 'Pesquisa componentes no catÃ¡logo tÃ©cnico do tenant.',
      },
      handler: controller.listAllComponents,
    });

    app.post('/v1/cmms/components', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.manage'),
      schema: {
        ...securedResponse,
        body: createComponentBodySchema,
        summary: 'Cadastra um componente e gera seu QR Code canônico.',
      },
      handler: controller.createComponent,
    });

    app.patch('/v1/cmms/components/:componentId', {
      preHandler: async (request) => app.authorize(request, 'cmms.assets.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateComponentBodySchema,
        summary: 'Altera estado e ficha técnica de um componente.',
      },
      handler: controller.updateComponent,
    });

    app.get('/v1/cmms/materials', {
      preHandler: async (request) => app.authorize(request, 'cmms.materials.read'),
      schema: {
        ...securedResponse,
        querystring: listMaterialsQuerySchema,
        summary: 'Consulta materiais, estoque e necessidade de reposição.',
      },
      handler: controller.listMaterials,
    });

    app.post('/v1/cmms/materials', {
      preHandler: async (request) => app.authorize(request, 'cmms.materials.manage'),
      schema: {
        ...securedResponse,
        body: createMaterialBodySchema,
        summary: 'Cadastra um material técnico.',
      },
      handler: controller.createMaterial,
    });

    app.patch('/v1/cmms/materials/:materialId', {
      preHandler: async (request) => app.authorize(request, 'cmms.materials.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateMaterialBodySchema,
        summary: 'Altera estoque, dados cadastrais ou situação de um material.',
      },
      handler: controller.updateMaterial,
    });

    app.post('/v1/cmms/parameters', {
      preHandler: async (request) => app.authorize(request, 'cmms.parameters.manage'),
      schema: {
        ...securedResponse,
        body: createParameterBodySchema,
        summary: 'Cadastra uma definição de parâmetro técnico.',
      },
      handler: controller.createParameter,
    });

    app.patch('/v1/cmms/parameters/:parameterId', {
      preHandler: async (request) => app.authorize(request, 'cmms.parameters.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: updateParameterBodySchema,
        summary: 'Altera ou desativa uma definição de parâmetro.',
      },
      handler: controller.updateParameter,
    });

    app.post('/v1/cmms/parameters/:parameterId/policies', {
      preHandler: async (request) => app.authorize(request, 'cmms.parameters.manage'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: createPolicyBodySchema,
        summary: 'Publica uma versão imutável dos limites de um parâmetro.',
      },
      handler: controller.publishPolicy,
    });

    app.get('/v1/cmms/parameters/:parameterId/readings', {
      preHandler: async (request) => app.authorize(request, 'cmms.parameters.read'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        querystring: listReadingsQuerySchema,
        summary: 'Consulta o histórico classificado de leituras.',
      },
      handler: controller.listReadings,
    });

    app.post('/v1/cmms/parameters/:parameterId/readings', {
      preHandler: async (request) => app.authorize(request, 'cmms.readings.create'),
      schema: {
        ...securedResponse,
        params: identifierParamsSchema,
        body: createReadingBodySchema,
        summary: 'Registra e classifica uma leitura técnica idempotente.',
      },
      handler: controller.createReading,
    });

    return Promise.resolve();
  };
}
