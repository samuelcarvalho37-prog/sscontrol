BEGIN;

INSERT INTO workflow.notifications (
  tenant_id,
  notification_type,
  title,
  message,
  entity_type,
  entity_id,
  priority,
  action_route,
  action_payload,
  audience,
  deduplication_key
)
SELECT
  version.tenant_id,
  'CHECKLIST_VALIDATION_REQUESTED',
  'Validar checklist: ' || template.name,
  COALESCE(
    NULLIF(btrim(version.manager_guidance), ''),
    'Revise as etapas, os riscos, as evidências e os critérios de aceite desta versão.'
  ),
  'CHECKLIST_MODELO',
  template.id,
  CASE upper(template.criticality)
    WHEN 'CRITICAL' THEN 'CRITICAL'
    WHEN 'HIGH' THEN 'HIGH'
    WHEN 'LOW' THEN 'LOW'
    ELSE 'MEDIUM'
  END,
  '/maintenance/checklists/' || template.id::text || '/review',
  jsonb_build_object(
    'entityType', 'CHECKLIST_MODELO',
    'entityId', template.id,
    'checklistVersionId', version.id
  ),
  jsonb_build_object('signaturePolicy', version.signature_policy),
  'checklist-validation:' || version.id::text || ':' || version.content_hash_sha256
FROM maintenance.checklist_template_versions version
JOIN maintenance.checklist_templates template
  ON template.tenant_id = version.tenant_id
 AND template.id = version.checklist_template_id
 AND template.deleted_at IS NULL
WHERE version.status = 'IN_REVIEW'
  AND version.content_hash_sha256 IS NOT NULL
ON CONFLICT (tenant_id, deduplication_key)
WHERE deduplication_key IS NOT NULL AND status = 'ACTIVE'
DO UPDATE SET
  title = EXCLUDED.title,
  message = EXCLUDED.message,
  priority = EXCLUDED.priority,
  action_route = EXCLUDED.action_route,
  action_payload = EXCLUDED.action_payload,
  audience = EXCLUDED.audience;

INSERT INTO workflow.notification_recipients (
  tenant_id,
  notification_id,
  user_id,
  delivery_status,
  delivered_at,
  last_notified_at,
  delivery_attempts
)
SELECT DISTINCT
  notification.tenant_id,
  notification.id,
  user_account.id,
  'DELIVERED',
  clock_timestamp(),
  clock_timestamp(),
  1
FROM workflow.notifications notification
JOIN maintenance.checklist_template_versions version
  ON version.tenant_id = notification.tenant_id
 AND version.id = (notification.action_payload ->> 'checklistVersionId')::uuid
JOIN iam.users user_account
  ON user_account.tenant_id = notification.tenant_id
 AND user_account.status = 'ACTIVE'
 AND user_account.deleted_at IS NULL
JOIN iam.user_technical_assignments assignment
  ON assignment.tenant_id = user_account.tenant_id
 AND assignment.user_id = user_account.id
 AND assignment.status = 'ACTIVE'
 AND assignment.valid_from <= clock_timestamp()
 AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
JOIN iam.technical_areas area
  ON area.tenant_id = assignment.tenant_id
 AND area.id = assignment.technical_area_id
 AND area.status = 'ACTIVE'
LEFT JOIN iam.technical_roles technical_role
  ON technical_role.tenant_id = assignment.tenant_id
 AND technical_role.id = assignment.technical_role_id
 AND technical_role.status = 'ACTIVE'
WHERE notification.notification_type = 'CHECKLIST_VALIDATION_REQUESTED'
  AND notification.status = 'ACTIVE'
  AND version.status = 'IN_REVIEW'
  AND COALESCE(technical_role.can_sign, false)
  AND (
    EXISTS (
      SELECT 1
      FROM maintenance.checklist_version_validator_users selected
      WHERE selected.checklist_template_version_id = version.id
        AND selected.user_id = user_account.id
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM maintenance.checklist_version_validator_users selected
        WHERE selected.checklist_template_version_id = version.id
      )
      AND (
        (version.signature_policy = 'QUALIDADE' AND area.code = 'QUALITY')
        OR (version.signature_policy = 'SEGURANCA' AND area.code = 'SAFETY')
        OR (
          version.signature_policy IN ('QUALIDADE_OU_SEGURANCA', 'QUALIDADE_E_SEGURANCA')
          AND area.code IN ('QUALITY', 'SAFETY')
        )
      )
    )
  )
ON CONFLICT (tenant_id, notification_id, user_id) DO NOTHING;

COMMIT;
