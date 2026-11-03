-- =====================================================================
-- PayTrust: bulk demo data (Member A)
--   mysql -u root -p paytrust < db/seed_bulk.sql
-- Run AFTER seed.sql and seed_part2.sql. Adds 20 users and ~100 money movements
-- (top-ups, transfers, escrows in every state). Every rupee goes through the stored
-- procedures, so the ledger still balances: wallet_balance_summary shows difference 0.
-- All new users have the password  Demo@1234  (same hash as seed.sql).
-- =====================================================================

SET @pw = '$2b$10$ADVzfSg9ulxwhZikOB4OEu67CSTCFYDBEWr6Bw.FMEx4rFUU9Ub8y';
SET @app_user_id = NULL;

UPDATE users SET kyc_status = 'verified' WHERE id IN (102, 103, 104);
UPDATE users SET kyc_status = 'rejected' WHERE id = 106;

INSERT INTO users (id, full_name, email, password_hash, role, kyc_status) VALUES
  (201, 'Ananya Nair', 'ananya@paytrust.test', @pw, 'user', 'verified'),
  (202, 'Vikram Singh', 'vikram@paytrust.test', @pw, 'user', 'verified'),
  (203, 'Ishita Menon', 'ishita@paytrust.test', @pw, 'user', 'verified'),
  (204, 'Arjun Reddy', 'arjun@paytrust.test', @pw, 'user', 'pending'),
  (205, 'Sneha Kulkarni', 'sneha@paytrust.test', @pw, 'user', 'verified'),
  (206, 'Rahul Verma', 'rahul@paytrust.test', @pw, 'user', 'verified'),
  (207, 'Pooja Bhat', 'pooja@paytrust.test', @pw, 'user', 'verified'),
  (208, 'Nikhil Joshi', 'nikhil@paytrust.test', @pw, 'user', 'rejected'),
  (209, 'Tanvi Desai', 'tanvi@paytrust.test', @pw, 'user', 'verified'),
  (210, 'Aditya Kapoor', 'aditya@paytrust.test', @pw, 'user', 'verified'),
  (211, 'Kavya Pillai', 'kavya@paytrust.test', @pw, 'user', 'verified'),
  (212, 'Siddharth Das', 'siddharth@paytrust.test', @pw, 'user', 'pending'),
  (213, 'Riya Malhotra', 'riya@paytrust.test', @pw, 'user', 'verified'),
  (214, 'Harsh Agarwal', 'harsh@paytrust.test', @pw, 'user', 'verified'),
  (215, 'Neha Chopra', 'neha@paytrust.test', @pw, 'user', 'verified'),
  (216, 'Manav Shah', 'manav@paytrust.test', @pw, 'user', 'rejected'),
  (217, 'Sanya Gill', 'sanya@paytrust.test', @pw, 'user', 'verified'),
  (218, 'Yash Pandey', 'yash@paytrust.test', @pw, 'user', 'verified'),
  (219, 'Aisha Khan', 'aisha@paytrust.test', @pw, 'user', 'verified'),
  (220, 'Dev Mehta', 'dev@paytrust.test', @pw, 'user', 'pending');

INSERT INTO wallets (user_id) SELECT id FROM users WHERE id BETWEEN 201 AND 220;

-- ---- top-ups ----
SET @app_user_id = 201;
CALL add_funds(201, 30000.00, 'bulk-topup-1');
SET @app_user_id = 202;
CALL add_funds(202, 40000.00, 'bulk-topup-2');
SET @app_user_id = 203;
CALL add_funds(203, 30000.00, 'bulk-topup-3');
SET @app_user_id = 204;
CALL add_funds(204, 30000.00, 'bulk-topup-4');
SET @app_user_id = 205;
CALL add_funds(205, 40000.00, 'bulk-topup-5');
SET @app_user_id = 206;
CALL add_funds(206, 40000.00, 'bulk-topup-6');
SET @app_user_id = 207;
CALL add_funds(207, 20000.00, 'bulk-topup-7');
SET @app_user_id = 208;
CALL add_funds(208, 20000.00, 'bulk-topup-8');
SET @app_user_id = 209;
CALL add_funds(209, 40000.00, 'bulk-topup-9');
SET @app_user_id = 210;
CALL add_funds(210, 30000.00, 'bulk-topup-10');
SET @app_user_id = 211;
CALL add_funds(211, 50000.00, 'bulk-topup-11');
SET @app_user_id = 212;
CALL add_funds(212, 40000.00, 'bulk-topup-12');
SET @app_user_id = 213;
CALL add_funds(213, 20000.00, 'bulk-topup-13');
SET @app_user_id = 214;
CALL add_funds(214, 15000.00, 'bulk-topup-14');
SET @app_user_id = 215;
CALL add_funds(215, 30000.00, 'bulk-topup-15');
SET @app_user_id = 216;
CALL add_funds(216, 25000.00, 'bulk-topup-16');
SET @app_user_id = 217;
CALL add_funds(217, 20000.00, 'bulk-topup-17');
SET @app_user_id = 218;
CALL add_funds(218, 15000.00, 'bulk-topup-18');
SET @app_user_id = 219;
CALL add_funds(219, 40000.00, 'bulk-topup-19');
SET @app_user_id = 220;
CALL add_funds(220, 50000.00, 'bulk-topup-20');
SET @app_user_id = 202;
CALL add_funds(202, 5000.00, 'bulk-topup-21');
SET @app_user_id = 213;
CALL add_funds(213, 5000.00, 'bulk-topup-22');
SET @app_user_id = 215;
CALL add_funds(215, 5000.00, 'bulk-topup-23');
SET @app_user_id = 206;
CALL add_funds(206, 5000.00, 'bulk-topup-24');
SET @app_user_id = 201;
CALL add_funds(201, 5000.00, 'bulk-topup-25');
SET @app_user_id = 214;
CALL add_funds(214, 10000.00, 'bulk-topup-26');
SET @app_user_id = 209;
CALL add_funds(209, 10000.00, 'bulk-topup-27');
SET @app_user_id = 220;
CALL add_funds(220, 10000.00, 'bulk-topup-28');

-- ---- peer-to-peer transfers ----
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-29');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 210 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-30');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-31');
SET @app_user_id = 209;
SET @wf = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-32');
SET @app_user_id = 203;
SET @wf = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 750.00, 'bulk-xfer-33');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-34');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-35');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-36');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-37');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-38');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-39');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-40');
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-41');
SET @app_user_id = 211;
SET @wf = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-42');
SET @app_user_id = 211;
SET @wf = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-43');
SET @app_user_id = 204;
SET @wf = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-44');
SET @app_user_id = 204;
SET @wf = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-45');
SET @app_user_id = 215;
SET @wf = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-46');
SET @app_user_id = 218;
SET @wf = (SELECT id FROM wallets WHERE user_id = 218 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-47');
SET @app_user_id = 217;
SET @wf = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-48');
SET @app_user_id = 214;
SET @wf = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-49');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-50');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-51');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-52');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-53');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-54');
SET @app_user_id = 215;
SET @wf = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-55');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-56');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-57');
SET @app_user_id = 203;
SET @wf = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-58');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 212 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 750.00, 'bulk-xfer-59');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-60');
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-61');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-62');
SET @app_user_id = 210;
SET @wf = (SELECT id FROM wallets WHERE user_id = 210 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-63');
SET @app_user_id = 207;
SET @wf = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-64');
SET @app_user_id = 207;
SET @wf = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-65');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-66');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-67');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-68');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-69');
SET @app_user_id = 214;
SET @wf = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-70');
SET @app_user_id = 217;
SET @wf = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-71');
SET @app_user_id = 205;
SET @wf = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-72');
SET @app_user_id = 218;
SET @wf = (SELECT id FROM wallets WHERE user_id = 218 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-73');

-- ---- escrows in every state ----
-- escrow 1: Logo design (created)
SET @app_user_id = 201;
CALL create_escrow('manav@paytrust.test', 2500.00, 'Logo design', 'Three logo concepts and final files', 'bulk-create-74');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
-- escrow 2: Python tutoring (refunded)
SET @app_user_id = 210;
CALL create_escrow('vikram@paytrust.test', 500.00, 'Python tutoring', 'Six one-hour sessions', 'bulk-create-75');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 210);
SET @app_user_id = 210;
CALL fund_escrow(@e, 'bulk-fund-76');
SET @app_user_id = 202;
CALL complete_escrow(@e);
SET @app_user_id = 202;
CALL refund_escrow(@e, 'bulk-refund-77');
-- escrow 3: Used bicycle (disp_release)
SET @app_user_id = 203;
CALL create_escrow('manav@paytrust.test', 800.00, 'Used bicycle', 'Hero 21-speed, pickup from hostel', 'bulk-create-78');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-79');
SET @app_user_id = 216;
CALL complete_escrow(@e);
SET @app_user_id = 216;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'release', 'bulk-resolve-80');
-- escrow 4: Wedding photos (completed)
SET @app_user_id = 211;
CALL create_escrow('sneha@paytrust.test', 800.00, 'Wedding photos', '200 edited photos, soft copy', 'bulk-create-81');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 211);
SET @app_user_id = 211;
CALL fund_escrow(@e, 'bulk-fund-82');
SET @app_user_id = 205;
CALL complete_escrow(@e);
-- escrow 5: Resume review (created)
SET @app_user_id = 203;
CALL create_escrow('neha@paytrust.test', 2500.00, 'Resume review', 'Two rounds of feedback', 'bulk-create-83');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
-- escrow 6: Website landing page (completed)
SET @app_user_id = 202;
CALL create_escrow('sneha@paytrust.test', 2500.00, 'Website landing page', 'Responsive page with contact form', 'bulk-create-84');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 202);
SET @app_user_id = 202;
CALL fund_escrow(@e, 'bulk-fund-85');
SET @app_user_id = 205;
CALL complete_escrow(@e);
-- escrow 7: Textbook set (released)
SET @app_user_id = 212;
CALL create_escrow('ishita@paytrust.test', 4500.00, 'Textbook set', 'Sem 5 books, good condition', 'bulk-create-86');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 212);
SET @app_user_id = 212;
CALL fund_escrow(@e, 'bulk-fund-87');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 212;
CALL release_escrow(@e, 'bulk-release-88');
-- escrow 8: Video edit (released)
SET @app_user_id = 203;
CALL create_escrow('harsh@paytrust.test', 500.00, 'Video edit', '3-minute reel with captions', 'bulk-create-89');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-90');
SET @app_user_id = 214;
CALL complete_escrow(@e);
SET @app_user_id = 203;
CALL release_escrow(@e, 'bulk-release-91');
-- escrow 9: Poster design (completed)
SET @app_user_id = 216;
CALL create_escrow('aisha@paytrust.test', 500.00, 'Poster design', 'A2 size, print-ready PDF', 'bulk-create-92');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 216);
SET @app_user_id = 216;
CALL fund_escrow(@e, 'bulk-fund-93');
SET @app_user_id = 219;
CALL complete_escrow(@e);
-- escrow 10: Guitar lessons (released)
SET @app_user_id = 220;
CALL create_escrow('riya@paytrust.test', 3000.00, 'Guitar lessons', 'Four weekend sessions', 'bulk-create-94');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 220);
SET @app_user_id = 220;
CALL fund_escrow(@e, 'bulk-fund-95');
SET @app_user_id = 213;
CALL complete_escrow(@e);
SET @app_user_id = 220;
CALL release_escrow(@e, 'bulk-release-96');
-- escrow 11: Data entry (released)
SET @app_user_id = 219;
CALL create_escrow('ananya@paytrust.test', 800.00, 'Data entry', '500 records into a spreadsheet', 'bulk-create-97');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 219);
SET @app_user_id = 219;
CALL fund_escrow(@e, 'bulk-fund-98');
SET @app_user_id = 201;
CALL complete_escrow(@e);
SET @app_user_id = 219;
CALL release_escrow(@e, 'bulk-release-99');
-- escrow 12: Translation work (disp_release)
SET @app_user_id = 203;
CALL create_escrow('dev@paytrust.test', 800.00, 'Translation work', 'Hindi to English, 10 pages', 'bulk-create-100');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-101');
SET @app_user_id = 220;
CALL complete_escrow(@e);
SET @app_user_id = 220;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'release', 'bulk-resolve-102');
-- escrow 13: Mobile app bug fixes (released)
SET @app_user_id = 214;
CALL create_escrow('kavya@paytrust.test', 3000.00, 'Mobile app bug fixes', 'Fix login and crash issues', 'bulk-create-103');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 214);
SET @app_user_id = 214;
CALL fund_escrow(@e, 'bulk-fund-104');
SET @app_user_id = 211;
CALL complete_escrow(@e);
SET @app_user_id = 214;
CALL release_escrow(@e, 'bulk-release-105');
-- escrow 14: Birthday cake order (refunded)
SET @app_user_id = 219;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Birthday cake order', '1 kg chocolate cake, delivered', 'bulk-create-106');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 219);
SET @app_user_id = 219;
CALL fund_escrow(@e, 'bulk-fund-107');
SET @app_user_id = 215;
CALL refund_escrow(@e, 'bulk-refund-108');
-- escrow 15: Lab report help (released)
SET @app_user_id = 218;
CALL create_escrow('ishita@paytrust.test', 500.00, 'Lab report help', 'Proofreading and formatting', 'bulk-create-109');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 218);
SET @app_user_id = 218;
CALL fund_escrow(@e, 'bulk-fund-110');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 218;
CALL release_escrow(@e, 'bulk-release-111');
-- escrow 16: Phone stand (funded)
SET @app_user_id = 210;
CALL create_escrow('ishita@paytrust.test', 4500.00, 'Phone stand', '3D printed, two pieces', 'bulk-create-112');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 210);
SET @app_user_id = 210;
CALL fund_escrow(@e, 'bulk-fund-113');
-- escrow 17: Podcast intro music (funded)
SET @app_user_id = 201;
CALL create_escrow('nikhil@paytrust.test', 800.00, 'Podcast intro music', '30-second original track', 'bulk-create-114');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
SET @app_user_id = 201;
CALL fund_escrow(@e, 'bulk-fund-115');
-- escrow 18: Math assignment (released)
SET @app_user_id = 216;
CALL create_escrow('dev@paytrust.test', 2000.00, 'Math assignment', 'Linear algebra problem set', 'bulk-create-116');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 216);
SET @app_user_id = 216;
CALL fund_escrow(@e, 'bulk-fund-117');
SET @app_user_id = 220;
CALL complete_escrow(@e);
SET @app_user_id = 216;
CALL release_escrow(@e, 'bulk-release-118');
-- escrow 19: Logo design (created)
SET @app_user_id = 201;
CALL create_escrow('siddharth@paytrust.test', 2000.00, 'Logo design', 'Three logo concepts and final files', 'bulk-create-119');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
-- escrow 20: Python tutoring (funded)
SET @app_user_id = 205;
CALL create_escrow('pooja@paytrust.test', 1200.00, 'Python tutoring', 'Six one-hour sessions', 'bulk-create-120');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 205);
SET @app_user_id = 205;
CALL fund_escrow(@e, 'bulk-fund-121');
-- escrow 21: Used bicycle (released)
SET @app_user_id = 211;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Used bicycle', 'Hero 21-speed, pickup from hostel', 'bulk-create-122');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 211);
SET @app_user_id = 211;
CALL fund_escrow(@e, 'bulk-fund-123');
SET @app_user_id = 215;
CALL complete_escrow(@e);
SET @app_user_id = 211;
CALL release_escrow(@e, 'bulk-release-124');
-- escrow 22: Wedding photos (completed)
SET @app_user_id = 208;
CALL create_escrow('kavya@paytrust.test', 3000.00, 'Wedding photos', '200 edited photos, soft copy', 'bulk-create-125');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 208);
SET @app_user_id = 208;
CALL fund_escrow(@e, 'bulk-fund-126');
SET @app_user_id = 211;
CALL complete_escrow(@e);
-- escrow 23: Resume review (funded)
SET @app_user_id = 209;
CALL create_escrow('pooja@paytrust.test', 3000.00, 'Resume review', 'Two rounds of feedback', 'bulk-create-127');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 209);
SET @app_user_id = 209;
CALL fund_escrow(@e, 'bulk-fund-128');
-- escrow 24: Website landing page (created)
SET @app_user_id = 207;
CALL create_escrow('dev@paytrust.test', 3000.00, 'Website landing page', 'Responsive page with contact form', 'bulk-create-129');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 207);
-- escrow 25: Textbook set (created)
SET @app_user_id = 208;
CALL create_escrow('aisha@paytrust.test', 2500.00, 'Textbook set', 'Sem 5 books, good condition', 'bulk-create-130');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 208);
-- escrow 26: Video edit (refunded)
SET @app_user_id = 207;
CALL create_escrow('sneha@paytrust.test', 1200.00, 'Video edit', '3-minute reel with captions', 'bulk-create-131');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 207);
SET @app_user_id = 207;
CALL fund_escrow(@e, 'bulk-fund-132');
SET @app_user_id = 205;
CALL refund_escrow(@e, 'bulk-refund-133');
-- escrow 27: Poster design (disp_refund)
SET @app_user_id = 202;
CALL create_escrow('ishita@paytrust.test', 2000.00, 'Poster design', 'A2 size, print-ready PDF', 'bulk-create-134');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 202);
SET @app_user_id = 202;
CALL fund_escrow(@e, 'bulk-fund-135');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 202;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'refund', 'bulk-resolve-136');
-- escrow 28: Guitar lessons (funded)
SET @app_user_id = 204;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Guitar lessons', 'Four weekend sessions', 'bulk-create-137');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 204);
SET @app_user_id = 204;
CALL fund_escrow(@e, 'bulk-fund-138');

-- ---- account states for the admin screens ----
UPDATE users SET is_active = FALSE WHERE id = 220;
SET @app_user_id = NULL;
