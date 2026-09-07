import type { Environment } from '../config/environment.js';
import type { Database } from '../infrastructure/database/database.js';
import type { ObjectStorage } from '../infrastructure/storage/object-storage.js';
import type { AuthContext } from '../modules/auth/auth.types.js';

declare module 'fastify' {
  interface FastifyInstance {
    readonly environment: Environment;
    readonly database: Database;
    readonly objectStorage: ObjectStorage;
    authenticate(request: FastifyRequest): Promise<void>;
    authorize(request: FastifyRequest, capability: string): Promise<void>;
  }

  interface FastifyRequest {
    startedAt: bigint;
    auth: AuthContext | null;
  }
}
