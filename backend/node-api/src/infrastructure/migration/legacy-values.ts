import { createHash } from 'node:crypto';

import type { SourceRowPayload, SourceScalar } from './source-snapshot.js';

export class LegacyValueError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = 'LegacyValueError';
    this.code = code;
    this.field = field;
  }
}

export function hashSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deterministicUuid(namespace: string, sourceName: string, legacyId: string): string {
  const bytes = createHash('sha256')
    .update(`${namespace}\u001f${sourceName}\u001f${legacyId}`, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function optionalText(value: SourceScalar | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function text(row: SourceRowPayload, field: string, fallback?: string): string {
  const value = optionalText(row[field]);
  if (value !== null) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new LegacyValueError(
    'REQUIRED_VALUE_MISSING',
    field,
    `Campo obrigatório ausente: ${field}.`,
  );
}

export function upper(value: SourceScalar | undefined): string | null {
  const normalized = optionalText(value);
  return normalized?.toUpperCase() ?? null;
}

export function booleanValue(value: SourceScalar | undefined, fallback?: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const normalized = upper(value);
  if (normalized === null && fallback !== undefined) {
    return fallback;
  }
  if (['SIM', 'S', 'TRUE', 'VERDADEIRO', 'YES', 'Y', '1', 'ATIVO'].includes(normalized ?? '')) {
    return true;
  }
  if (['NAO', 'NÃO', 'N', 'FALSE', 'FALSO', 'NO', '0', 'INATIVO'].includes(normalized ?? '')) {
    return false;
  }
  throw new LegacyValueError(
    'INVALID_BOOLEAN',
    'boolean',
    `Valor booleano inválido: ${String(value)}.`,
  );
}

export function numberValue(
  value: SourceScalar | undefined,
  field: string,
  fallback?: number,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const normalized = optionalText(value);
  if (normalized === null && fallback !== undefined) {
    return fallback;
  }
  if (normalized === null) {
    throw new LegacyValueError(
      'REQUIRED_VALUE_MISSING',
      field,
      `Campo numérico ausente: ${field}.`,
    );
  }
  const canonical = normalized
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(canonical);
  if (!Number.isFinite(parsed)) {
    throw new LegacyValueError(
      'INVALID_NUMBER',
      field,
      `Número inválido em ${field}: ${normalized}.`,
    );
  }
  return parsed;
}

export function optionalNumber(value: SourceScalar | undefined, field: string): number | null {
  return optionalText(value) === null ? null : numberValue(value, field);
}

export function integerValue(
  value: SourceScalar | undefined,
  field: string,
  fallback?: number,
): number {
  const parsed = numberValue(value, field, fallback);
  if (!Number.isSafeInteger(parsed)) {
    throw new LegacyValueError(
      'INVALID_INTEGER',
      field,
      `Inteiro inválido em ${field}: ${parsed}.`,
    );
  }
  return parsed;
}

export function jsonValue(
  value: SourceScalar | undefined,
  field: string,
  fallback: unknown,
): unknown {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new LegacyValueError('INVALID_JSON', field, `JSON inválido em ${field}.`);
  }
}

function offsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedAsUtc - date.getTime();
}

function localTimestampToUtc(value: string, timeZone: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value);
  if (!match) {
    return null;
  }
  const localAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
    Number((match[7] ?? '').padEnd(3, '0') || 0),
  );
  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = new Date(localAsUtc - offsetMilliseconds(candidate, timeZone));
  }
  return candidate;
}

export function timestamp(
  value: SourceScalar | undefined,
  field: string,
  timeZone = 'America/Sao_Paulo',
): string | null {
  const normalized = optionalText(value);
  if (normalized === null) {
    return null;
  }
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = explicitZone ? new Date(normalized) : localTimestampToUtc(normalized, timeZone);
  if (!date || Number.isNaN(date.getTime())) {
    throw new LegacyValueError(
      'INVALID_TIMESTAMP',
      field,
      `Data inválida em ${field}: ${normalized}.`,
    );
  }
  return date.toISOString();
}

export function dateValue(value: SourceScalar | undefined, field: string): string | null {
  const normalized = optionalText(value);
  if (normalized === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  if (!match) {
    throw new LegacyValueError('INVALID_DATE', field, `Data inválida em ${field}: ${normalized}.`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function enumValue<T extends string>(
  value: SourceScalar | undefined,
  field: string,
  mapping: Readonly<Record<string, T>>,
  fallback?: T,
): T {
  const normalized = upper(value);
  if (normalized === null && fallback !== undefined) {
    return fallback;
  }
  const mapped = normalized ? mapping[normalized] : undefined;
  if (!mapped) {
    throw new LegacyValueError(
      'UNMAPPED_ENUM',
      field,
      `Valor não mapeado em ${field}: ${normalized ?? '(vazio)'}.`,
    );
  }
  return mapped;
}

export function payloadHash(payload: SourceRowPayload): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`)
    .join('|');
  return hashSha256(canonical);
}
