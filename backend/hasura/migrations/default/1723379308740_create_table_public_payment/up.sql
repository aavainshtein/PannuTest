CREATE TABLE "public"."payment" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "stripe_payment_id" text NOT NULL UNIQUE, "amount" integer NOT NULL, "currency" text NOT NULL, "status" text NOT NULL, "payment_method" text NOT NULL, "error_message" text, PRIMARY KEY ("id") , FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE restrict ON DELETE restrict);COMMENT ON TABLE "public"."payment" IS E'user payment';
CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"()
RETURNS TRIGGER AS $$
DECLARE
  _new record;
BEGIN
  _new := NEW;
  _new."updated_at" = NOW();
  RETURN _new;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "set_public_payment_updated_at"
BEFORE UPDATE ON "public"."payment"
FOR EACH ROW
EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at"();
COMMENT ON TRIGGER "set_public_payment_updated_at" ON "public"."payment"
IS 'trigger to set value of column "updated_at" to current timestamp on row update';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE  INDEX "idx_payment_created_at" on
  "public"."payment" using btree ("created_at");
CREATE  INDEX "idx_payment_status" on
  "public"."payment" using btree ("status");
CREATE INDEX "idx_payment_stripe_payment_id" on
  "public"."payment" using btree ("stripe_payment_id");
CREATE  INDEX "idx_payment_user_id" on
  "public"."payment" using btree ("user_id");
