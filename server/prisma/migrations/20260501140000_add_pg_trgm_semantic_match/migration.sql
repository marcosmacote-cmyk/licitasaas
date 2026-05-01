-- Enable the pg_trgm extension if it doesn't exist
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GiST/GIN indexes on the description fields for fast trigram matching
CREATE INDEX IF NOT EXISTS eng_item_desc_trgm_idx ON "EngineeringItem" USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS eng_comp_desc_trgm_idx ON "EngineeringComposition" USING gin (description gin_trgm_ops);
