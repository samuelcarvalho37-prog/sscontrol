import { createHmac, timingSafeEqual } from 'node:crypto';

const MAINTENANCE_CHALLENGE_CONTEXT = 'FAB_CONTROL_MAINTENANCE_CHALLENGE_V1';

export function normalizeMaintenanceCode(code: string): string {
  return code.trim();
}

export function hashMaintenanceCode(secret: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`${MAINTENANCE_CHALLENGE_CONTEXT}:${normalizeMaintenanceCode(code)}`, 'utf8')
    .digest('hex');
}

export function verifyMaintenanceCode(secret: string, code: string, expectedHash: string): boolean {
  const calculated = Buffer.from(hashMaintenanceCode(secret, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return calculated.length === expected.length && timingSafeEqual(calculated, expected);
}
