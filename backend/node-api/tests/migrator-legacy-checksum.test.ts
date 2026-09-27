import assert from 'node:assert/strict';
import test from 'node:test';

import { isApprovedLegacyMigrationChecksum } from '../src/infrastructure/database/migrator.js';

const canonical0033Checksum = 'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8';
const incomplete0033Checksum = '288f7a0d1b56d45836891017c942b2755399e4f7e3a92a9d2a6790de7bd61753';

test('aceita somente o checksum legado auditado da migration 0033', () => {
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0033_technical_validation_reports.sql',
      canonical0033Checksum,
      canonical0033Checksum,
    ),
    true,
  );
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0033_technical_validation_reports.sql',
      incomplete0033Checksum,
      canonical0033Checksum,
    ),
    true,
  );
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0033_technical_validation_reports.sql',
      '0000000000000000000000000000000000000000000000000000000000000000',
      canonical0033Checksum,
    ),
    false,
  );
  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0032_quality_or_safety_shared_requirement.sql',
      canonical0033Checksum,
      canonical0033Checksum,
    ),
    false,
  );
});

test('aceita somente os checksums CRLF históricos auditados quando o arquivo atual é canônico', () => {
  const auditedChecksums = [
    [
      '0019_pcm_action_assignment.sql',
      'acd2f0794f2c3bc7618543646ba81ff53d85fa74b00d00c3d73171ffcf2b5249',
      '4002c361acb2c3395c63b214fd1cbd5418cf80be6d900ebea4ac59bc13933968',
    ],
    [
      '0020_fix_pcm_action_assignment.sql',
      '21e5fb863fcf4cf4d1d0a2238bfc76f11dc458b5de84bf8bf91a08fd74d5f5af',
      '257476d56f6788fa70ca112b3d8e9d46f8c05f56708dc89721a2af8d2796bce5',
    ],
    [
      '0021_pcm_work_order_release.sql',
      'eec4581ce1bb394b45c0f15527938742acfc196e0db5763d2169b65d1356ea0d',
      '11da1494c5022c4c5da66af83e25ca8c86264fb6a49dfb9883aec76f10810050',
    ],
    [
      '0022_reconcile_completed_normal_work_orders.sql',
      '832ca6f4d0aa2fef39469064fe29f39e184c4ccdba2d0925b7cfba1135141736',
      'b653a5bc696d77eb65ebf0683139fa7e7de0a0f36061795b321073f18f8ddd84',
    ],
    [
      '0023_pcm_work_order_create.sql',
      '5bd552bdbc949dc111ac7ff3ecae0b9365ce0a4965d0e0e84fa83e8e2d63d428',
      'a56beaf0bf98be3267a7e2d1a196bf6e04b8ccfaa99808e6ace0d7d4733c9a88',
    ],
    [
      '0024_fix_capability_text_and_release_demo.sql',
      'e07e75c4e179a6c6013e83eb8b3416ec95209de3e48faa96defb2afb7b488abf',
      'dfea9c23123100a58ed69622e6013609b5e9782b1d6068bd20d42ce6d7952291',
    ],
    [
      '0025_execution_pause_tracking.sql',
      '674b5ef0cd1c902a6cf61b8c9c36f80368049f44faadb70c5ee5bf0410f3d4fd',
      '65817cbf8a2cce68a0bccc578d1d310ab0679e7851196091ac3fe15631307b9e',
    ],
    [
      '0026_tenant_hostname_resolution.sql',
      '78fd2dea7899ff4cefd06554d3b91e8a667570dbd30f574ba41a3bebe2d13ba5',
      '3418a46bbf6d727c2feee7de0647a5a6362f8c9dddb62bd522ca2730a769becd',
    ],
    [
      '0027_pre_auth_tenant_resolver_role.sql',
      'a8dfb9ab97aebe01bd091afb7ea007cd90d3acb6caa626882d14feb716d1c4f6',
      'd23542290e8901cdfaa385c4f56e0aa944c10c508e2f95dee5538d0e32a670ea',
    ],
    [
      '0028_pre_auth_tenant_resolver_runtime_execute.sql',
      '6f0559b4b026a98ee8448e2b43d04160e085bbaafd1d51797c15b4941092eb5a',
      'a33d4a963461194736f03de4b0d501e8b1ecb0080264f53b810816fb2d6c079b',
    ],
    [
      '0029_material_cost_traceability.sql',
      '32d4b945274ff78da55aa7e7b0611dc2b6575cf9385f0f81479c392377389562',
      '273fb23b6b587b2dadae328bf4063a9425c72a5e7e3d8f5dcdf246bdc97b5aa7',
    ],
    [
      '0030_material_value_sources.sql',
      '99c27354ede7a7a6e5f9ce9bd88d8a30868e122a86c02a3da0a46cbfc48a629a',
      '261a8d2085e3bd0c3a842f4e534dbef2dc4541262df59fdc4c27220b008f7907',
    ],
    [
      '0031_post_intervention_release_does_not_block_execution.sql',
      '3ee4f85e3524692bd762dc3d9ed2b9ede3ece1a5d8e6976cc0d6076122f38fd7',
      '2768761b4a60c0916187766698f62499e14e7792544226db683f82397ecefe73',
    ],
    [
      '0032_quality_or_safety_shared_requirement.sql',
      'df5ea64b7f611e9dc532879fbf3bd2a21339c137fa2991b06c7d0ccfdcc5c7a3',
      'ed45ed94c9a942447e0bce73607822ec9fbc3a8376a2955ce2d796df065219da',
    ],
  ] as const;

  for (const [version, historicalChecksum, canonicalChecksum] of auditedChecksums) {
    assert.equal(
      isApprovedLegacyMigrationChecksum(version, historicalChecksum, canonicalChecksum),
      true,
      version,
    );
    assert.equal(
      isApprovedLegacyMigrationChecksum(version, historicalChecksum, `${canonicalChecksum}0`),
      false,
      `${version} must reject altered SQL`,
    );
    assert.equal(
      isApprovedLegacyMigrationChecksum(version, canonicalChecksum, canonicalChecksum),
      false,
      `${version} must reject an unlisted ledger checksum`,
    );
  }

  assert.equal(
    isApprovedLegacyMigrationChecksum(
      '0035_material_value_sources_rls.sql',
      auditedChecksums[0][1],
      auditedChecksums[0][2],
    ),
    false,
    'migrations futuras não podem usar checksums históricos de outra migration',
  );
});
