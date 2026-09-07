import { createHash, createHmac, randomBytes } from 'node:crypto';

import type { SessionPurpose } from './auth.types.js';

export interface SessionToken {
  readonly raw: string;
  readonly hash: string;
}

export class TokenService {
  constructor(private readonly digestSecret: string) {}

  createSessionToken(purpose: SessionPurpose): SessionToken {
    const prefix = purpose === 'APPLICATION' ? 'fcs' : purpose === 'FIRST_ACCESS' ? 'fcf' : 'fcm';
    const raw = `${prefix}_${randomBytes(32).toString('base64url')}`;
    return { raw, hash: this.hashSessionToken(raw) };
  }

  hashSessionToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  digestEmployeeNumber(employeeNumber: string): string {
    return createHmac('sha256', this.digestSecret).update(employeeNumber, 'utf8').digest('hex');
  }

  createRecoveryMaterial(): {
    readonly publicReference: string;
    readonly secretHash: string;
  } {
    const publicReference = `REC-${randomBytes(6).toString('hex').toUpperCase()}`;
    const secret = randomBytes(32).toString('base64url');
    return {
      publicReference,
      secretHash: createHash('sha256').update(secret, 'utf8').digest('hex'),
    };
  }
}
