INSERT INTO `currencies` (`code`, `name`, `minor_units`, `created_at`)
VALUES
  ('USD', 'US Dollar', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('EUR', 'Euro', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('GBP', 'Pound Sterling', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('AED', 'UAE Dirham', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('CAD', 'Canadian Dollar', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('AUD', 'Australian Dollar', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('SGD', 'Singapore Dollar', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('JPY', 'Japanese Yen', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('CHF', 'Swiss Franc', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (`code`) DO NOTHING;