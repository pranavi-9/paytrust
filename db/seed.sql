-- =====================================================================
-- PayTrust: seed data (Member B)
-- Run after both schemas and triggers.sql:
--   mysql -u root -p paytrust < db/seed.sql
--
-- Every seeded user's password is:  Demo@1234   (bcrypt hash below)
--
-- This part moves NO money. It creates users, empty wallets and escrows
-- in 'created' status only. Balances and funded/released escrows come
-- from A's procedures in db/seed_part2.sql, so the ledger reconciles.
--
-- Assumed columns in A's tables (adjust if A's schema differs):
--   users  (id, full_name, email, password_hash, role)
--   wallets(user_id)  with balance defaulting to 0.00
-- =====================================================================

START TRANSACTION;

SET @app_user_id = NULL;
SET @pw = '$2b$10$ADVzfSg9ulxwhZikOB4OEu67CSTCFYDBEWr6Bw.FMEx4rFUU9Ub8y';

INSERT INTO users (id, full_name, email, password_hash, role) VALUES
  (101, 'Admin User',    'admin@paytrust.test',  @pw, 'admin'),
  (102, 'Aarav Sharma',  'aarav@paytrust.test',  @pw, 'user'),
  (103, 'Diya Patel',    'diya@paytrust.test',   @pw, 'user'),
  (104, 'Kabir Rao',     'kabir@paytrust.test',  @pw, 'user'),
  (105, 'Meera Iyer',    'meera@paytrust.test',  @pw, 'user'),
  (106, 'Rohan Gupta',   'rohan@paytrust.test',  @pw, 'user');

-- One wallet per normal user (the admin does not trade).
INSERT INTO wallets (user_id)
SELECT id FROM users WHERE id BETWEEN 102 AND 106;

-- Escrows waiting to be funded. The insert trigger logs each one.
INSERT INTO escrows (buyer_id, seller_id, amount, title, description) VALUES
  (102, 103, 2500.00, 'Logo design',          'Three logo concepts and final files'),
  (102, 104, 12000.00,'Used laptop',          'ThinkPad T14, shipped by courier'),
  (103, 105, 800.00,  'Calculus tutoring',    'Four one-hour sessions'),
  (104, 106, 4500.00, 'Event photography',    'College fest, 200 edited photos'),
  (105, 102, 1500.00, 'Website bug fixes',    'Fix contact form and mobile layout'),
  (106, 103, 650.00,  'Handmade notebook set','Set of three, delivered on campus');

COMMIT;

-- =====================================================================
-- PART 2: demo money lives in Member A's db/seed_part2.sql. Run it next:
--   mysql -u root -p paytrust < db/seed_part2.sql
-- It tops up wallets through add_funds and moves escrows 1-3 through
-- fund / complete / release / dispute, so every status has an example and
-- the ledger reconciles to zero.
-- =====================================================================
