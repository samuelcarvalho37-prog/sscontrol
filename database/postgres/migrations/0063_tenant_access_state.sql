BEGIN;
GRANT SELECT (tenant_id,status,starts_at,ends_at,grace_ends_at,created_at,id)
  ON platform.tenant_subscriptions TO vorqix_tenant_resolver;
CREATE POLICY subscription_pre_auth_resolver ON platform.tenant_subscriptions
  FOR SELECT TO vorqix_tenant_resolver USING (true);
CREATE FUNCTION platform.tenant_access_state(requested_slug text,requested_environment text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,platform AS $$
  SELECT CASE WHEN tenant.status<>'ACTIVE' THEN 'DISABLED'
    WHEN subscription.status IN ('SUSPENDED','CANCELLED') THEN 'SUBSCRIPTION_DISABLED'
    WHEN subscription.status='EXPIRED' OR COALESCE(subscription.grace_ends_at,subscription.ends_at)<=clock_timestamp() THEN 'EXPIRED'
    WHEN subscription.starts_at>clock_timestamp() THEN 'SUBSCRIPTION_DISABLED'
    ELSE 'ACTIVE' END
  FROM platform.tenants tenant
  LEFT JOIN LATERAL (SELECT status,starts_at,ends_at,grace_ends_at FROM platform.tenant_subscriptions
    WHERE tenant_id=tenant.id ORDER BY starts_at DESC,created_at DESC,id DESC LIMIT 1) subscription ON true
  WHERE tenant.slug=lower(btrim(requested_slug)) AND tenant.environment=requested_environment AND tenant.deleted_at IS NULL
  LIMIT 1
$$;
ALTER FUNCTION platform.tenant_access_state(text,text) OWNER TO vorqix_tenant_resolver;
REVOKE ALL ON FUNCTION platform.tenant_access_state(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.tenant_access_state(text,text) TO fab_control_runtime;
COMMIT;
