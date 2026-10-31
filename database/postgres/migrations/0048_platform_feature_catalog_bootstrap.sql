BEGIN;

INSERT INTO platform.feature_catalog (code, name, description, module)
VALUES
  ('CADASTROS', 'Cadastros', 'Acesso aos cadastros e à estrutura da empresa.', 'CMMS'),
  ('ORDENS_SERVICO', 'Ordens de serviço', 'Criação, planejamento e acompanhamento de ordens de serviço.', 'MANUTENCAO'),
  ('CHECKLISTS', 'Checklists', 'Execução e configuração de checklists técnicos.', 'MANUTENCAO'),
  ('GESTAO_TECNICA', 'Gestão técnica', 'Análises, demandas e validações técnicas.', 'GESTAO_TECNICA'),
  ('INDICADORES', 'Indicadores', 'Painéis, indicadores e relatórios operacionais.', 'ANALYTICS'),
  ('DOCUMENTOS', 'Documentos', 'Biblioteca e controle de documentos da empresa.', 'DOCUMENTOS'),
  ('IMPORTACOES', 'Importações', 'Importação e conciliação de dados.', 'GOVERNANCA'),
  ('AUDITORIA', 'Auditoria', 'Consulta de trilhas e eventos de auditoria.', 'GOVERNANCA'),
  ('CONTINUIDADE', 'Continuidade', 'Recursos de cópia, recuperação e continuidade.', 'ADMINISTRACAO'),
  ('MOTOR_LIMITADO', 'Motor limitado', 'Uso do motor com limites comerciais definidos.', 'MOTOR')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      module = EXCLUDED.module,
      updated_at = clock_timestamp()
  WHERE platform.feature_catalog.status <> 'RETIRED';

CREATE OR REPLACE FUNCTION platform.list_console_features()
RETURNS TABLE (code text, name text, description text, module text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT feature.code, feature.name, feature.description, feature.module
  FROM platform.feature_catalog feature
  WHERE feature.status = 'ACTIVE'
  ORDER BY feature.module, feature.name
$$;

ALTER FUNCTION platform.list_console_features() OWNER TO vorqix_platform_reader;
REVOKE ALL ON FUNCTION platform.list_console_features() FROM PUBLIC;
GRANT SELECT ON platform.feature_catalog TO vorqix_platform_reader;
GRANT EXECUTE ON FUNCTION platform.list_console_features() TO fab_control_runtime;

COMMIT;
