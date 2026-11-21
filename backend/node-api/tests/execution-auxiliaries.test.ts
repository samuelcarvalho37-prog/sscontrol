import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { executionAuxiliariesSql } from '../src/modules/operations/execution-auxiliaries.sql.js';

test('histórico inclui colaborador aceito e apoio legado uma vez, sem convites pendentes ou outra empresa',
  {skip: !process.env.EXECUTION_READ_TEST_URL}, async () => {
    const client = new Client({connectionString: process.env.EXECUTION_READ_TEST_URL});
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      for (const alias of ['e', 'execution'] as const) {
        const expression = executionAuxiliariesSql(alias)
          .replaceAll('iam.users', 'people')
          .replaceAll('maintenance.execution_support_technicians', 'supports')
          .replaceAll('maintenance.work_order_action_participants', 'participants');
        const result = await client.query(`WITH
          people(id,tenant_id,name) AS (VALUES
            ('main','a','Principal'),('accepted','a','Aceito'),('legacy','a','Legado'),
            ('pending','a','Pendente'),('refused','a','Recusado'),('removed','a','Removido'),
            ('other-execution','a','Outra execução'),('foreign','b','Outra empresa')),
          supports(tenant_id,execution_id,user_id) AS (VALUES
            ('a','os1','legacy'),('a','os1','accepted'),('a','os1','main'),('b','os1','foreign')),
          participants(tenant_id,execution_id,user_id,participant_role,invitation_status) AS (VALUES
            ('a','os1','main','PRIMARY','ACCEPTED'),('a','os1','accepted','COLLABORATOR','ACCEPTED'),
            ('a','os1','pending','COLLABORATOR','INVITED'),('a','os1','refused','COLLABORATOR','DECLINED'),
            ('a','os1','removed','COLLABORATOR','REMOVED'),('a','os2','other-execution','COLLABORATOR','ACCEPTED'),
            ('b','os1','foreign','COLLABORATOR','ACCEPTED')),
          executions(id,tenant_id,operator_id) AS (VALUES ('os1','a','main'),('empty','a','main'))
          SELECT ${alias}.id,${expression} AS support FROM executions ${alias} ORDER BY ${alias}.id`);
        assert.deepEqual(result.rows, [
          {id:'empty', support:[]},
          {id:'os1',support:[{id:'accepted',nome:'Aceito'},{id:'legacy',nome:'Legado'}]},
        ]);
      }
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
