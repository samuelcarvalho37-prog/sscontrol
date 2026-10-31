BEGIN;

-- A transferred primary remains in the participant history as REMOVED.
ALTER TABLE maintenance.work_order_action_participants
  DROP CONSTRAINT work_order_action_participants_role_status_check;
ALTER TABLE maintenance.work_order_action_participants
  ADD CONSTRAINT work_order_action_participants_role_status_check
  CHECK ((participant_role = 'PRIMARY' AND invitation_status IN ('PRIMARY', 'REMOVED'))
      OR (participant_role = 'COLLABORATOR' AND invitation_status <> 'PRIMARY'));

-- Technicians need the inbox capability to receive release and transfer notices.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, effect)
SELECT role.tenant_id, role.id, capability.id, 'ALLOW'
FROM iam.roles role
JOIN iam.capabilities capability
  ON capability.code = 'workflow.notifications.read' AND capability.status = 'ACTIVE'
WHERE role.code = 'TECNICO' AND role.status = 'ACTIVE' AND role.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM iam.role_capabilities existing
    WHERE existing.tenant_id = role.tenant_id AND existing.role_id = role.id
      AND existing.capability_id = capability.id AND existing.effect = 'DENY'
  )
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Seed the shared queue inbox for already released, unclaimed actions.
INSERT INTO workflow.notifications
  (tenant_id, notification_type, title, message, entity_type, entity_id, priority,
   action_route, action_payload, audience, deduplication_key)
SELECT action.tenant_id, 'WORK_ORDER_AVAILABLE', 'Nova ordem disponível na fila',
       'A OS ' || COALESCE(work_order.operational_code, action.id::text) ||
         ' está liberada para ser assumida pela equipe técnica.',
       'WORK_ORDER_ACTION', action.id, action.priority, '/technician',
       jsonb_build_object('entityType', 'WORK_ORDER_ACTION', 'entityId', action.id::text,
                          'workOrderId', work_order.id::text),
       jsonb_build_object('roleCodes', jsonb_build_array('TECNICO')),
       'work-order-available:' || action.id::text || ':' ||
         to_char(action.generated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS')
FROM maintenance.work_order_actions action
JOIN maintenance.work_orders work_order
  ON work_order.tenant_id = action.tenant_id AND work_order.id = action.work_order_id
WHERE action.status = 'READY' AND action.responsible_id IS NULL
  AND action.origin = 'WORK_ORDER_RELEASE'
ON CONFLICT (tenant_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL AND status = 'ACTIVE'
DO NOTHING;

INSERT INTO workflow.notification_recipients
  (tenant_id, notification_id, user_id, delivery_status, delivered_at, last_notified_at, delivery_attempts)
SELECT DISTINCT notification.tenant_id, notification.id, user_account.id,
       'DELIVERED', clock_timestamp(), clock_timestamp(), 1
FROM workflow.notifications notification
JOIN maintenance.work_order_actions action
  ON action.tenant_id = notification.tenant_id AND action.id = notification.entity_id
JOIN iam.users user_account
  ON user_account.tenant_id = notification.tenant_id
 AND user_account.status = 'ACTIVE' AND user_account.deleted_at IS NULL
JOIN iam.user_roles user_role
  ON user_role.tenant_id = user_account.tenant_id AND user_role.user_id = user_account.id
 AND user_role.valid_from <= clock_timestamp()
 AND (user_role.valid_until IS NULL OR user_role.valid_until > clock_timestamp())
JOIN iam.roles role
  ON role.tenant_id = user_role.tenant_id AND role.id = user_role.role_id
 AND role.code = 'TECNICO' AND role.status = 'ACTIVE' AND role.deleted_at IS NULL
JOIN iam.user_technical_assignments assignment
  ON assignment.tenant_id = user_account.tenant_id AND assignment.user_id = user_account.id
 AND assignment.status = 'ACTIVE' AND assignment.valid_from <= clock_timestamp()
 AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
JOIN iam.technical_areas area
  ON area.tenant_id = assignment.tenant_id AND area.id = assignment.technical_area_id
 AND area.status = 'ACTIVE' AND area.deleted_at IS NULL
WHERE notification.notification_type = 'WORK_ORDER_AVAILABLE'
  AND notification.entity_type = 'WORK_ORDER_ACTION'
  AND notification.status = 'ACTIVE'
  AND action.status = 'READY' AND action.responsible_id IS NULL
ON CONFLICT (tenant_id, notification_id, user_id) DO NOTHING;

COMMIT;
