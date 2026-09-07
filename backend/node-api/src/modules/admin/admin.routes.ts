import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { AdminController } from './admin.controller.js';
import {
  adminIdentifierParamsSchema,
  auditListQuerySchema,
  commercialDraftBodySchema,
  commercialPlansBodySchema,
  companyBodySchema,
  configurationBodySchema,
  configurationDraftBodySchema,
  permissionBodySchema,
  publishDraftBodySchema,
  resetPasswordBodySchema,
  rollbackBodySchema,
  saveTechnicalAreaBodySchema,
  saveTechnicalRoleBodySchema,
  saveUserBodySchema,
  technicalAreaQuerySchema,
  technicalRoleQuerySchema,
  userListQuerySchema,
  versionListQuerySchema,
} from './admin.schemas.js';
import { Type } from '@fastify/type-provider-typebox';

const secured = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['Administration'],
};

export function createAdminRoutes(controller: AdminController): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/admin/users', {
      preHandler: (request) => app.authorize(request, 'admin.identity.read'),
      schema: { ...secured, querystring: userListQuerySchema },
      handler: controller.listUsers,
    });
    app.post('/v1/admin/users', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, body: saveUserBodySchema },
      handler: controller.createUser,
    });
    app.patch('/v1/admin/users/:userId', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, params: adminIdentifierParamsSchema, body: saveUserBodySchema },
      handler: controller.updateUser,
    });
    app.post('/v1/admin/users/:userId/unlock', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, params: adminIdentifierParamsSchema },
      handler: controller.unlockUser,
    });
    app.post('/v1/admin/users/:userId/reset-password', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, params: adminIdentifierParamsSchema, body: resetPasswordBodySchema },
      handler: controller.resetPassword,
    });
    app.post('/v1/admin/users/:userId/revoke-sessions', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, params: adminIdentifierParamsSchema },
      handler: controller.revokeSessions,
    });

    app.get('/v1/admin/technical-areas', {
      preHandler: (request) => app.authorize(request, 'admin.identity.read'),
      schema: { ...secured, querystring: technicalAreaQuerySchema },
      handler: controller.listAreas,
    });
    app.post('/v1/admin/technical-areas', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, body: saveTechnicalAreaBodySchema },
      handler: controller.createArea,
    });
    app.patch('/v1/admin/technical-areas/:areaId', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: {
        ...secured,
        params: adminIdentifierParamsSchema,
        body: saveTechnicalAreaBodySchema,
      },
      handler: controller.updateArea,
    });
    app.get('/v1/admin/technical-roles', {
      preHandler: (request) => app.authorize(request, 'admin.identity.read'),
      schema: { ...secured, querystring: technicalRoleQuerySchema },
      handler: controller.listRoles,
    });
    app.post('/v1/admin/technical-roles', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, body: saveTechnicalRoleBodySchema },
      handler: controller.createRole,
    });
    app.patch('/v1/admin/technical-roles/:roleId', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: {
        ...secured,
        params: adminIdentifierParamsSchema,
        body: saveTechnicalRoleBodySchema,
      },
      handler: controller.updateRole,
    });

    app.get('/v1/admin/permissions', {
      preHandler: (request) => app.authorize(request, 'admin.identity.read'),
      schema: secured,
      handler: controller.permissionMatrix,
    });
    app.patch('/v1/admin/permissions/:profile', {
      preHandler: (request) => app.authorize(request, 'admin.identity.manage'),
      schema: { ...secured, params: adminIdentifierParamsSchema, body: permissionBodySchema },
      handler: controller.savePermissions,
    });
    app.get('/v1/admin/company', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: secured,
      handler: controller.company,
    });
    app.patch('/v1/admin/company', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      bodyLimit: 7_500_000,
      schema: { ...secured, body: companyBodySchema },
      handler: controller.saveCompany,
    });
    app.get('/v1/admin/commercial-access', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: secured,
      handler: controller.commercialAccess,
    });
    app.get('/v1/admin/configuration', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: secured,
      handler: controller.configurationState,
    });
    app.post('/v1/admin/configuration/validate', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: configurationBodySchema },
      handler: controller.validateConfiguration,
    });
    app.post('/v1/admin/configuration/drafts', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: configurationDraftBodySchema },
      handler: controller.saveConfigurationDraft,
    });
    app.get('/v1/admin/configuration/versions', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, querystring: versionListQuerySchema },
      handler: controller.listConfigurationVersions,
    });
    app.post('/v1/admin/configuration/publish', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: publishDraftBodySchema },
      handler: controller.publishConfiguration,
    });
    app.post('/v1/admin/configuration/rollback', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: rollbackBodySchema },
      handler: controller.rollbackConfiguration,
    });

    app.get('/v1/platform/motor/catalog', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: secured,
      handler: controller.platformMotorCatalog,
    });
    app.post('/v1/platform/motor/catalog/validate', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: commercialPlansBodySchema },
      handler: controller.validatePlatformMotorCatalog,
    });
    app.post('/v1/platform/motor/catalog/drafts', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: commercialDraftBodySchema },
      handler: controller.savePlatformMotorCatalogDraft,
    });
    app.get('/v1/platform/motor/catalog/versions', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, querystring: versionListQuerySchema },
      handler: controller.listPlatformMotorCatalogVersions,
    });
    app.post('/v1/platform/motor/catalog/publish', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: publishDraftBodySchema },
      handler: controller.publishPlatformMotorCatalog,
    });
    app.post('/v1/platform/motor/catalog/rollback', {
      preHandler: (request) => app.authorize(request, 'admin.configuration.manage'),
      schema: { ...secured, body: rollbackBodySchema },
      handler: controller.rollbackPlatformMotorCatalog,
    });
    app.get('/v1/admin/audit', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, querystring: auditListQuerySchema },
      handler: controller.listAudit,
    });
    app.get('/v1/admin/monitoring', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: secured,
      handler: controller.monitoring,
    });
    app.get('/v1/admin/technical-analyses', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: secured,
      handler: controller.listAnalyses,
    });
    app.get('/v1/admin/technical-demands', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: {
        ...secured,
        querystring: Type.Object(
          { limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) },
          { additionalProperties: false },
        ),
      },
      handler: controller.listDemands,
    });
    return Promise.resolve();
  };
}
