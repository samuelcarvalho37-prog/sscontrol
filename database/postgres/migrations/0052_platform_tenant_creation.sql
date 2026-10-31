BEGIN;

CREATE POLICY tenants_platform_writer_insert_scope ON platform.tenants
  FOR INSERT TO vorqix_platform_support_writer
  WITH CHECK (true);
CREATE POLICY company_profiles_platform_writer_scope ON platform.company_profiles
  FOR INSERT TO vorqix_platform_support_writer
  WITH CHECK (true);

GRANT INSERT ON platform.tenants TO vorqix_platform_support_writer;
GRANT INSERT ON platform.company_profiles TO vorqix_platform_support_writer;

CREATE FUNCTION platform.create_console_tenant(
  p_operator_id uuid,
  p_display_name text,
  p_legal_name text,
  p_tax_identifier text,
  p_slug text,
  p_environment text,
  p_plan_id uuid,
  p_monthly_price numeric,
  p_discount_percent numeric,
  p_implementation_days integer,
  p_feature_codes text[],
  p_request_id text
)
RETURNS TABLE (tenant_id uuid, subscription_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  created_tenant_id uuid;
  created_subscription_id uuid;
  feature_overrides jsonb;
  commercial_terms jsonb;
  requested_count integer;
  matched_count integer;
BEGIN
  IF p_display_name IS NULL OR length(trim(p_display_name)) NOT BETWEEN 2 AND 120
     OR p_legal_name IS NULL OR length(trim(p_legal_name)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Informe o nome exibido e a razão social da empresa.' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'O identificador deve usar letras minúsculas, números e hífens.' USING ERRCODE = '22023';
  END IF;
  IF p_environment NOT IN ('DEVELOPMENT', 'HOMOLOGATION', 'PRODUCTION') THEN
    RAISE EXCEPTION 'Ambiente da empresa inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_monthly_price IS NULL OR p_monthly_price < 0 OR p_monthly_price > 100000000
     OR p_discount_percent IS NULL OR p_discount_percent < 0 OR p_discount_percent > 100
     OR p_implementation_days IS NULL OR p_implementation_days < 0 OR p_implementation_days > 3650 THEN
    RAISE EXCEPTION 'Condições comerciais inválidas.' USING ERRCODE = '22023';
  END IF;
  IF p_operator_id IS NULL THEN
    RAISE EXCEPTION 'A identificação da equipe da plataforma é obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.commercial_plans WHERE id = p_plan_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Selecione um plano ativo.' USING ERRCODE = '22023';
  END IF;

  requested_count := cardinality(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> cardinality(ARRAY(SELECT DISTINCT item FROM unnest(COALESCE(p_feature_codes, ARRAY[]::text[])) item)) THEN
    RAISE EXCEPTION 'A lista de módulos contém duplicatas.' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT feature.code)::integer INTO matched_count
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE'
    AND feature.code = ANY(COALESCE(p_feature_codes, ARRAY[]::text[]));
  IF requested_count <> matched_count THEN
    RAISE EXCEPTION 'Um ou mais módulos do plano não estão disponíveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_object_agg(feature.code, feature.code = ANY(
           COALESCE(p_feature_codes, ARRAY[]::text[]))), '{}'::jsonb)
    INTO feature_overrides
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE';
  commercial_terms := jsonb_build_object(
    'monthly_price', p_monthly_price,
    'discount_percent', p_discount_percent,
    'implementation_days', p_implementation_days
  );

  INSERT INTO platform.tenants (legal_name, display_name, slug, environment, status)
  VALUES (trim(p_legal_name), trim(p_display_name), p_slug, p_environment, 'ACTIVE')
  RETURNING id INTO created_tenant_id;

  INSERT INTO platform.company_profiles (tenant_id, trade_name, legal_name, tax_identifier)
  VALUES (created_tenant_id, trim(p_display_name), trim(p_legal_name), NULLIF(trim(COALESCE(p_tax_identifier, '')), ''));

  INSERT INTO platform.tenant_subscriptions
    (tenant_id, commercial_plan_id, status, starts_at, overrides)
  VALUES (
    created_tenant_id, p_plan_id, 'ACTIVE', clock_timestamp(),
    jsonb_build_object('commercial', commercial_terms, 'features', feature_overrides)
  )
  RETURNING id INTO created_subscription_id;

  INSERT INTO platform.platform_audit_events
    (operator_id, action, entity_type, entity_id, tenant_id, request_id, before_state, after_state)
  VALUES (
    p_operator_id, 'PLATFORM_TENANT_CREATED', 'TENANT', created_tenant_id::text,
    created_tenant_id, p_request_id, '{}'::jsonb,
    jsonb_build_object(
      'display_name', trim(p_display_name), 'legal_name', trim(p_legal_name),
      'slug', p_slug, 'environment', p_environment, 'status', 'ACTIVE',
      'subscription_id', created_subscription_id, 'plan_id', p_plan_id,
      'subscription_status', 'ACTIVE', 'monthly_price', p_monthly_price,
      'discount_percent', p_discount_percent, 'implementation_days', p_implementation_days,
      'feature_codes', COALESCE(p_feature_codes, ARRAY[]::text[])
    )
  );

  RETURN QUERY SELECT created_tenant_id, created_subscription_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma empresa com esse identificador. Ajuste o endereço técnico e tente novamente.' USING ERRCODE = '23505';
END;
$$;

ALTER FUNCTION platform.create_console_tenant(uuid, text, text, text, text, text, uuid, numeric, numeric, integer, text[], text)
  OWNER TO vorqix_platform_support_writer;
REVOKE ALL ON FUNCTION platform.create_console_tenant(uuid, text, text, text, text, text, uuid, numeric, numeric, integer, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.create_console_tenant(uuid, text, text, text, text, text, uuid, numeric, numeric, integer, text[], text) TO fab_control_runtime;

COMMIT;
