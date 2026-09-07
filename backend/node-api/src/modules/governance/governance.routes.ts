import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import { successEnvelopeSchema } from '../auth/auth.schemas.js';
import type { GovernanceController } from './governance.controller.js';
import type { BackupController } from './backup.controller.js';
import type { ImportController } from './import.controller.js';
import {
  documentListQuerySchema,
  documentParamsSchema,
  documentUpdateBodySchema,
  documentUploadBodySchema,
  importBatchListQuerySchema,
  importBatchParamsSchema,
  importConfirmBodySchema,
  importRollbackBodySchema,
  importValidateBodySchema,
  backupCreateBodySchema,
  backupListQuerySchema,
  backupParamsSchema,
  backupRestoreBodySchema,
} from './governance.schemas.js';

const secured = {
  response: { 200: successEnvelopeSchema },
  security: [{ bearerAuth: [] }],
  tags: ['Governance'],
};

export function createGovernanceRoutes(
  controller: GovernanceController,
  imports: ImportController,
  backups: BackupController,
): FastifyPluginAsyncTypebox {
  return (app) => {
    app.get('/v1/admin/documents', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, querystring: documentListQuerySchema },
      handler: controller.listDocuments,
    });
    app.get('/v1/admin/documents/:documentId', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, params: documentParamsSchema },
      handler: controller.documentDetail,
    });
    app.post('/v1/admin/documents', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      bodyLimit: 8_700_000,
      schema: { ...secured, body: documentUploadBodySchema },
      handler: controller.uploadDocument,
    });
    app.patch('/v1/admin/documents/:documentId', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, params: documentParamsSchema, body: documentUpdateBodySchema },
      handler: controller.updateDocument,
    });
    app.get('/v1/admin/document-files/:objectId', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['Governance'],
        params: documentParamsSchema,
      },
      handler: controller.openDocumentFile,
    });
    app.get('/v1/admin/imports/models', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: secured,
      handler: imports.catalog,
    });
    app.get('/v1/admin/imports', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, querystring: importBatchListQuerySchema },
      handler: imports.list,
    });
    app.get('/v1/admin/imports/:batchId', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, params: importBatchParamsSchema },
      handler: imports.detail,
    });
    app.post('/v1/admin/imports/validate', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      bodyLimit: 3_000_000,
      schema: { ...secured, body: importValidateBodySchema },
      handler: imports.validate,
    });
    app.post('/v1/admin/imports/:batchId/confirm', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, params: importBatchParamsSchema, body: importConfirmBodySchema },
      handler: imports.confirm,
    });
    app.post('/v1/admin/imports/:batchId/rollback', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, params: importBatchParamsSchema, body: importRollbackBodySchema },
      handler: imports.rollback,
    });
    app.get('/v1/admin/backups', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { ...secured, querystring: backupListQuerySchema },
      handler: backups.list,
    });
    app.post('/v1/admin/backups', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, body: backupCreateBodySchema },
      handler: backups.create,
    });
    app.post('/v1/admin/backups/:backupId/prepare', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, params: backupParamsSchema },
      handler: backups.prepare,
    });
    app.post('/v1/admin/backups/:backupId/restore', {
      preHandler: (request) => app.authorize(request, 'admin.governance.manage'),
      schema: { ...secured, params: backupParamsSchema, body: backupRestoreBodySchema },
      handler: backups.restore,
    });
    app.get('/v1/admin/backups/:backupId/file', {
      preHandler: (request) => app.authorize(request, 'admin.governance.read'),
      schema: { security: [{ bearerAuth: [] }], tags: ['Governance'], params: backupParamsSchema },
      handler: backups.download,
    });
    return Promise.resolve();
  };
}
