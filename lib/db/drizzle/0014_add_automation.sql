-- ============================================================
-- Migration: Automation & Webhook Foundation — API keys, internal event
-- journal, webhook subscriptions/deliveries/attempts, idempotency keys.
-- Idempotent: safe on fresh, existing, and journal-less databases.
-- ============================================================

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "brand_id" text,
  "project_id" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "brand_id" text,
  "url" text NOT NULL,
  "description" text,
  "secret" text NOT NULL,
  "event_types" jsonb NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" text PRIMARY KEY,
  "subscription_id" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "last_attempt_at" timestamptz,
  "last_error" text,
  "last_response_status" integer,
  "claimed_at" timestamptz,
  "claim_token" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_delivery_attempts" (
  "id" text PRIMARY KEY,
  "delivery_id" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "outcome" text NOT NULL,
  "http_status" integer,
  "response_preview" text,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'in_progress',
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- Foreign keys, added defensively (fresh DBs already have all referenced tables).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='api_keys')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='users')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='api_keys_user_id_users_id_fk') THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_events')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='users')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_events_user_id_users_id_fk') THEN
    ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_subscriptions')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='users')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_subscriptions_user_id_users_id_fk') THEN
    ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_subscriptions')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='brands')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_subscriptions_brand_id_brands_id_fk') THEN
    ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_deliveries')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_subscriptions')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_deliveries_subscription_id_webhook_subscriptions_id_fk') THEN
    ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_deliveries')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_events')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_deliveries_event_id_webhook_events_id_fk') THEN
    ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_delivery_attempts')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='webhook_deliveries')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk') THEN
    ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='idempotency_keys')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='users')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='idempotency_keys_user_id_users_id_fk') THEN
    ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_unique" ON "api_keys"("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_user_id_idx" ON "webhook_events"("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_type_idx" ON "webhook_events"("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_user_id_idx" ON "webhook_subscriptions"("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_subscription_id_idx" ON "webhook_deliveries"("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_delivery_attempts_delivery_id_idx" ON "webhook_delivery_attempts"("delivery_id");--> statement-breakpoint

-- A retried request with the same (userId, endpoint, idempotencyKey) must hit
-- the exact same row so it can be detected and replayed instead of re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_user_endpoint_key_idx" ON "idempotency_keys"("user_id", "endpoint", "idempotency_key");
