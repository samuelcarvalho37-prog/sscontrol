import type { AuthenticatedUser } from './auth.types.js';
import { routeCapability } from './capability-catalog.js';
export function permitsRequest(
  user: Pick<AuthenticatedUser, 'capabilities'>,
  method: string,
  path: string,
  legacy: string,
): boolean {
  return user.capabilities.includes('permissions.catalog.v2')
    ? user.capabilities.includes(routeCapability(method, path, legacy))
    : user.capabilities.includes(legacy);
}
