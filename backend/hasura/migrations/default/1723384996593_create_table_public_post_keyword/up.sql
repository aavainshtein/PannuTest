CREATE TABLE
    "public"."post_keyword" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid (),
        "created_at" timestamptz NOT NULL DEFAULT now (),
        "post_id" UUID NOT NULL,
        "keyword_id" UUID NOT NULL,
        PRIMARY KEY ("id"),
        FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword" ("id") ON UPDATE restrict ON DELETE restrict,
        FOREIGN KEY ("post_id") REFERENCES "public"."post" ("id") ON UPDATE restrict ON DELETE restrict
    );

COMMENT ON TABLE "public"."post_keyword" IS 'join table set posts keywords';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX "idx_post_keyword_post_id" ON "public"."post_keyword" USING btree ("post_id");

CREATE INDEX "idx_post_keyword_keyword_id" ON "public"."post_keyword" USING btree ("keyword_id");

CREATE INDEX "idx_post_keyword_created_at" ON "public"."post_keyword" USING btree ("created_at");