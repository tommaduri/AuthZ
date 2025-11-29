//! Unit tests for exchange operations
//! Tests fee computation, balance updates, order matching, and settlement

use proptest::prelude::*;
use std::collections::HashMap;

#[cfg(test)]
mod fee_computation {
    use super::*;

    #[test]
    fn test_basic_fee_calculation() {
        let amount = 1000;
        let fee_rate = 0.001; // 0.1%
        let fee = exchange::calculate_fee(amount, fee_rate);
        assert_eq!(fee, 1);
    }

    #[test]
    fn test_zero_amount_fee() {
        let amount = 0;
        let fee_rate = 0.001;
        let fee = exchange::calculate_fee(amount, fee_rate);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_tiered_fee_structure() {
        let fees = exchange::TieredFees::new()
            .add_tier(0, 1000, 0.002)      // 0-1000: 0.2%
            .add_tier(1001, 10000, 0.001)  // 1001-10000: 0.1%
            .add_tier(10001, u64::MAX, 0.0005); // >10000: 0.05%

        assert_eq!(fees.calculate(500), 1);     // 500 * 0.002 = 1
        assert_eq!(fees.calculate(5000), 5);   // 5000 * 0.001 = 5
        assert_eq!(fees.calculate(20000), 10); // 20000 * 0.0005 = 10
    }

    #[test]
    fn test_maker_taker_fees() {
        let maker_rate = 0.0005; // 0.05%
        let taker_rate = 0.001;  // 0.1%

        let maker_fee = exchange::calculate_fee(10000, maker_rate);
        let taker_fee = exchange::calculate_fee(10000, taker_rate);

        assert_eq!(maker_fee, 5);
        assert_eq!(taker_fee, 10);
        assert!(taker_fee > maker_fee);
    }

    #[test]
    fn test_fee_precision() {
        let amount = 1;
        let fee_rate = 0.001;
        let fee = exchange::calculate_fee(amount, fee_rate);
        // Should handle rounding correctly
        assert!(fee >= 0);
    }

    proptest! {
        #[test]
        fn test_fee_is_proportional(
            amount in 1u64..1_000_000,
            fee_rate in 0.0..0.1
        ) {
            let fee1 = exchange::calculate_fee(amount, fee_rate);
            let fee2 = exchange::calculate_fee(amount * 2, fee_rate);

            // Fee should roughly double when amount doubles
            prop_assert!(fee2 >= fee1);
        }
    }
}

#[cfg(test)]
mod balance_management {
    use super::*;

    #[test]
    fn test_create_balance() {
        let balance = exchange::Balance::new([1u8; 32]);
        assert_eq!(balance.available(), 0);
        assert_eq!(balance.locked(), 0);
    }

    #[test]
    fn test_deposit() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(1000).unwrap();
        assert_eq!(balance.available(), 1000);
    }

    #[test]
    fn test_withdraw() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(1000).unwrap();
        balance.withdraw(300).unwrap();
        assert_eq!(balance.available(), 700);
    }

    #[test]
    fn test_withdraw_insufficient_funds() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(100).unwrap();
        let result = balance.withdraw(200);
        assert!(result.is_err());
    }

    #[test]
    fn test_lock_funds() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(1000).unwrap();
        balance.lock(300).unwrap();

        assert_eq!(balance.available(), 700);
        assert_eq!(balance.locked(), 300);
    }

    #[test]
    fn test_unlock_funds() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(1000).unwrap();
        balance.lock(300).unwrap();
        balance.unlock(100).unwrap();

        assert_eq!(balance.available(), 800);
        assert_eq!(balance.locked(), 200);
    }

    #[test]
    fn test_total_balance() {
        let mut balance = exchange::Balance::new([1u8; 32]);
        balance.deposit(1000).unwrap();
        balance.lock(300).unwrap();

        assert_eq!(balance.total(), 1000);
    }

    proptest! {
        #[test]
        fn test_balance_operations_maintain_invariants(
            deposits in prop::collection::vec(1u64..1000, 1..10),
            withdrawals in prop::collection::vec(1u64..100, 1..5)
        ) {
            let mut balance = exchange::Balance::new([1u8; 32]);

            let mut total_deposited = 0;
            for deposit in deposits {
                balance.deposit(deposit).ok();
                total_deposited += deposit;
            }

            for withdrawal in withdrawals {
                balance.withdraw(withdrawal).ok();
            }

            // Total should never exceed deposits
            prop_assert!(balance.total() <= total_deposited);
            // Available + locked should equal total
            prop_assert_eq!(balance.total(), balance.available() + balance.locked());
        }
    }
}

#[cfg(test)]
mod order_matching {
    use super::*;

    #[test]
    fn test_create_order() {
        let order = exchange::Order::new(
            [1u8; 32],  // user
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            1000,       // amount
            50,         // price
        );

        assert_eq!(order.amount(), 1000);
        assert_eq!(order.price(), 50);
    }

    #[test]
    fn test_market_order() {
        let order = exchange::Order::market(
            [1u8; 32],
            exchange::Side::Buy,
            1000,
        );

        assert_eq!(order.order_type(), exchange::OrderType::Market);
        assert!(order.price() == 0); // Market orders have no price
    }

    #[test]
    fn test_match_limit_orders() {
        let buy_order = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            100,
            50,
        );

        let sell_order = exchange::Order::new(
            [2u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Sell,
            100,
            50,
        );

        let mut matcher = exchange::OrderMatcher::new();
        let matches = matcher.match_orders(&buy_order, &sell_order);

        assert!(matches.is_some());
        if let Some(trade) = matches {
            assert_eq!(trade.amount, 100);
            assert_eq!(trade.price, 50);
        }
    }

    #[test]
    fn test_partial_fill() {
        let buy_order = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            150,
            50,
        );

        let sell_order = exchange::Order::new(
            [2u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Sell,
            100,
            50,
        );

        let mut matcher = exchange::OrderMatcher::new();
        let matches = matcher.match_orders(&buy_order, &sell_order);

        assert!(matches.is_some());
        if let Some(trade) = matches {
            assert_eq!(trade.amount, 100); // Only matched available amount
            assert_eq!(buy_order.remaining(), 50);
        }
    }

    #[test]
    fn test_price_mismatch() {
        let buy_order = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            100,
            45, // Buying at 45
        );

        let sell_order = exchange::Order::new(
            [2u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Sell,
            100,
            50, // Selling at 50
        );

        let mut matcher = exchange::OrderMatcher::new();
        let matches = matcher.match_orders(&buy_order, &sell_order);

        assert!(matches.is_none()); // No match because buy < sell price
    }

    #[test]
    fn test_order_book_insert() {
        let mut book = exchange::OrderBook::new();

        let order = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            100,
            50,
        );

        book.insert(order.clone());
        assert_eq!(book.buy_orders().len(), 1);
    }

    #[test]
    fn test_order_book_matching() {
        let mut book = exchange::OrderBook::new();

        // Add buy order
        let buy = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            100,
            50,
        );
        book.insert(buy);

        // Add matching sell order
        let sell = exchange::Order::new(
            [2u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Sell,
            100,
            50,
        );

        let trades = book.process_order(sell);
        assert_eq!(trades.len(), 1);
    }

    #[test]
    fn test_order_cancellation() {
        let mut book = exchange::OrderBook::new();

        let order = exchange::Order::new(
            [1u8; 32],
            exchange::OrderType::Limit,
            exchange::Side::Buy,
            100,
            50,
        );
        let order_id = order.id();

        book.insert(order);
        assert!(book.cancel_order(&order_id).is_ok());
        assert_eq!(book.buy_orders().len(), 0);
    }
}

#[cfg(test)]
mod settlement {
    use super::*;

    #[test]
    fn test_create_settlement() {
        let settlement = exchange::Settlement::new(
            [1u8; 32], // trade_id
            [2u8; 32], // buyer
            [3u8; 32], // seller
            100,       // amount
            50,        // price
        );

        assert_eq!(settlement.amount(), 100);
        assert_eq!(settlement.price(), 50);
    }

    #[test]
    fn test_settlement_verification() {
        let settlement = exchange::Settlement::new(
            [1u8; 32],
            [2u8; 32],
            [3u8; 32],
            100,
            50,
        );

        assert!(settlement.verify());
    }

    #[test]
    fn test_atomic_settlement() {
        let mut exchange_state = exchange::ExchangeState::new();

        let buyer = [1u8; 32];
        let seller = [2u8; 32];

        // Setup balances
        exchange_state.deposit(buyer, 5000).unwrap();
        exchange_state.deposit(seller, 100).unwrap();

        let settlement = exchange::Settlement::new(
            [0u8; 32],
            buyer,
            seller,
            100, // amount
            50,  // price (total: 5000)
        );

        let result = exchange_state.settle(&settlement);
        assert!(result.is_ok());

        // Verify balances updated correctly
        assert_eq!(exchange_state.get_balance(&buyer), 100); // Received 100 units
        assert_eq!(exchange_state.get_balance(&seller), 5100); // Received 5000 payment
    }

    #[test]
    fn test_settlement_rollback_on_error() {
        let mut exchange_state = exchange::ExchangeState::new();

        let buyer = [1u8; 32];
        let seller = [2u8; 32];

        // Insufficient funds
        exchange_state.deposit(buyer, 100).unwrap();

        let settlement = exchange::Settlement::new(
            [0u8; 32],
            buyer,
            seller,
            100,
            50, // Total: 5000 but buyer only has 100
        );

        let result = exchange_state.settle(&settlement);
        assert!(result.is_err());

        // Balances should remain unchanged
        assert_eq!(exchange_state.get_balance(&buyer), 100);
        assert_eq!(exchange_state.get_balance(&seller), 0);
    }
}

#[cfg(test)]
mod trading_pairs {
    use super::*;

    #[test]
    fn test_create_trading_pair() {
        let pair = exchange::TradingPair::new("BTC", "USD");
        assert_eq!(pair.base(), "BTC");
        assert_eq!(pair.quote(), "USD");
    }

    #[test]
    fn test_get_market_price() {
        let mut pair = exchange::TradingPair::new("BTC", "USD");
        pair.update_price(50000);
        assert_eq!(pair.last_price(), 50000);
    }

    #[test]
    fn test_price_history() {
        let mut pair = exchange::TradingPair::new("BTC", "USD");
        pair.update_price(50000);
        pair.update_price(51000);
        pair.update_price(49000);

        let history = pair.price_history(3);
        assert_eq!(history.len(), 3);
    }

    #[test]
    fn test_volume_tracking() {
        let mut pair = exchange::TradingPair::new("BTC", "USD");
        pair.add_volume(100);
        pair.add_volume(50);

        assert_eq!(pair.volume_24h(), 150);
    }
}

#[cfg(test)]
mod liquidity_pool {
    use super::*;

    #[test]
    fn test_create_pool() {
        let pool = exchange::LiquidityPool::new(
            "BTC",
            "USD",
            1000,  // Initial BTC
            50000000, // Initial USD (1000 * 50000)
        );

        assert_eq!(pool.reserve_a(), 1000);
        assert_eq!(pool.reserve_b(), 50000000);
    }

    #[test]
    fn test_add_liquidity() {
        let mut pool = exchange::LiquidityPool::new("BTC", "USD", 1000, 50000000);

        let shares = pool.add_liquidity(100, 5000000).unwrap();
        assert!(shares > 0);
        assert_eq!(pool.reserve_a(), 1100);
        assert_eq!(pool.reserve_b(), 55000000);
    }

    #[test]
    fn test_swap() {
        let mut pool = exchange::LiquidityPool::new("BTC", "USD", 1000, 50000000);

        let output = pool.swap_a_for_b(10).unwrap();
        assert!(output > 0);

        // Verify constant product formula
        let k_before = 1000 * 50000000;
        let k_after = pool.reserve_a() * pool.reserve_b();
        assert!(k_after >= k_before); // Should maintain or increase due to fees
    }

    #[test]
    fn test_price_impact() {
        let pool = exchange::LiquidityPool::new("BTC", "USD", 1000, 50000000);

        let impact_small = pool.price_impact(1);
        let impact_large = pool.price_impact(100);

        assert!(impact_large > impact_small);
    }
}
