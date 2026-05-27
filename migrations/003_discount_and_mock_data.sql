-- Migration 003: discounted_price_cents + mock data for existing DBs
ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS discounted_price_cents INTEGER DEFAULT NULL;

UPDATE ep_plans SET discounted_price_cents = 15900 WHERE name = 'Essay Only' AND discounted_price_cents IS NULL;
UPDATE ep_plans SET discounted_price_cents = 39900 WHERE name = 'Full Cycle' AND discounted_price_cents IS NULL;
