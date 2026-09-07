import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import ExcelJS from 'exceljs';

import {
  sourceContractByName,
  sourceSheetContracts,
  type SourceSheetContract,
} from './source-contract.js';

export type SourceScalar = string | number | boolean | null;
export type SourceRowPayload = Readonly<Record<string, SourceScalar>>;

export interface SourceRowSnapshot {
  readonly rowNumber: number;
  readonly legacyId: string | null;
  readonly hashSha256: string;
  readonly payload: SourceRowPayload;
}

export interface SourceSheetSnapshot {
  readonly name: string;
  readonly contract: SourceSheetContract;
  readonly headers: readonly string[];
  readonly headerHashSha256: string;
  readonly contentHashSha256: string;
  readonly rows: readonly SourceRowSnapshot[];
  readonly extraHeaders: readonly string[];
}

export interface SourceWorkbookSnapshot {
  readonly sourcePath: string;
  readonly sourceKind: 'XLSX' | 'CSV_DIRECTORY';
  readonly sourceFileName: string;
  readonly capturedAt: string;
  readonly contentHashSha256: string;
  readonly sheets: readonly SourceSheetSnapshot[];
  readonly unknownSheets: readonly string[];
}

export class SourceContractError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Snapshot incompatível com o contrato 1.4.0: ${issues.join('; ')}`);
    this.name = 'SourceContractError';
    this.issues = issues;
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function normalizeHeader(value: unknown): string {
  const serialized =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);
  return serialized
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

function normalizeCell(value: ExcelJS.CellValue): SourceScalar {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if ('result' in value) {
    return normalizeCell(value.result ?? null);
  }
  if ('richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value) {
    return value.text;
  }
  if ('error' in value) {
    return value.error;
  }
  return JSON.stringify(value);
}

function legacyId(payload: SourceRowPayload, contract: SourceSheetContract): string | null {
  if (!contract.legacyIdColumn) {
    return null;
  }
  const value = payload[contract.legacyIdColumn];
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function snapshotWorksheet(
  worksheet: ExcelJS.Worksheet,
  contract: SourceSheetContract,
): SourceSheetSnapshot {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    const header = normalizeHeader(headerRow.getCell(column).value);
    if (header.length > 0) {
      headers.push(header);
    }
  }

  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0) {
    throw new SourceContractError([
      `${contract.name}: cabeçalhos duplicados (${[...new Set(duplicates)].join(', ')})`,
    ]);
  }

  const missing = contract.headers.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new SourceContractError([
      `${contract.name}: cabeçalhos ausentes (${missing.join(', ')})`,
    ]);
  }

  const rows: SourceRowSnapshot[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const payload: Record<string, SourceScalar> = {};
    let hasValue = false;
    for (const [index, header] of headers.entries()) {
      const value = normalizeCell(row.getCell(index + 1).value);
      payload[header] = value;
      hasValue ||= value !== null;
    }
    if (!hasValue) {
      return;
    }
    const rowHash = sha256(canonicalJson(payload));
    rows.push({
      rowNumber,
      legacyId: legacyId(payload, contract),
      hashSha256: rowHash,
      payload,
    });
  });

  return {
    name: contract.name,
    contract,
    headers,
    headerHashSha256: sha256(canonicalJson(headers)),
    contentHashSha256: sha256(canonicalJson(rows.map((row) => row.payload))),
    rows,
    extraHeaders: headers.filter((header) => !contract.headers.includes(header)),
  };
}

async function readXlsx(sourcePath: string): Promise<{
  readonly worksheets: ReadonlyMap<string, ExcelJS.Worksheet>;
  readonly fileHash: string;
}> {
  const buffer = await readFile(sourcePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(createReadStream(sourcePath));
  const worksheets = new Map<string, ExcelJS.Worksheet>();
  for (const worksheet of workbook.worksheets) {
    worksheets.set(worksheet.name.trim().toLowerCase(), worksheet);
  }
  return { worksheets, fileHash: sha256(buffer) };
}

async function readCsvDirectory(sourcePath: string): Promise<{
  readonly worksheets: ReadonlyMap<string, ExcelJS.Worksheet>;
  readonly fileHash: string;
}> {
  const entries = (await readdir(sourcePath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.csv')
    .sort((left, right) => left.name.localeCompare(right.name));
  const worksheets = new Map<string, ExcelJS.Worksheet>();
  const hashes: string[] = [];

  for (const entry of entries) {
    const filePath = join(sourcePath, entry.name);
    const buffer = await readFile(filePath);
    hashes.push(`${entry.name}:${sha256(buffer)}`);
    const workbook = new ExcelJS.Workbook();
    const worksheet = await workbook.csv.readFile(filePath, {
      parserOptions: { delimiter: ',', quote: '"', escape: '"', headers: false },
    });
    worksheet.name = basename(entry.name, extname(entry.name));
    worksheets.set(worksheet.name.trim().toLowerCase(), worksheet);
  }

  return { worksheets, fileHash: sha256(hashes.join('\n')) };
}

export async function captureSourceSnapshot(source: string): Promise<SourceWorkbookSnapshot> {
  const sourcePath = resolve(source);
  const sourceStat = await stat(sourcePath);
  const sourceKind = sourceStat.isDirectory() ? 'CSV_DIRECTORY' : 'XLSX';
  if (!sourceStat.isDirectory() && extname(sourcePath).toLowerCase() !== '.xlsx') {
    throw new SourceContractError(['a fonte deve ser um arquivo .xlsx ou uma pasta de CSVs']);
  }

  const { worksheets, fileHash } = sourceStat.isDirectory()
    ? await readCsvDirectory(sourcePath)
    : await readXlsx(sourcePath);
  const missingSheets = sourceSheetContracts
    .filter((contract) => !worksheets.has(contract.name))
    .map((contract) => contract.name);
  if (missingSheets.length > 0) {
    throw new SourceContractError([`abas ausentes (${missingSheets.join(', ')})`]);
  }

  const sheets = sourceSheetContracts.map((contract) => {
    const worksheet = worksheets.get(contract.name);
    if (!worksheet) {
      throw new SourceContractError([`${contract.name}: aba não localizada`]);
    }
    return snapshotWorksheet(worksheet, contract);
  });
  const unknownSheets = [...worksheets.keys()].filter((name) => !sourceContractByName.has(name));

  return {
    sourcePath,
    sourceKind,
    sourceFileName: basename(sourcePath),
    capturedAt: new Date(sourceStat.mtimeMs).toISOString(),
    contentHashSha256: fileHash,
    sheets,
    unknownSheets,
  };
}
