BEGIN;

GRANT EXECUTE ON FUNCTION platform.current_tenant_id()
  TO vorqix_platform_reader;

CREATE POLICY storage_objects_platform_support_reader_scope
  ON platform.storage_objects
  FOR SELECT TO vorqix_platform_reader
  USING (
    EXISTS (
      SELECT 1
      FROM platform.support_request_attachments attachment
      WHERE attachment.tenant_id = storage_objects.tenant_id
        AND attachment.storage_object_id = storage_objects.id
    )
  );

COMMIT;
