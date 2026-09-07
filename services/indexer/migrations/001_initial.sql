-- KAURAX indexer schema.
--
-- Design notes:
--   * Chain quantities are NUMERIC(78,0), which holds any uint256 exactly. Using BIGINT
--     would silently truncate token values and wei amounts.
--   * Hashes and addresses are stored lowercase TEXT with a CHECK on shape, so a malformed
--     value fails at write time rather than producing a row nothing can ever join to.
--   * Every table that mirrors chain state cascades from `blocks`, so a reorg is handled by
--     deleting the block and letting the deletes propagate.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- blocks --
CREATE TABLE IF NOT EXISTS blocks (
  number            NUMERIC(78,0) PRIMARY KEY,
  hash              TEXT NOT NULL UNIQUE CHECK (hash ~ '^0x[0-9a-f]{64}$'),
  parent_hash       TEXT NOT NULL CHECK (parent_hash ~ '^0x[0-9a-f]{64}$'),
  state_root        TEXT NOT NULL CHECK (state_root ~ '^0x[0-9a-f]{64}$'),
  timestamp         BIGINT NOT NULL,
  gas_used          NUMERIC(78,0) NOT NULL,
  gas_limit         NUMERIC(78,0) NOT NULL,
  base_fee_per_gas  NUMERIC(78,0),
  transaction_count INTEGER NOT NULL DEFAULT 0,
  indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blocks_timestamp_idx ON blocks (timestamp DESC);

-- ---------------------------------------------------------- transactions --
CREATE TABLE IF NOT EXISTS transactions (
  hash                    TEXT PRIMARY KEY CHECK (hash ~ '^0x[0-9a-f]{64}$'),
  block_number            NUMERIC(78,0) NOT NULL REFERENCES blocks(number) ON DELETE CASCADE,
  transaction_index       INTEGER NOT NULL,
  from_address            TEXT NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address              TEXT CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  value                   NUMERIC(78,0) NOT NULL,
  nonce                   BIGINT NOT NULL,
  gas                     NUMERIC(78,0) NOT NULL,
  gas_used                NUMERIC(78,0),
  gas_price               NUMERIC(78,0),
  effective_gas_price     NUMERIC(78,0),
  max_fee_per_gas         NUMERIC(78,0),
  max_priority_fee_per_gas NUMERIC(78,0),
  input                   TEXT NOT NULL,
  -- 1 = success, 0 = reverted. NULL only if the receipt could not be read.
  status                  SMALLINT,
  contract_address        TEXT CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  log_count               INTEGER NOT NULL DEFAULT 0,
  timestamp               BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tx_block_idx      ON transactions (block_number DESC, transaction_index);
CREATE INDEX IF NOT EXISTS tx_from_idx       ON transactions (from_address, block_number DESC);
CREATE INDEX IF NOT EXISTS tx_to_idx         ON transactions (to_address, block_number DESC);
CREATE INDEX IF NOT EXISTS tx_timestamp_idx  ON transactions (timestamp DESC);

-- ------------------------------------------------------------------ logs --
CREATE TABLE IF NOT EXISTS logs (
  transaction_hash TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  log_index        INTEGER NOT NULL,
  block_number     NUMERIC(78,0) NOT NULL,
  address          TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  topic0           TEXT,
  topic1           TEXT,
  topic2           TEXT,
  topic3           TEXT,
  data             TEXT NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS logs_address_idx ON logs (address, block_number DESC);
CREATE INDEX IF NOT EXISTS logs_topic0_idx  ON logs (topic0, block_number DESC);

-- ------------------------------------------------------------- addresses --
CREATE TABLE IF NOT EXISTS addresses (
  address           TEXT PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  is_contract       BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_block  NUMERIC(78,0),
  last_seen_block   NUMERIC(78,0),
  transaction_count INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Balances are NOT stored: they are read live from the RPC. A cached balance is a wrong
-- balance the moment the next block lands.

-- ------------------------------------------------------------- contracts --
CREATE TABLE IF NOT EXISTS contracts (
  address            TEXT PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  deployer_address   TEXT NOT NULL,
  deployment_tx_hash TEXT NOT NULL,
  deployment_block   NUMERIC(78,0) NOT NULL,
  bytecode_size      INTEGER NOT NULL,
  -- KAURAX runs no source-verification service. This column exists for a future one and is
  -- always FALSE today; the UI must not claim otherwise.
  verified           BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------- tokens --
CREATE TABLE IF NOT EXISTS tokens (
  address          TEXT PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  name             TEXT,
  symbol           TEXT,
  decimals         SMALLINT,
  total_supply     NUMERIC(78,0),
  transfer_count   INTEGER NOT NULL DEFAULT 0,
  first_seen_block NUMERIC(78,0) NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_transfers (
  transaction_hash TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE,
  log_index        INTEGER NOT NULL,
  block_number     NUMERIC(78,0) NOT NULL,
  token_address    TEXT NOT NULL,
  from_address     TEXT NOT NULL,
  to_address       TEXT NOT NULL,
  value            NUMERIC(78,0) NOT NULL,
  timestamp        BIGINT NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS tt_token_idx ON token_transfers (token_address, block_number DESC);
CREATE INDEX IF NOT EXISTS tt_from_idx  ON token_transfers (from_address, block_number DESC);
CREATE INDEX IF NOT EXISTS tt_to_idx    ON token_transfers (to_address, block_number DESC);

-- -------------------------------------------------------------- payments --
-- KAURAX Pay. A row here is an off-chain payment *intent*. It only becomes `confirmed`
-- when a matching on-chain transaction has been observed by the indexer — never on the
-- word of the frontend.
CREATE TABLE IF NOT EXISTS payments (
  id                 UUID PRIMARY KEY,
  merchant_address   TEXT NOT NULL CHECK (merchant_address ~ '^0x[0-9a-f]{40}$'),
  amount             NUMERIC(78,0) NOT NULL CHECK (amount > 0),
  reference          TEXT,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','expired','cancelled')),
  transaction_hash   TEXT,
  payer_address      TEXT,
  confirmed_at_block NUMERIC(78,0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  CONSTRAINT payment_confirmed_needs_tx
    CHECK (status <> 'confirmed' OR transaction_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payments_merchant_idx ON payments (merchant_address, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx   ON payments (status, expires_at);

-- ------------------------------------------------------------- indexer -- 
CREATE TABLE IF NOT EXISTS indexer_state (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_indexed_block  NUMERIC(78,0) NOT NULL DEFAULT 0,
  chain_id            INTEGER NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error          TEXT
);

INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;

COMMIT;
