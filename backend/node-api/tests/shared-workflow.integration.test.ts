import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadEnvironment } from '../src/config/environment.js';

// A disposable clone is required. Never run these mutations on development,
// homologation or production databases. Secrets remain environment-only.
test(
  'solicitação compartilhada, isolamento, PCM e acompanhamento real',
  { skip: !process.env.SHARED_TEST_ADMIN_URL },
  async (t) => {
    const adminUrl = new URL(process.env.SHARED_TEST_ADMIN_URL!);
    assert.match(adminUrl.pathname, /^\/vorqix_shared_test_\d{8}_\d{6}$/);
    assert.equal(new URL(process.env.DATABASE_URL!).pathname, adminUrl.pathname);
    const pool = new Pool({ connectionString: adminUrl.href });
    const app = await buildApp({ environment: loadEnvironment(), logger: false });
    await app.ready();
    const host = 'fab-control-homologacao-000000000000.localhost';
    const users = [
      ['USR-OPE-DEMO', 'DEMO_OPERATOR_PASSWORD'],
      ['USR-PRO-DEMO', 'DEMO_PRODUCAO_PASSWORD'],
      ['USR-MAN-DEMO', 'DEMO_MAINTENANCE_PASSWORD'],
      ['USR-MEC-SAMUEL', 'DEMO_MAINTENANCE_PASSWORD'],
      ['USR-ELE-NATHAN', 'DEMO_MAINTENANCE_PASSWORD'],
      ['USR-QUAL-DEMO', 'DEMO_QUALITY_PASSWORD'],
      ['USR-SEG-DEMO', 'DEMO_SAFETY_PASSWORD'],
      ['USR-PCM-DEMO', 'DEMO_PCM_PASSWORD'],
      ['USR-ADMIN-DEMO', 'DEMO_ADMIN_PASSWORD'],
    ];
    const tokens = new Map<string, string>();
    const call = (user: string, method: string, url: string, payload?: unknown) =>
      app.inject({
        method: method as 'GET' | 'POST' | 'PUT',
        url,
        headers: { host, authorization: `Bearer ${tokens.get(user)}` },
        ...(payload ? { payload: payload as object } : {}),
      });
    let requestId = '',
      orderId = '',
      assetId = '',
      key = randomUUID();
    const requestBody = () => ({
      ativo_id: assetId,
      titulo: 'QA — solicitação compartilhada',
      descricao: 'Pedido fictício no banco isolado para verificar o fluxo completo.',
      tipo: 'CORRECTIVE',
      qualidade: true,
      seguranca: true,
      chave_envio: key,
    });
    try {
      const identity = await pool.query(
        `SELECT u.id,u.tenant_id,s.plant_id FROM iam.users u JOIN iam.user_scope_assignments s ON s.user_id=u.id AND s.tenant_id=u.tenant_id WHERE u.employee_number='USR-PCM-DEMO' AND s.scope_type='PLANT' AND s.status='ACTIVE' LIMIT 1`,
      );
      assert.ok(identity.rows[0]);
      const pcm = identity.rows[0];
      await pool.query(
        `INSERT INTO iam.user_scope_assignments(tenant_id,user_id,plant_id,scope_type,assigned_by)
      SELECT $1,u.id,$2,'PLANT',$3 FROM iam.users u WHERE u.tenant_id=$1 AND u.employee_number=ANY($4::text[]) AND NOT EXISTS
      (SELECT 1 FROM iam.user_scope_assignments s WHERE s.tenant_id=$1 AND s.user_id=u.id AND s.plant_id=$2 AND s.status='ACTIVE')`,
        [pcm.tenant_id, pcm.plant_id, pcm.id, users.slice(0, -1).map((item) => item[0])],
      );
      for (const [name, passwordKey] of users) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          headers: { host },
          payload: { matricula: name, senha: process.env[passwordKey!] },
        });
        assert.equal(response.statusCode, 200, `Login ${name}`);
        tokens.set(name!, response.json().data.token);
      }
      await t.test(
        'todos os perfis operacionais consultam e solicitam; TI não ganha função operacional',
        async () => {
          for (const [name] of users.slice(0, -1)) {
            const assets = await call(name!, 'GET', '/v1/shared/assets');
            assert.equal(assets.statusCode, 200, `Equipamentos ${name}`);
            const asset = assets
              .json()
              .data.itens.find((item: { tag: string }) => item.tag === 'EQ-ENV-01');
            assert.ok(asset, `Escopo ${name}`);
            assetId = asset.id;
            key = randomUUID();
            const created = await call(name!, 'POST', '/v1/shared/requests', requestBody());
            assert.equal(created.statusCode, 200, `Pedido ${name}`);
            if (name === 'USR-MEC-SAMUEL') requestId = created.json().data.id;
            const visible = await call(name!, 'GET', '/v1/shared/orders');
            assert.equal(visible.statusCode, 200, `Acompanhamento ${name}`);
            if (name !== 'USR-PCM-DEMO') {
              const forbidden = await call(name!, 'POST', '/v1/maintenance/work-orders', {
                plano_versao_id: randomUUID(),
                tipo_origem: 'PCM',
                entidade_origem_id: null,
                tipo_trabalho: 'CORRECTIVE',
                modo_execucao: 'INTERNAL',
                titulo: 'Tentativa indevida',
                descricao: 'Verificação de permissão',
                prioridade: 'LOW',
                responsavel_id: null,
                programada_para: null,
                analise_tecnica: {},
              });
              assert.equal(forbidden.statusCode, 403, `Criação direta proibida ${name}`);
            }
          }
          const ti = await call('USR-ADMIN-DEMO', 'GET', '/v1/shared/orders');
          assert.equal(ti.statusCode, 403);
        },
      );
      await t.test(
        'envio repetido não duplica; reutilização com conteúdo diferente é recusada',
        async () => {
          key = randomUUID();
          const body = requestBody();
          const first = await call('USR-PRO-DEMO', 'POST', '/v1/shared/requests', body);
          assert.equal(first.statusCode, 200);
          const repeat = await call('USR-PRO-DEMO', 'POST', '/v1/shared/requests', body);
          assert.equal(repeat.statusCode, 200);
          assert.equal(repeat.json().data.id, first.json().data.id);
          const changed = await call('USR-PRO-DEMO', 'POST', '/v1/shared/requests', {
            ...body,
            titulo: 'Outro conteúdo',
          });
          assert.equal(changed.statusCode, 409);
        },
      );
      await t.test(
        'PCM devolve; apenas solicitante corrige; rejeição impede conversão',
        async () => {
          const returned = await call(
            'USR-PCM-DEMO',
            'POST',
            `/v1/maintenance/occurrences/${requestId}/decision`,
            { decisao: 'DEVOLVER', observacao: 'Informe melhor a necessidade deste serviço.' },
          );
          assert.equal(returned.statusCode, 200, JSON.stringify(returned.json().error));
          key = randomUUID();
          const wrong = await call(
            'USR-PRO-DEMO',
            'PUT',
            `/v1/shared/requests/${requestId}`,
            requestBody(),
          );
          assert.equal(wrong.statusCode, 404);
          const corrected = await call(
            'USR-MEC-SAMUEL',
            'PUT',
            `/v1/shared/requests/${requestId}`,
            requestBody(),
          );
          assert.equal(corrected.statusCode, 200);
          const read = await call('USR-MEC-SAMUEL', 'GET', '/v1/shared/requests');
          assert.ok(
            read
              .json()
              .data.itens.some(
                (row: { id: string; devolvida: boolean }) => row.id === requestId && !row.devolvida,
              ),
          );
        },
      );
      const plan = await pool.query(
        `SELECT v.id FROM maintenance.maintenance_plan_versions v JOIN maintenance.maintenance_plans p ON p.id=v.maintenance_plan_id WHERE p.asset_id=$1 AND v.status='PUBLISHED' ORDER BY v.created_at LIMIT 1`,
        [assetId],
      );
      assert.ok(plan.rows[0]);
      await t.test(
        'QR e seleção hierárquica respeitam unidade; relato completo persiste sem abrir parada',
        async () => {
          const assets = await call('USR-QUAL-DEMO', 'GET', '/v1/shared/assets?pagina=1');
          assert.equal(assets.statusCode, 200);
          const asset = assets.json().data.itens.find((row: { id: string }) => row.id === assetId);
          assert.ok(asset.planta_id && asset.setor_id && asset.linha_id);
          const qr = await pool.query('SELECT qr_payload FROM cmms.assets WHERE id=$1', [assetId]);
          const resolved = await call(
            'USR-QUAL-DEMO',
            'GET',
            '/v1/shared/resolve-code?' + new URLSearchParams({ codigo: qr.rows[0].qr_payload }),
          );
          assert.equal(resolved.statusCode, 200);
          assert.equal(resolved.json().data.ativo_id, assetId);
          const unknown = await call(
            'USR-QUAL-DEMO',
            'GET',
            '/v1/shared/resolve-code?codigo=NAO-EXISTE',
          );
          assert.equal(unknown.statusCode, 404);
          const assessment = {
            situacao_atual: 'Vazamento simulado, equipamento parado apenas no relato.',
            equipamento_parado: true,
            risco_parada: true,
            risco_seguranca: true,
            impacto_producao: true,
            impacto_qualidade: false,
            existe_redundancia: false,
          };
          key = randomUUID();
          const body = { ...requestBody(), triagem: assessment };
          const created = await call('USR-QUAL-DEMO', 'POST', '/v1/shared/requests', body);
          assert.equal(created.statusCode, 200);
          const id = created.json().data.id;
          const saved = await pool.query(
            'SELECT severity,equipment_stop_id FROM maintenance.operational_occurrences WHERE id=$1',
            [id],
          );
          assert.equal(saved.rows[0].severity, 'CRITICAL');
          assert.equal(saved.rows[0].equipment_stop_id, null);
          const detail = await call('USR-SEG-DEMO', 'GET', `/v1/shared/requests/${id}`);
          assert.equal(detail.statusCode, 200, JSON.stringify(detail.json().error));
          assert.deepEqual(detail.json().data.relato.triagem, assessment);
          const changed = await call('USR-QUAL-DEMO', 'POST', '/v1/shared/requests', {
            ...body,
            triagem: { ...assessment, risco_seguranca: false },
          });
          assert.equal(changed.statusCode, 409);
          const related = await call(
            'USR-SEG-DEMO',
            'GET',
            `/v1/shared/requests?ativo_id=${assetId}&situacao=OPEN`,
          );
          assert.equal(related.statusCode, 200);
          assert.ok(related.json().data.itens.some((row: { id: string }) => row.id === id));
          const closed = await call(
            'USR-SEG-DEMO',
            'GET',
            `/v1/shared/requests?ativo_id=${assetId}&situacao=CLOSED`,
          );
          assert.equal(closed.statusCode, 200);
          assert.ok(!closed.json().data.itens.some((row: { id: string }) => row.id === id));
        },
      );
      const orderBody = {
        plano_versao_id: plan.rows[0].id,
        tipo_origem: 'OCCURRENCE',
        entidade_origem_id: requestId,
        tipo_trabalho: 'CORRECTIVE',
        modo_execucao: 'INTERNAL',
        titulo: 'QA — OS compartilhada',
        descricao: 'Serviço simulado para teste integrado de validação e acompanhamento.',
        prioridade: 'LOW',
        responsavel_id: null,
        programada_para: null,
        analise_tecnica: { exige_liberacao_pos_intervencao: false },
      };
      await t.test('pedido recusado não pode gerar OS', async () => {
        key = randomUUID();
        const created = await call('USR-PRO-DEMO', 'POST', '/v1/shared/requests', requestBody());
        const id = created.json().data.id;
        const rejected = await call(
          'USR-PCM-DEMO',
          'POST',
          `/v1/maintenance/occurrences/${id}/decision`,
          { decisao: 'RECUSAR', observacao: 'Pedido fictício recusado para verificar proteção.' },
        );
        assert.equal(rejected.statusCode, 200);
        const forbidden = await call('USR-PCM-DEMO', 'POST', '/v1/maintenance/work-orders', {
          ...orderBody,
          entidade_origem_id: id,
        });
        assert.equal(forbidden.statusCode, 409);
      });
      await t.test(
        'PCM cria uma OS por pedido, confirma validações e libera sem esperar presença',
        async () => {
          const changed = await call('USR-PCM-DEMO', 'POST', '/v1/maintenance/work-orders', {
            ...orderBody,
            analise_tecnica: { validacao_qualidade: false, validacao_seguranca: false },
          });
          assert.equal(changed.statusCode, 422);
          const created = await call(
            'USR-PCM-DEMO',
            'POST',
            '/v1/maintenance/work-orders',
            orderBody,
          );
          assert.equal(created.statusCode, 200);
          orderId = created.json().data.id;
          const duplicate = await call(
            'USR-PCM-DEMO',
            'POST',
            '/v1/maintenance/work-orders',
            orderBody,
          );
          assert.ok([200, 409].includes(duplicate.statusCode));
          if (duplicate.statusCode === 200) assert.equal(duplicate.json().data.id, orderId);
          const submitted = await call(
            'USR-PCM-DEMO',
            'POST',
            `/v1/maintenance/work-orders/${orderId}/submit-review`,
            {
              politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
              assinaturas_exigidas: 1,
              primeira_resposta_ate: null,
              resolucao_ate: null,
            },
          );
          assert.equal(submitted.statusCode, 200);
          const policy = await pool.query(
            `SELECT d.signature_policy,d.required_signature_count FROM workflow.technical_demands d JOIN maintenance.work_orders w ON w.technical_demand_id=d.id WHERE w.id=$1`,
            [orderId],
          );
          assert.equal(policy.rows[0]?.signature_policy, 'QUALIDADE_E_SEGURANCA');
          assert.equal(policy.rows[0]?.required_signature_count, 2);
          const release = await call(
            'USR-PCM-DEMO',
            'POST',
            `/v1/maintenance/work-orders/${orderId}/release`,
          );
          assert.equal(release.statusCode, 200);
          const releasedAction = await pool.query(
            'SELECT id FROM maintenance.work_order_actions WHERE work_order_id=$1 ORDER BY generated_at DESC LIMIT 1',
            [orderId],
          );
          const actionId = releasedAction.rows[0]?.id;
          assert.ok(actionId);
          const assumed = await call(
            'USR-MEC-SAMUEL',
            'POST',
            `/v1/maintenance/operator-actions/${actionId}/assume`,
          );
          assert.equal(assumed.statusCode, 200);
          const started = await call(
            'USR-MEC-SAMUEL',
            'POST',
            `/v1/maintenance/operator-actions/${actionId}/start`,
            { modo_parada: 'NO_STOP' },
          );
          assert.equal(started.statusCode, 200, JSON.stringify(started.json().error));
          const observations = await pool.query(
            'SELECT count(*)::integer AS n FROM maintenance.work_order_observations WHERE work_order_id=$1',
            [orderId],
          );
          assert.equal(observations.rows[0]?.n, 0);
          const notifications = await pool.query(
            `SELECT n.notification_type,r.user_id FROM workflow.notifications n JOIN workflow.notification_recipients r ON r.notification_id=n.id WHERE n.entity_id=$1 AND n.notification_type LIKE 'SHARED_WORK_ORDER_%'`,
            [orderId],
          );
          assert.equal(notifications.rows.length, 4);
        },
      );
      await t.test(
        'Qualidade e Segurança acompanham sem substituir assinatura; área incorreta recusada',
        async () => {
          const wrong = await call(
            'USR-QUAL-DEMO',
            'POST',
            `/v1/shared/orders/${orderId}/observations`,
            { area: 'SAFETY', observacao: 'Registro não autorizado' },
          );
          assert.equal(wrong.statusCode, 403);
          for (const [name, area] of [
            ['USR-QUAL-DEMO', 'QUALITY'],
            ['USR-SEG-DEMO', 'SAFETY'],
          ]) {
            const recorded = await call(
              name!,
              'POST',
              `/v1/shared/orders/${orderId}/observations`,
              { area, observacao: 'Acompanhamento do teste iniciado no sistema.' },
            );
            assert.equal(recorded.statusCode, 200);
          }
          const signed = await pool.query(
            'SELECT d.completed_signature_count FROM workflow.technical_demands d JOIN maintenance.work_orders w ON w.technical_demand_id=d.id WHERE w.id=$1',
            [orderId],
          );
          assert.equal(signed.rows[0]?.completed_signature_count, 0);
          const details = await call('USR-OPE-DEMO', 'GET', `/v1/shared/orders/${orderId}`);
          assert.equal(details.statusCode, 200);
          assert.ok(!JSON.stringify(details.json()).includes('signature_hash'));
        },
      );
      await t.test('conclusão técnica aguarda as duas assinaturas finais', async () => {
        const action = await pool.query(
          'SELECT id FROM maintenance.work_order_actions WHERE work_order_id=$1 ORDER BY generated_at DESC LIMIT 1',
          [orderId],
        );
        const execution = await pool.query(
          'SELECT id FROM maintenance.executions WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 1',
          [orderId],
        );
        const detail = await call(
          'USR-MEC-SAMUEL',
          'GET',
          `/v1/maintenance/executions/${execution.rows[0].id}`,
        );
        for (const item of detail.json().data.itens) {
          const responses = await call(
            'USR-MEC-SAMUEL',
            'PUT',
            `/v1/maintenance/executions/${execution.rows[0].id}/items/${item.id}/response`,
            {
              resposta_texto: 'CONFORME',
              resposta_numero: null,
              resposta_booleano: true,
              resposta_opcao: null,
              observacao: 'Verificação simulada no banco de testes.',
              nao_aplicavel: false,
            },
          );
          assert.equal(responses.statusCode, 200, JSON.stringify(responses.json().error));
        }
        const complete = await call(
          'USR-MEC-SAMUEL',
          'POST',
          `/v1/maintenance/operator-actions/${action.rows[0].id}/complete`,
          {
            resultado: 'Execução simulada concluída sem intervenção física.',
            observacao: null,
            modo_parada: 'NO_STOP',
          },
        );
        assert.equal(complete.statusCode, 200, JSON.stringify(complete.json().error));
        const status = async () =>
          (
            await pool.query(
              'SELECT status,technical_demand_id FROM maintenance.work_orders WHERE id=$1',
              [orderId],
            )
          ).rows[0];
        let order = await status();
        assert.equal(order.status, 'IN_TECHNICAL_REVIEW');
        for (const name of ['USR-QUAL-DEMO', 'USR-SEG-DEMO']) {
          const sign = await call(
            name,
            'POST',
            `/v1/workflow/technical-demands/${order.technical_demand_id}/sign`,
            {
              declaracao: 'Confiro e valido a conclusão simulada deste teste isolado.',
              significado: 'Validação final de homologação',
            },
          );
          assert.equal(sign.statusCode, 200, JSON.stringify(sign.json().error));
          order = await status();
          assert.equal(
            order.status,
            name === 'USR-QUAL-DEMO' ? 'IN_TECHNICAL_REVIEW' : 'COMPLETED',
          );
        }
        for (const [name] of users.slice(0, -1)) {
          const closed = await call(
            name!,
            'GET',
            `/v1/shared/orders?ativo_id=${assetId}&situacao=CLOSED`,
          );
          assert.equal(closed.statusCode, 200);
          assert.ok(closed.json().data.itens.some((item: { id: string }) => item.id === orderId));
          const open = await call(
            name!,
            'GET',
            `/v1/shared/orders?ativo_id=${assetId}&situacao=OPEN`,
          );
          assert.equal(open.statusCode, 200);
          assert.ok(!open.json().data.itens.some((item: { id: string }) => item.id === orderId));
        }
      });
      await t.test(
        'sem vínculo de unidade não há leitura nem criação; isolamento tenant segue ativo',
        async () => {
          const user = await pool.query(
            "SELECT id FROM iam.users WHERE employee_number='USR-PRO-DEMO'",
          );
          await pool.query(
            "UPDATE iam.user_scope_assignments SET status='INACTIVE' WHERE user_id=$1",
            [user.rows[0].id],
          );
          const list = await call('USR-PRO-DEMO', 'GET', '/v1/shared/orders');
          assert.equal(list.statusCode, 200);
          assert.equal(list.json().data.itens.length, 0);
          const detail = await call('USR-PRO-DEMO', 'GET', `/v1/shared/orders/${orderId}`);
          assert.equal(detail.statusCode, 403);
          const deniedQr = await call(
            'USR-PRO-DEMO',
            'GET',
            '/v1/shared/resolve-code?' + new URLSearchParams({ codigo: assetId }),
          );
          assert.equal(deniedQr.statusCode, 403);
          const deniedRequest = await call(
            'USR-PRO-DEMO',
            'GET',
            `/v1/shared/requests/${requestId}`,
          );
          assert.equal(deniedRequest.statusCode, 404);
          const create = await call('USR-PRO-DEMO', 'POST', '/v1/shared/requests', {
            ...requestBody(),
            chave_envio: randomUUID(),
          });
          assert.equal(create.statusCode, 403);
          const client = await app.database.pool.connect();
          try {
            await client.query('BEGIN READ ONLY');
            await client.query("SELECT set_config('app.tenant_id',$1,true)", [randomUUID()]);
            const rows = await client.query('SELECT id FROM maintenance.work_order_observations');
            assert.equal(rows.rows.length, 0);
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
        },
      );
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
