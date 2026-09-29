-- Self-contained: creates + selects demo_db, so this file works both as a
-- docker-entrypoint-initdb.d script (runs in `postgres` db) and manually:
--   psql -U postgres -d demo_db -f seed.sql
SELECT 'CREATE DATABASE demo_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'demo_db')\gexec
\c demo_db
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE TABLE public.users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL, display_name TEXT, plan TEXT NOT NULL DEFAULT 'free', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO public.users(email, display_name, plan) VALUES ('vitalik@eth.io','vitalik','pro'),('satoshi@btc.io','satoshi','free'),('ada@cardano.io','ada.lovelace','pro');
CREATE TABLE public.orders(id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.users(id), amount_cents INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO public.orders(user_id, amount_cents, status) SELECT id, 4999, 'paid' FROM public.users LIMIT 1;
CREATE TABLE public.products(sku TEXT PRIMARY KEY, title TEXT NOT NULL, price_cents INT NOT NULL DEFAULT 0, in_stock BOOL NOT NULL DEFAULT true);
INSERT INTO public.products VALUES ('SKU-001','Neon Ledger',2999,true),('SKU-002','ZK Hoodie',7999,true);
CREATE VIEW public.order_summary AS SELECT u.email, count(o.id) AS orders FROM public.users u LEFT JOIN public.orders o ON o.user_id = u.id GROUP BY 1;
CREATE TABLE auth.sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE billing.invoices(id BIGSERIAL PRIMARY KEY, total_cents INT NOT NULL DEFAULT 0);
SELECT 'seed ok' AS status;
