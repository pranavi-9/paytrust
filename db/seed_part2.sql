-- Member A: demo money for seed PART 2 (replaces the commented block in seed.sql).
-- Run AFTER seed.sql. Wallets: 3=Aarav(102) 4=Diya(103) 5=Kabir(104) 6=Meera(105) 7=Rohan(106)
SET @app_user_id = 102; CALL add_funds(102, 50000.00, 'seed-topup-102');
SET @app_user_id = 103; CALL add_funds(103, 20000.00, 'seed-topup-103');
SET @app_user_id = 105; CALL add_funds(105, 10000.00, 'seed-topup-105');
SET @app_user_id = 102; CALL process_transfer(3, 4, 500.00, 'seed-transfer-1');
SET @app_user_id = 103; CALL process_transfer(4, 6, 250.00, 'seed-transfer-2');
-- escrow 1 (Aarav -> Diya): full happy path
SET @app_user_id = 102; CALL fund_escrow(1, 'seed-fund-1');
SET @app_user_id = 103; CALL complete_escrow(1);
SET @app_user_id = 102; CALL release_escrow(1, 'seed-release-1');
-- escrow 2 (Aarav -> Kabir): funded, waiting on seller
SET @app_user_id = 102; CALL fund_escrow(2, 'seed-fund-2');
-- escrow 3 (Diya -> Meera): disputed, for the admin to resolve
SET @app_user_id = 103; CALL fund_escrow(3, 'seed-fund-3');
SET @app_user_id = 105; CALL dispute_escrow(3);
SET @app_user_id = NULL;
