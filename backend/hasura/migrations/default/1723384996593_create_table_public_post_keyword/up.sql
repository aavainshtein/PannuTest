CREATE TABLE
    "public"."post_keyword" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid (),
        "created_at" timestamptz NOT NULL DEFAULT now (),
        "post_id" uuid NOT NULL,
        "keyword_id" uuid NOT NULL,
        PRIMARY KEY ("id"),
        FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword" ("id") ON UPDATE restrict ON DELETE restrict,
        FOREIGN KEY ("post_id") REFERENCES "public"."post" ("id") ON UPDATE restrict ON DELETE restrict
    );

COMMENT ON TABLE "public"."post_keyword" IS 'join table set posts keywords';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX "idx_post_keyword_post_id" on "public"."post_keyword" using btree ("post_id");

CREATE INDEX "idx_post_keyword_keyword_id" on "public"."post_keyword" using btree ("keyword_id");

CREATE INDEX "idx_post_keyword_created_at" on "public"."post_keyword" using btree ("created_at");