package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

func initDB(ctx context.Context, url string) error {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return fmt.Errorf("connect db: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}
	db = pool
	return migrate(ctx)
}

func migrate(ctx context.Context) error {
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS admins (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name        TEXT NOT NULL,
			email       TEXT NOT NULL UNIQUE,
			password    TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS admin_tokens (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			admin_id    UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
			token_hash  TEXT NOT NULL UNIQUE,
			expires_at  TIMESTAMPTZ NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_admin_tokens_hash ON admin_tokens(token_hash);

		CREATE TABLE IF NOT EXISTS paid_orders (
			id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			hosting_id           UUID NOT NULL,
			hosting_name         TEXT,
			order_id             TEXT NOT NULL,
			order_ref            TEXT NOT NULL,
			payment_method       SMALLINT NOT NULL,
			total                NUMERIC(10,2) NOT NULL DEFAULT 0,
			discount             NUMERIC(10,2) NOT NULL DEFAULT 0,
			currency             VARCHAR(10) NOT NULL DEFAULT 'USD',
			card_last4           VARCHAR(4),
			card_brand           TEXT,
			customer_first_name  TEXT,
			customer_last_name   TEXT,
			customer_email       TEXT,
			customer_phone       TEXT,
			landing_page_url     TEXT,
			products             JSONB NOT NULL DEFAULT '[]',
			paid_at              TIMESTAMPTZ,
			created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			search_vector        TSVECTOR GENERATED ALWAYS AS (
				to_tsvector('english',
					coalesce(order_ref, '')           || ' ' ||
					coalesce(customer_first_name, '') || ' ' ||
					coalesce(customer_last_name, '')  || ' ' ||
					coalesce(customer_email, '')      || ' ' ||
					coalesce(customer_phone, '')      || ' ' ||
					coalesce(hosting_name, '')
				)
			) STORED
		);

		CREATE INDEX IF NOT EXISTS idx_paid_orders_hosting_id      ON paid_orders(hosting_id);
		CREATE INDEX IF NOT EXISTS idx_paid_orders_payment_method  ON paid_orders(payment_method);
		CREATE INDEX IF NOT EXISTS idx_paid_orders_paid_at         ON paid_orders(paid_at DESC);
		CREATE INDEX IF NOT EXISTS idx_paid_orders_order_id        ON paid_orders(order_id);
		CREATE INDEX IF NOT EXISTS idx_paid_orders_customer_email  ON paid_orders(customer_email);
		CREATE INDEX IF NOT EXISTS idx_paid_orders_search          ON paid_orders USING GIN(search_vector);

		-- Prevent duplicate ingestion of the same order
		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'uq_paid_orders_hosting_order'
			) THEN
				ALTER TABLE paid_orders ADD CONSTRAINT uq_paid_orders_hosting_order UNIQUE (hosting_id, order_id);
			END IF;
		END $$;

		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS customer_address     TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS customer_city        TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS customer_state       TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS customer_postal_code TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS shipping_rate        NUMERIC(10,2) NOT NULL DEFAULT 0;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS shipping_name        TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS traffic_source       TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS discount_code        TEXT;
		ALTER TABLE paid_orders ADD COLUMN IF NOT EXISTS tip                  NUMERIC(10,2) NOT NULL DEFAULT 0;
	`)
	return err
}
