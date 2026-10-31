BEGIN;

GRANT UPDATE (effect)
ON iam.role_capabilities
TO vorqix_platform_support_writer;

COMMIT;
