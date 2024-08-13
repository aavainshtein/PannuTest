CREATE TABLE
    "public"."keyword" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid (),
        "created_at" timestamptz NOT NULL DEFAULT now (),
        "title" text NOT NULL,
        PRIMARY KEY ("id"),
        UNIQUE ("title")
    );

COMMENT ON TABLE "public"."keyword" IS 'keywords for posts';

CREATE EXTENSION IF NOT EXISTS pgcrypto;