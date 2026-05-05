-- Phase 2G: Add viewCount column for sampled listing view tracking.
-- Approximate analytics — frontend increments 1-in-5 to reduce DB writes.
ALTER TABLE agents_listing ADD COLUMN "viewCount" BIGINT NOT NULL DEFAULT 0;
