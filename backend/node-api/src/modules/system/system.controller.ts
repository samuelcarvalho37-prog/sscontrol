import type { FastifyRequest } from 'fastify';

import { successEnvelope } from '../../core/http/envelope.js';
import type { SystemService } from './system.service.js';

export class SystemController {
  constructor(private readonly service: SystemService) {}

  liveness = (request: FastifyRequest) =>
    successEnvelope(request, 'sistema.health.live', this.service.liveness());

  readiness = async (request: FastifyRequest) =>
    successEnvelope(request, 'sistema.health.ready', await this.service.readiness());

  bootstrap = (request: FastifyRequest) =>
    successEnvelope(request, 'sistema.bootstrap', this.service.bootstrap());
}
