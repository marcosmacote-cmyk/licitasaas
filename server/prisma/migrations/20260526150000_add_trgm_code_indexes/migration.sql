-- Create GIN indexes on the code fields for fast trigram matching
CREATE INDEX IF NOT EXISTS eng_item_code_trgm_idx ON "EngineeringItem" USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS eng_comp_code_trgm_idx ON "EngineeringComposition" USING gin (code gin_trgm_ops);
