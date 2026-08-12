CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audience_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"demographics" text,
	"knowledge_level" text,
	"pain_points" text,
	"goals" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"claim" text NOT NULL,
	"source" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"description" text,
	"industry" text,
	"website" text,
	"voice_description" text,
	"tone_preferences" text,
	"reading_level" text,
	"preferred_vocabulary" text,
	"prohibited_vocabulary" text,
	"geographic_focus" text,
	"compliance_notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_blueprints" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"description" text,
	"structure_definition" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"brand_id" text NOT NULL,
	"blueprint_id" text,
	"title" text NOT NULL,
	"topic" text,
	"content_type" text DEFAULT 'blog' NOT NULL,
	"purpose" text,
	"intended_audience" text,
	"audience_knowledge_level" text,
	"desired_reader_outcome" text,
	"geographic_focus" text,
	"target_length" text,
	"tone" text,
	"reading_level" text,
	"point_of_view" text,
	"research_freshness" text,
	"citation_requirement" text,
	"required_sections" text,
	"subjects_to_avoid" text,
	"words_to_avoid" text,
	"additional_instructions" text,
	"status" text DEFAULT 'active' NOT NULL,
	"workflow_stage" text DEFAULT 'assignment' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"summary" text,
	"timeframe_start" text,
	"timeframe_end" text,
	"geographic_boundaries" text,
	"source_categories" text,
	"potential_conflicts" text,
	"missing_information" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_plans_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"research_plan_id" text NOT NULL,
	"question" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"publisher" text,
	"author" text,
	"publication_date" text,
	"retrieval_date" text,
	"source_type" text DEFAULT 'web' NOT NULL,
	"extracted_text" text,
	"relevant_excerpts" text,
	"authority_score" real,
	"freshness_score" real,
	"is_primary_source" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"file_object_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text,
	"claim_text" text NOT NULL,
	"claim_type" text DEFAULT 'factual' NOT NULL,
	"supporting_excerpt" text,
	"confidence" real,
	"time_sensitive" boolean DEFAULT false NOT NULL,
	"verification_status" text DEFAULT 'proposed' NOT NULL,
	"conflict_status" text DEFAULT 'none' NOT NULL,
	"reviewer_decision" text,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outline_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"outline_id" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"questions_answered" text,
	"target_word_count" integer,
	"reader_outcome" text,
	"examples" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outlines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlines_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"outline_section_id" text,
	"title" text NOT NULL,
	"content" text,
	"word_count" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"natural_tone_score" real,
	"fact_accuracy_score" real,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"word_count" integer,
	"is_publication_ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "section_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_section_id" text NOT NULL,
	"content" text NOT NULL,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"edit_type" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"accuracy_score" real,
	"citation_score" real,
	"source_quality_score" real,
	"coverage_score" real,
	"coherence_score" real,
	"continuity_score" real,
	"naturalness_score" real,
	"usefulness_score" real,
	"audience_fit_score" real,
	"brand_fit_score" real,
	"readability_score" real,
	"repetition_score" real,
	"overall_pass" boolean DEFAULT false NOT NULL,
	"is_publication_ready" boolean DEFAULT false NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"document_section_id" text,
	"category" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"description" text NOT NULL,
	"suggested_fix" text,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_url" text,
	"file_size_bytes" integer,
	"validation_passed" boolean,
	"validation_notes" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"planning_model" text,
	"research_model" text,
	"outline_model" text,
	"writing_model" text,
	"editing_model" text,
	"verification_model" text,
	"evaluation_model" text,
	"utility_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"is_configured" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"default_model" text,
	"available_models" text,
	"last_tested_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dependency_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_slug" text NOT NULL,
	"component_name" text NOT NULL,
	"purpose" text NOT NULL,
	"category" text NOT NULL,
	"installed_version" text,
	"pinned_version" text,
	"license" text,
	"repository_status" text,
	"install_status" text DEFAULT 'not_installed' NOT NULL,
	"replacement_option" text,
	"security_review_status" text DEFAULT 'pending' NOT NULL,
	"maintenance_notes" text,
	"known_risks" text,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"project_title" text,
	"brand_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_section_id" text,
	"pipeline_stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" real,
	"latency_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audience_profiles' AND column_name='brand_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audience_profiles_brand_id_brands_id_fk') THEN
    ALTER TABLE "audience_profiles" ADD CONSTRAINT "audience_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_facts' AND column_name='brand_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brand_facts_brand_id_brands_id_fk') THEN
    ALTER TABLE "brand_facts" ADD CONSTRAINT "brand_facts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='user_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brands_user_id_users_id_fk') THEN
    ALTER TABLE "brands" ADD CONSTRAINT "brands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='user_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='projects_user_id_users_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='brand_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='projects_brand_id_brands_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='blueprint_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='projects_blueprint_id_content_blueprints_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_blueprint_id_content_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."content_blueprints"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='research_plans' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='research_plans_project_id_projects_id_fk') THEN
    ALTER TABLE "research_plans" ADD CONSTRAINT "research_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='research_questions' AND column_name='research_plan_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='research_questions_research_plan_id_research_plans_id_fk') THEN
    ALTER TABLE "research_questions" ADD CONSTRAINT "research_questions_research_plan_id_research_plans_id_fk" FOREIGN KEY ("research_plan_id") REFERENCES "public"."research_plans"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sources' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sources_project_id_projects_id_fk') THEN
    ALTER TABLE "sources" ADD CONSTRAINT "sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claims' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claims_project_id_projects_id_fk') THEN
    ALTER TABLE "claims" ADD CONSTRAINT "claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='claims' AND column_name='source_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claims_source_id_sources_id_fk') THEN
    ALTER TABLE "claims" ADD CONSTRAINT "claims_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outline_sections' AND column_name='outline_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='outline_sections_outline_id_outlines_id_fk') THEN
    ALTER TABLE "outline_sections" ADD CONSTRAINT "outline_sections_outline_id_outlines_id_fk" FOREIGN KEY ("outline_id") REFERENCES "public"."outlines"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outlines' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='outlines_project_id_projects_id_fk') THEN
    ALTER TABLE "outlines" ADD CONSTRAINT "outlines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_sections' AND column_name='document_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_sections_document_id_documents_id_fk') THEN
    ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_sections' AND column_name='outline_section_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_sections_outline_section_id_outline_sections_id_fk') THEN
    ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_outline_section_id_outline_sections_id_fk" FOREIGN KEY ("outline_section_id") REFERENCES "public"."outline_sections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_project_id_projects_id_fk') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='section_revisions' AND column_name='document_section_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='section_revisions_document_section_id_document_sections_id_fk') THEN
    ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_document_section_id_document_sections_id_fk" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_evaluations' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quality_evaluations_project_id_projects_id_fk') THEN
    ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_evaluations' AND column_name='document_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quality_evaluations_document_id_documents_id_fk') THEN
    ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_issues' AND column_name='evaluation_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quality_issues_evaluation_id_quality_evaluations_id_fk') THEN
    ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_evaluation_id_quality_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."quality_evaluations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_issues' AND column_name='document_section_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quality_issues_document_section_id_document_sections_id_fk') THEN
    ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_document_section_id_document_sections_id_fk" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='exports' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exports_project_id_projects_id_fk') THEN
    ALTER TABLE "exports" ADD CONSTRAINT "exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='exports' AND column_name='document_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exports_document_id_documents_id_fk') THEN
    ALTER TABLE "exports" ADD CONSTRAINT "exports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='generation_runs' AND column_name='project_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='generation_runs_project_id_projects_id_fk') THEN
    ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='generation_runs' AND column_name='document_section_id')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='generation_runs_document_section_id_document_sections_id_fk') THEN
    ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_document_section_id_document_sections_id_fk" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;