-- Kitty — D1 schema
-- Design note: this database stores *metadata and a cache of on-chain facts*.
-- It is never the source of truth for money. Every contribution row carries the
-- tx hash that produced it, so the whole pot can be rebuilt from chain data alone.

DROP TABLE IF EXISTS contributions;
DROP TABLE IF EXISTS kitties;

CREATE TABLE kitties (
  id             TEXT PRIMARY KEY,          -- short, URL-safe, human-shareable
  title          TEXT NOT NULL,
  note           TEXT,                      -- optional "what's this for"
  emoji          TEXT NOT NULL DEFAULT '🎁',
  rail           TEXT NOT NULL,             -- 'nim' | 'usdt'
  chain_id       INTEGER,                   -- EVM chain id; NULL for the NIM rail
  target_amount  TEXT NOT NULL,             -- decimal string, base units (Luna / token smallest unit)
  payout_address TEXT NOT NULL,             -- the organizer's address: the pot itself
  organizer_id   TEXT NOT NULL,             -- device identifier hash; who may settle
  organizer_name TEXT,
  settled_at     INTEGER,                   -- unix seconds; NULL while open
  settle_tx      TEXT,                      -- tx hash of the payout
  settle_to      TEXT,                      -- final destination of the payout
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_kitties_created ON kitties(created_at DESC);
CREATE INDEX idx_kitties_organizer ON kitties(organizer_id);

CREATE TABLE contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kitty_id    TEXT NOT NULL REFERENCES kitties(id) ON DELETE CASCADE,
  tx_hash     TEXT NOT NULL,
  from_addr   TEXT NOT NULL,
  amount      TEXT NOT NULL,                -- decimal string, base units
  display_name TEXT,
  device_id   TEXT,                         -- for the leaderboard; nullable if declined
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'failed'
  created_at  INTEGER NOT NULL,
  UNIQUE(kitty_id, tx_hash)                 -- a tx can only ever count once
);

CREATE INDEX idx_contrib_kitty ON contributions(kitty_id, created_at DESC);
CREATE INDEX idx_contrib_device ON contributions(device_id);
CREATE INDEX idx_contrib_pending ON contributions(status) WHERE status = 'pending';
