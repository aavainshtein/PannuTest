CREATE TABLE "public"."post" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid (),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "author_id" UUID NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "is_public" boolean NOT NULL DEFAULT TRUE,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("author_id") REFERENCES "auth"."users" ("id") ON UPDATE restrict ON DELETE restrict
);

COMMENT ON TABLE "public"."post" IS E'user\'s post';

CREATE
OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at" () RETURNS TRIGGER AS $$
DECLARE
  _new record;
BEGIN
  _new := NEW;
  _new."updated_at" = NOW();
  RETURN _new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "set_public_post_updated_at" BEFORE
UPDATE ON "public"."post" FOR EACH ROW
EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at" ();

COMMENT ON TRIGGER "set_public_post_updated_at" ON "public"."post" IS 'trigger to set value of column "updated_at" to current timestamp on row update';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX "idx_posts_author_id" ON "public"."post" USING btree ("author_id");

CREATE INDEX "idx_posts_is_public" ON "public"."post" USING btree ("is_public");

CREATE INDEX "idx_posts_created_at" ON "public"."post" USING btree ("created_at");
