-- Homes, members, bills and shares.
-- Money is stored as whole cents (INTEGER). Never decimals.

CREATE TABLE homes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id       TEXT PRIMARY KEY,
  home_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- Stops members pointing at a home that does not exist.
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  -- Stops two members from taking the same slot in one home (keeps "order added" unambiguous).
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE bills (
  id          TEXT PRIMARY KEY,
  home_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  -- Stops zero, negative and fractional totals reaching the database.
  CONSTRAINT bills_total_positive_integer CHECK (typeof(total_cents) = 'integer' AND total_cents > 0),
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0)
);

CREATE TABLE shares (
  id              TEXT PRIMARY KEY,
  bill_id         TEXT NOT NULL,
  member_id       TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  paid_at         TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
  -- Stops a member from getting two shares of the same bill.
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_amount_non_negative CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  -- A share is either unpaid (no date, no key) or paid (date and key together).
  CONSTRAINT shares_paid_has_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX shares_member_idx ON shares (member_id);
CREATE INDEX bills_home_idx ON bills (home_id);
