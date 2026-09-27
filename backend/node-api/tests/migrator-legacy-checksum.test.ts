import assert from 'node:assert/strict';
import test from 'node:test';

import { isApprovedLegacyMigrationChecksum } from '../src/infrastructure/database/migrator.js';

test('aceita somente o checksum legado auditado da migration 0033', () => {
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0033_technical_validation_reports.sql',
      'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8',
    ),
    true,
  );
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0033_technical_validation_reports.sql',
      '0000000000000000000000000000000000000000000000000000000000000000',
    ),
    false,
  );
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0032_quality_or_safety_shared_requirement.sql',
      'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8',
    ),
    false,
  );
});
