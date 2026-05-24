


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."billing_intents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_code" "text" NOT NULL,
    "state" "text" DEFAULT 'authenticated'::"text" NOT NULL,
    "installation_id" bigint,
    "installation_owner_login" "text",
    "checkout_id" "text",
    "checkout_url" "text",
    "ls_variant_id" "text",
    "correlation_id" "text",
    "last_error_code" "text",
    "last_error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ls_store_id" "text",
    "ls_env_mode" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."billing_intents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_webhook_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "provider" "text" DEFAULT 'lemonsqueezy'::"text" NOT NULL,
    "event_key" "text" NOT NULL,
    "event_name" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."billing_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deployments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "commit_sha" "text" NOT NULL,
    "status" "text" NOT NULL,
    "url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."deployments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."licenses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "license_key" "text" NOT NULL,
    "ls_subscription_id" "text",
    "ls_variant_id" "text",
    "status" "text" DEFAULT 'active'::"text",
    "plan_tier" "text" DEFAULT 'tier1'::"text",
    "storage_usage_bytes" bigint DEFAULT 0,
    "storage_limit_bytes" bigint DEFAULT 1073741824
);


ALTER TABLE "public"."licenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "github_repo_owner" "text",
    "github_repo_name" "text",
    "github_installation_id" "text",
    "api_key" "text" DEFAULT "extensions"."uuid_generate_v4"(),
    "github_repo_id" bigint,
    "vercel_project_id" "text",
    "status" "text" DEFAULT 'active'::"text",
    "vercel_url" "text",
    "requested_name" "text",
    "final_project_name" "text",
    "naming_attempts" integer,
    "preview_image_url" "text",
    "preview_updated_at" timestamp with time zone,
    "preview_status" "text" DEFAULT 'pending'::"text",
    "vercel_edge_config_id" "text",
    "unsynced_changes_count" integer DEFAULT 0 NOT NULL,
    "last_hot_save_at" timestamp with time zone,
    "last_cold_sync_at" timestamp with time zone,
    "sync_status" "text" DEFAULT 'synced'::"text" NOT NULL
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenants"."github_repo_id" IS 'GitHub repository ID from create-from-template';



COMMENT ON COLUMN "public"."tenants"."vercel_project_id" IS 'Vercel project ID (Team Pro)';



COMMENT ON COLUMN "public"."tenants"."status" IS 'provisioning | active | failed | suspended';



COMMENT ON COLUMN "public"."tenants"."preview_status" IS 'pending | ready | failed';



COMMENT ON COLUMN "public"."tenants"."vercel_edge_config_id" IS 'Vercel Edge Config id for hot save data';



COMMENT ON COLUMN "public"."tenants"."unsynced_changes_count" IS 'Number of hot changes not consolidated to repo yet';



COMMENT ON COLUMN "public"."tenants"."last_hot_save_at" IS 'Last successful save2edge timestamp';



COMMENT ON COLUMN "public"."tenants"."last_cold_sync_at" IS 'Last successful save2repo timestamp';



COMMENT ON COLUMN "public"."tenants"."sync_status" IS 'dirty | synced';



ALTER TABLE ONLY "public"."billing_intents"
    ADD CONSTRAINT "billing_intents_checkout_id_unique" UNIQUE ("checkout_id");



ALTER TABLE ONLY "public"."billing_intents"
    ADD CONSTRAINT "billing_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_intents"
    ADD CONSTRAINT "billing_intents_tenant_plan_unique" UNIQUE ("tenant_id", "plan_code");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_event_key_key" UNIQUE ("event_key");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deployments"
    ADD CONSTRAINT "deployments_commit_sha_key" UNIQUE ("commit_sha");



ALTER TABLE ONLY "public"."deployments"
    ADD CONSTRAINT "deployments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_key_unique" UNIQUE ("license_key");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_tenant_unique" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_unique" UNIQUE ("slug");



CREATE INDEX "billing_intents_ls_env_mode_idx" ON "public"."billing_intents" USING "btree" ("ls_env_mode");



CREATE INDEX "billing_intents_ls_store_id_idx" ON "public"."billing_intents" USING "btree" ("ls_store_id");



CREATE INDEX "billing_intents_state_idx" ON "public"."billing_intents" USING "btree" ("state");



CREATE INDEX "billing_intents_tenant_id_idx" ON "public"."billing_intents" USING "btree" ("tenant_id");



CREATE INDEX "billing_intents_user_id_idx" ON "public"."billing_intents" USING "btree" ("user_id");



CREATE UNIQUE INDEX "tenants_api_key_idx" ON "public"."tenants" USING "btree" ("api_key");



ALTER TABLE ONLY "public"."billing_intents"
    ADD CONSTRAINT "billing_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_intents"
    ADD CONSTRAINT "billing_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deployments"
    ADD CONSTRAINT "deployments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Licenses are viewable by tenant owner" ON "public"."licenses" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."tenants"
  WHERE (("tenants"."id" = "licenses"."tenant_id") AND ("tenants"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Public read access" ON "public"."deployments" FOR SELECT USING (true);



CREATE POLICY "Service Role write access" ON "public"."deployments" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Tenants are insertable by owner" ON "public"."tenants" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Tenants are updatable by owner" ON "public"."tenants" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Tenants are viewable by owner" ON "public"."tenants" FOR SELECT USING (("auth"."uid"() = "owner_id"));



ALTER TABLE "public"."deployments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."licenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."deployments";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































GRANT ALL ON TABLE "public"."billing_intents" TO "anon";
GRANT ALL ON TABLE "public"."billing_intents" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_intents" TO "service_role";



GRANT ALL ON TABLE "public"."billing_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."deployments" TO "anon";
GRANT ALL ON TABLE "public"."deployments" TO "authenticated";
GRANT ALL ON TABLE "public"."deployments" TO "service_role";



GRANT ALL ON TABLE "public"."licenses" TO "anon";
GRANT ALL ON TABLE "public"."licenses" TO "authenticated";
GRANT ALL ON TABLE "public"."licenses" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































