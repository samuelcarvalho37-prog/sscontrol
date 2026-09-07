import type { Environment } from '../../config/environment.js';
import type { Database } from '../../infrastructure/database/database.js';

export class SystemService {
  constructor(
    private readonly environment: Environment,
    private readonly database: Database,
  ) {}

  liveness() {
    return {
      ok: true,
      app: 'fab-control-api',
      version: this.environment.release.api,
      release_version: this.environment.release.app,
      server_time: new Date().toISOString(),
    };
  }

  async readiness() {
    const database = await this.database.healthcheck();
    return {
      ok: true,
      app: 'fab-control-api',
      version: this.environment.release.api,
      release_version: this.environment.release.app,
      schema_version: this.environment.release.schema,
      database: {
        ready: true,
        latency_ms: database.latencyMs,
      },
      server_time: new Date().toISOString(),
    };
  }

  bootstrap() {
    return {
      app: 'fab-control-api',
      environment: this.environment.release.environment,
      release_version: this.environment.release.app,
      api_version: this.environment.release.api,
      schema_version: this.environment.release.schema,
      contract_version: this.environment.release.contract,
      frontend_version: this.environment.release.frontend,
      authentication: {
        strategy: 'OPAQUE_BEARER_SESSION',
        login_endpoint: '/v1/auth/login',
        first_access_endpoint: '/v1/auth/first-access',
        recovery_endpoint: '/v1/auth/recovery',
      },
      capabilities: {
        row_level_security: true,
        immutable_audit: true,
        permanent_signatures: true,
        transactional_outbox: true,
      },
    };
  }
}
