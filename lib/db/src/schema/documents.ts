import { pgTable, text, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { outlineSectionsTable } from "./outlines";

export const documentsTable = pgTable("documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  wordCount: integer("word_count"),
  isPublicationReady: boolean("is_publication_ready").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const documentSectionsTable = pgTable("document_sections", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  outlineSectionId: text("outline_section_id").references(() => outlineSectionsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  content: text("content"),
  wordCount: integer("word_count"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("pending"),
  isLocked: boolean("is_locked").notNull().default(false),
  isApproved: boolean("is_approved").notNull().default(false),
  naturalToneScore: real("natural_tone_score"),
  factAccuracyScore: real("fact_accuracy_score"),
  revisionCount: integer("revision_count").notNull().default(0),
  contentFormat: text("content_format").notNull().default("plain"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sectionRevisionsTable = pgTable("section_revisions", {
  id: text("id").primaryKey(),
  documentSectionId: text("document_section_id").notNull().references(() => documentSectionsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  revisionNumber: integer("revision_number").notNull().default(1),
  editType: text("edit_type").notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ createdAt: true, updatedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

export const insertDocumentSectionSchema = createInsertSchema(documentSectionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertDocumentSection = z.infer<typeof insertDocumentSectionSchema>;
export type DocumentSection = typeof documentSectionsTable.$inferSelect;

export const insertSectionRevisionSchema = createInsertSchema(sectionRevisionsTable).omit({ createdAt: true });
export type InsertSectionRevision = z.infer<typeof insertSectionRevisionSchema>;
export type SectionRevision = typeof sectionRevisionsTable.$inferSelect;

// ── Content media (inline images and video embeds stored per document section) ──

export const contentImagesTable = pgTable("content_images", {
  id: text("id").primaryKey(),
  documentSectionId: text("document_section_id").notNull().references(() => documentSectionsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  altText: text("alt_text").notNull().default(""),
  caption: text("caption").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContentImage = typeof contentImagesTable.$inferSelect;

export const contentVideosTable = pgTable("content_videos", {
  id: text("id").primaryKey(),
  documentSectionId: text("document_section_id").notNull().references(() => documentSectionsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  videoId: text("video_id").notNull(),
  originalUrl: text("original_url").notNull(),
  embedUrl: text("embed_url").notNull(),
  caption: text("caption").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContentVideo = typeof contentVideosTable.$inferSelect;
