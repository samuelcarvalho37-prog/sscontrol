/** Preserve legacy support records and include accepted collaborators from the team workflow. */
export function executionAuxiliariesSql(execution: 'execution' | 'e'): string {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', colleague.id, 'nome', colleague.name)
    ORDER BY colleague.name,colleague.id)
    FROM iam.users colleague
    WHERE colleague.tenant_id=${execution}.tenant_id AND colleague.id<>${execution}.operator_id
      AND (EXISTS (SELECT 1 FROM maintenance.execution_support_technicians support
        WHERE support.tenant_id=${execution}.tenant_id AND support.execution_id=${execution}.id
          AND support.user_id=colleague.id)
      OR EXISTS (SELECT 1 FROM maintenance.work_order_action_participants participant
        WHERE participant.tenant_id=${execution}.tenant_id AND participant.execution_id=${execution}.id
          AND participant.user_id=colleague.id AND participant.participant_role='COLLABORATOR'
          AND participant.invitation_status='ACCEPTED'))), '[]'::jsonb)`;
}
