BEGIN;
CREATE OR REPLACE FUNCTION platform.save_console_permission_policy(p_operator uuid,p_plan uuid,p_customizable boolean,p_codes text[],p_request text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform,iam AS $$
DECLARE before_policy jsonb;
BEGIN
 IF p_codes IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(p_codes) AS requested(code) WHERE NOT EXISTS(SELECT 1 FROM iam.capabilities c WHERE c.code=requested.code AND c.status='ACTIVE')) THEN
 RAISE EXCEPTION 'Permissão desconhecida.' USING ERRCODE='22023'; END IF;
 SELECT limits->'permissions' INTO before_policy FROM platform.commercial_plans WHERE id=p_plan FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado.' USING ERRCODE='P0002'; END IF;
 UPDATE platform.commercial_plans SET limits=jsonb_set(limits,'{permissions}',jsonb_build_object('personalizavel',p_customizable,'permissoes',to_jsonb(p_codes))),version=version+1 WHERE id=p_plan;
 INSERT INTO platform.platform_audit_events(operator_id,action,entity_type,entity_id,request_id,before_state,after_state)
 VALUES(p_operator,'PLATFORM_PLAN_PERMISSIONS_UPDATED','COMMERCIAL_PLAN',p_plan::text,p_request,COALESCE(before_policy,'{}'::jsonb),jsonb_build_object('personalizavel',p_customizable,'permissoes',to_jsonb(p_codes)));
END $$;
COMMIT;
