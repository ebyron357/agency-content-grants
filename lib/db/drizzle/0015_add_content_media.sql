-- Migration: add content_images and content_videos tables for inline media authoring
-- Images are stored on the local filesystem under data/media-uploads/
-- Videos store the validated embed URL (only approved providers are accepted)

CREATE TABLE IF NOT EXISTS content_images (
  id TEXT PRIMARY KEY,
  document_section_id TEXT NOT NULL REFERENCES document_sections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_images_section ON content_images(document_section_id);

CREATE TABLE IF NOT EXISTS content_videos (
  id TEXT PRIMARY KEY,
  document_section_id TEXT NOT NULL REFERENCES document_sections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  video_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  embed_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_videos_section ON content_videos(document_section_id);

-- Add content_format column to document_sections for backward compat
-- 'plain' = original plain text, 'html' = rich HTML from TipTap editor
ALTER TABLE document_sections ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'plain';
