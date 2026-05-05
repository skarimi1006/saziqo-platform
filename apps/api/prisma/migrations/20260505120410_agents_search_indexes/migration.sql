-- Phase 1E: Full-text search + trigram indexes on agents_listing.
--
-- Persian has no Postgres FTS dictionary, so we use the 'simple' regconfig
-- (raw lexemes, no stemming) and rely on weighted ranking + trigram indexes
-- for substring fallback. Weights: A=title+slug, B=shortDesc, C=longDesc.
-- The longDesc is truncated to 4000 chars to keep tsvector size bounded.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION agents_listing_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', COALESCE(NEW."titleFa", '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW."shortDescFa", '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(LEFT(NEW."longDescFaMd", 4000), '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW."slug", '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_listing_tsv_update
BEFORE INSERT OR UPDATE OF "titleFa", "shortDescFa", "longDescFaMd", "slug"
ON agents_listing
FOR EACH ROW EXECUTE FUNCTION agents_listing_search_vector_update();

CREATE INDEX agents_listing_search_vector_idx ON agents_listing
USING GIN ("searchVector");

CREATE INDEX agents_listing_title_trgm_idx ON agents_listing
USING GIN ("titleFa" gin_trgm_ops);

CREATE INDEX agents_listing_slug_trgm_idx ON agents_listing
USING GIN ("slug" gin_trgm_ops);

CREATE INDEX agents_listing_shortdesc_trgm_idx ON agents_listing
USING GIN ("shortDescFa" gin_trgm_ops);
