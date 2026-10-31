BEGIN;

ALTER TABLE platform.support_requests
  ADD CONSTRAINT support_requests_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE platform.support_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  support_request_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT support_request_attachments_request_fk
    FOREIGN KEY (tenant_id, support_request_id)
    REFERENCES platform.support_requests (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT support_request_attachments_storage_fk
    FOREIGN KEY (tenant_id, storage_object_id)
    REFERENCES platform.storage_objects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT support_request_attachments_unique_object
    UNIQUE (support_request_id, storage_object_id)
);

CREATE INDEX support_request_attachments_request_idx
  ON platform.support_request_attachments (tenant_id, support_request_id, created_at);

ALTER TABLE platform.support_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_request_attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY support_request_attachments_tenant_scope
  ON platform.support_request_attachments
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY support_request_attachments_platform_reader_scope
  ON platform.support_request_attachments
  FOR SELECT TO vorqix_platform_reader USING (true);

GRANT SELECT, INSERT ON platform.support_request_attachments TO fab_control_runtime;
GRANT SELECT ON platform.support_request_attachments TO vorqix_platform_reader;
GRANT INSERT ON platform.storage_objects TO fab_control_runtime;
GRANT SELECT ON platform.storage_objects TO vorqix_platform_reader;

CREATE OR REPLACE FUNCTION platform.list_console_support_attachments()
RETURNS TABLE (
  support_request_id uuid,
  object_id uuid,
  original_name text,
  media_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT attachment.support_request_id, object.id, object.original_name, object.media_type
  FROM platform.support_request_attachments attachment
  JOIN platform.storage_objects object
    ON object.tenant_id = attachment.tenant_id
   AND object.id = attachment.storage_object_id
  WHERE object.status = 'AVAILABLE' AND object.deleted_at IS NULL
  ORDER BY attachment.created_at
$$;

CREATE OR REPLACE FUNCTION platform.lookup_support_attachment(p_object_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  provider text,
  bucket text,
  object_key text,
  original_name text,
  media_type text,
  byte_size bigint,
  checksum_sha256 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT object.tenant_id, object.provider, object.bucket, object.object_key,
         object.original_name, object.media_type, object.byte_size,
         object.checksum_sha256
  FROM platform.support_request_attachments attachment
  JOIN platform.storage_objects object
    ON object.tenant_id = attachment.tenant_id
   AND object.id = attachment.storage_object_id
  WHERE object.id = p_object_id
    AND object.status = 'AVAILABLE'
    AND object.deleted_at IS NULL
  LIMIT 1
$$;

ALTER FUNCTION platform.list_console_support_attachments() OWNER TO vorqix_platform_reader;
ALTER FUNCTION platform.lookup_support_attachment(uuid) OWNER TO vorqix_platform_reader;
REVOKE ALL ON FUNCTION platform.list_console_support_attachments() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.lookup_support_attachment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.list_console_support_attachments() TO fab_control_runtime;
GRANT EXECUTE ON FUNCTION platform.lookup_support_attachment(uuid) TO fab_control_runtime;

COMMIT;
