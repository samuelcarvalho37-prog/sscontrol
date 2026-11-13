BEGIN;
GRANT SELECT (id, status) ON platform.platform_operators TO vorqix_platform_support_writer;
CREATE POLICY platform_operators_status_reader ON platform.platform_operators
  FOR SELECT TO vorqix_platform_support_writer USING (true);
GRANT UPDATE (status, updated_at) ON platform.tenants TO vorqix_platform_support_writer;
CREATE POLICY tenants_platform_writer_update_status ON platform.tenants
  FOR UPDATE TO vorqix_platform_support_writer USING (true) WITH CHECK (true);
CREATE FUNCTION platform.set_console_tenant_status(p_operator_id uuid,p_tenant_id uuid,p_status text,p_request_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform AS $$
DECLARE previous_status text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ACTIVE','SUSPENDED') THEN
    RAISE EXCEPTION 'Estado da empresa inválido.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.platform_operators WHERE id=p_operator_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Operador da plataforma inválido.' USING ERRCODE='42501';
  END IF;
  SELECT status INTO previous_status FROM platform.tenants WHERE id=p_tenant_id AND deleted_at IS NULL AND status<>'ARCHIVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE='22023'; END IF;
  IF previous_status=p_status THEN RETURN p_status; END IF;
  UPDATE platform.tenants SET status=p_status,updated_at=clock_timestamp() WHERE id=p_tenant_id;
  INSERT INTO platform.platform_audit_events(operator_id,action,entity_type,entity_id,tenant_id,request_id,before_state,after_state)
  VALUES(p_operator_id,'PLATFORM_TENANT_STATUS_CHANGED','TENANT',p_tenant_id::text,p_tenant_id,p_request_id,
    jsonb_build_object('status',previous_status),jsonb_build_object('status',p_status));
  RETURN p_status;
END;
$$;
ALTER FUNCTION platform.set_console_tenant_status(uuid,uuid,text,text) OWNER TO vorqix_platform_support_writer;
REVOKE ALL ON FUNCTION platform.set_console_tenant_status(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.set_console_tenant_status(uuid,uuid,text,text) TO fab_control_runtime;
COMMIT;
