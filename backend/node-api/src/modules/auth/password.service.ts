import { hash, verify, type Options } from '@node-rs/argon2';

import { AppError } from '../../core/errors/app-error.js';

const MINIMUM_PASSWORD_LENGTH = 12;
const MAXIMUM_PASSWORD_LENGTH = 128;

export interface PasswordPolicyResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export class PasswordService {
  private readonly options: Readonly<Options>;
  private dummyHashPromise: Promise<string> | null = null;

  constructor(pepper: string) {
    this.options = Object.freeze({
      algorithm: 2,
      version: 1,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      secret: Buffer.from(pepper, 'utf8'),
    });
  }

  validatePolicy(password: string): PasswordPolicyResult {
    const violations: string[] = [];

    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      violations.push(`Use pelo menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`);
    }
    if (password.length > MAXIMUM_PASSWORD_LENGTH) {
      violations.push(`Use no máximo ${MAXIMUM_PASSWORD_LENGTH} caracteres.`);
    }
    if (!/[a-z]/u.test(password)) {
      violations.push('Inclua ao menos uma letra minúscula.');
    }
    if (!/[A-Z]/u.test(password)) {
      violations.push('Inclua ao menos uma letra maiúscula.');
    }
    if (!/[0-9]/u.test(password)) {
      violations.push('Inclua ao menos um número.');
    }
    if (!/[^\p{L}\p{N}\s]/u.test(password)) {
      violations.push('Inclua ao menos um caractere especial.');
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  assertPolicy(password: string): void {
    const result = this.validatePolicy(password);
    if (result.valid) return;

    throw new AppError({
      code: 'AUTH_PASSWORD_POLICY_FAILED',
      message: 'A nova senha não atende à política de segurança.',
      statusCode: 422,
      details: { violations: result.violations },
    });
  }

  async hash(password: string): Promise<string> {
    this.assertPolicy(password);
    return hash(password, this.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password, this.options);
    } catch {
      return false;
    }
  }

  async consumeDummyVerification(password: string): Promise<void> {
    this.dummyHashPromise ??= hash('FabControl!Dummy-Password-2026', this.options);
    const dummyHash = await this.dummyHashPromise;
    await verify(dummyHash, password, this.options);
  }
}
