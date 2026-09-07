-- One on-chain transaction may settle at most one payment.
--
-- Without this, the same transfer could be presented to several payment requests and each
-- would verify successfully against the chain — the amount and recipient would check out
-- every time. The uniqueness has to be enforced here, not in application code, because two
-- concurrent settle requests would both pass a read-then-write check.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_hash_key
  ON payments (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT DO NOTHING;

COMMIT;
