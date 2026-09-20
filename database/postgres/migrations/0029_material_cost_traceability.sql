BEGIN;

-- Mantém o cadastro técnico da peça e um nome de consulta simples para o chão de fábrica.
ALTER TABLE cmms.materials
  ADD COLUMN IF NOT EXISTS friendly_name text,
  ADD COLUMN IF NOT EXISTS unit_cost numeric(18,4) NOT NULL DEFAULT 0;

ALTER TABLE cmms.materials
  DROP CONSTRAINT IF EXISTS materials_unit_cost_non_negative;

ALTER TABLE cmms.materials
  ADD CONSTRAINT materials_unit_cost_non_negative CHECK (unit_cost >= 0);

-- A saída é imutável em relação ao cadastro: a OS conserva SKU, descrição e valor vigentes
-- no instante em que o material foi consumido.
ALTER TABLE maintenance.material_usage
  ADD COLUMN IF NOT EXISTS sku_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS material_name_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS friendly_name_snapshot text,
  ADD COLUMN IF NOT EXISTS unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost numeric(18,4) NOT NULL DEFAULT 0;

ALTER TABLE maintenance.material_usage
  DROP CONSTRAINT IF EXISTS material_usage_cost_non_negative;

ALTER TABLE maintenance.material_usage
  ADD CONSTRAINT material_usage_cost_non_negative CHECK (unit_cost >= 0 AND total_cost >= 0);

CREATE INDEX IF NOT EXISTS material_usage_action_created_at_idx
  ON maintenance.material_usage (work_order_action_id, created_at DESC);

COMMIT;
