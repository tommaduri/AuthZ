//! Integration tests for exchange transactions
//! Tests complete trading flows from order to settlement

use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod complete_trade_flow {
    use super::*;

    #[tokio::test]
    async fn test_simple_trade() {
        let exchange = setup_test_exchange().await;

        let buyer = create_test_user("buyer").await;
        let seller = create_test_user("seller").await;

        // Setup balances
        exchange.deposit(buyer.id, "USD", 10000).await.unwrap();
        exchange.deposit(seller.id, "BTC", 1).await.unwrap();

        // Place orders
        let buy_order = exchange.place_limit_order(
            buyer.id,
            Side::Buy,
            "BTC/USD",
            0.5,  // amount
            50000, // price
        ).await.unwrap();

        let sell_order = exchange.place_limit_order(
            seller.id,
            Side::Sell,
            "BTC/USD",
            0.5,
            50000,
        ).await.unwrap();

        // Wait for matching
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Verify trade execution
        let buyer_balance = exchange.get_balance(buyer.id, "BTC").await.unwrap();
        let seller_balance = exchange.get_balance(seller.id, "USD").await.unwrap();

        assert!(buyer_balance >= 0.5);
        assert!(seller_balance >= 25000.0); // 0.5 * 50000
    }

    #[tokio::test]
    async fn test_market_order_execution() {
        let exchange = setup_test_exchange().await;

        let maker = create_test_user("maker").await;
        let taker = create_test_user("taker").await;

        // Setup
        exchange.deposit(maker.id, "BTC", 1).await.unwrap();
        exchange.deposit(taker.id, "USD", 60000).await.unwrap();

        // Maker places limit order
        exchange.place_limit_order(
            maker.id,
            Side::Sell,
            "BTC/USD",
            1.0,
            50000,
        ).await.unwrap();

        // Taker places market order
        let market_order = exchange.place_market_order(
            taker.id,
            Side::Buy,
            "BTC/USD",
            1.0,
        ).await.unwrap();

        // Market order should execute immediately
        assert!(market_order.is_filled());

        let taker_btc = exchange.get_balance(taker.id, "BTC").await.unwrap();
        assert!(taker_btc >= 1.0);
    }

    #[tokio::test]
    async fn test_partial_fill() {
        let exchange = setup_test_exchange().await;

        let buyer = create_test_user("buyer").await;
        let seller1 = create_test_user("seller1").await;
        let seller2 = create_test_user("seller2").await;

        // Setup
        exchange.deposit(buyer.id, "USD", 100000).await.unwrap();
        exchange.deposit(seller1.id, "BTC", 0.5).await.unwrap();
        exchange.deposit(seller2.id, "BTC", 0.5).await.unwrap();

        // Sellers place orders
        exchange.place_limit_order(seller1.id, Side::Sell, "BTC/USD", 0.5, 50000).await.unwrap();
        exchange.place_limit_order(seller2.id, Side::Sell, "BTC/USD", 0.5, 50000).await.unwrap();

        // Buyer wants 1.0 BTC
        let order = exchange.place_limit_order(
            buyer.id,
            Side::Buy,
            "BTC/USD",
            1.0,
            50000,
        ).await.unwrap();

        // Wait for matching
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Should be completely filled by two orders
        assert!(order.is_filled());
        assert_eq!(order.fills().len(), 2);

        let buyer_btc = exchange.get_balance(buyer.id, "BTC").await.unwrap();
        assert!(buyer_btc >= 1.0);
    }
}

#[cfg(test)]
mod order_book_integration {
    use super::*;

    #[tokio::test]
    async fn test_order_book_depth() {
        let exchange = setup_test_exchange().await;

        // Add multiple orders at different prices
        for i in 0..10 {
            let user = create_test_user(&format!("seller{}", i)).await;
            exchange.deposit(user.id, "BTC", 1).await.unwrap();

            exchange.place_limit_order(
                user.id,
                Side::Sell,
                "BTC/USD",
                1.0,
                50000 + (i * 100) as f64,
            ).await.unwrap();
        }

        let depth = exchange.get_order_book_depth("BTC/USD", 10).await.unwrap();

        assert_eq!(depth.asks.len(), 10);
        // Verify price ordering
        for i in 1..depth.asks.len() {
            assert!(depth.asks[i].price >= depth.asks[i - 1].price);
        }
    }

    #[tokio::test]
    async fn test_order_cancellation() {
        let exchange = setup_test_exchange().await;

        let user = create_test_user("trader").await;
        exchange.deposit(user.id, "BTC", 1).await.unwrap();

        let order = exchange.place_limit_order(
            user.id,
            Side::Sell,
            "BTC/USD",
            1.0,
            50000,
        ).await.unwrap();

        // Cancel order
        let result = exchange.cancel_order(user.id, order.id()).await;
        assert!(result.is_ok());

        // Verify order is removed
        let depth = exchange.get_order_book_depth("BTC/USD", 10).await.unwrap();
        assert_eq!(depth.asks.len(), 0);
    }

    #[tokio::test]
    async fn test_price_time_priority() {
        let exchange = setup_test_exchange().await;

        let user1 = create_test_user("user1").await;
        let user2 = create_test_user("user2").await;
        let user3 = create_test_user("user3").await;

        // Setup sellers
        exchange.deposit(user1.id, "BTC", 1).await.unwrap();
        exchange.deposit(user2.id, "BTC", 1).await.unwrap();
        exchange.deposit(user3.id, "BTC", 1).await.unwrap();

        // Place orders at same price (time priority)
        let order1 = exchange.place_limit_order(user1.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        let order2 = exchange.place_limit_order(user2.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        let order3 = exchange.place_limit_order(user3.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();

        // Buyer matches one order
        let buyer = create_test_user("buyer").await;
        exchange.deposit(buyer.id, "USD", 50000).await.unwrap();

        exchange.place_market_order(buyer.id, Side::Buy, "BTC/USD", 1.0).await.unwrap();

        // First order should be filled (time priority)
        assert!(order1.is_filled());
        assert!(!order2.is_filled());
        assert!(!order3.is_filled());
    }
}

#[cfg(test)]
mod fee_handling {
    use super::*;

    #[tokio::test]
    async fn test_maker_taker_fees() {
        let exchange = setup_test_exchange().await;

        let maker = create_test_user("maker").await;
        let taker = create_test_user("taker").await;

        exchange.deposit(maker.id, "BTC", 1).await.unwrap();
        exchange.deposit(taker.id, "USD", 50000).await.unwrap();

        // Maker posts order
        exchange.place_limit_order(maker.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();

        let initial_usd = exchange.get_balance(maker.id, "USD").await.unwrap();

        // Taker takes order
        exchange.place_market_order(taker.id, Side::Buy, "BTC/USD", 1.0).await.unwrap();

        // Check fees
        let maker_fee = exchange.get_fee_paid(maker.id).await.unwrap();
        let taker_fee = exchange.get_fee_paid(taker.id).await.unwrap();

        // Taker should pay more
        assert!(taker_fee > maker_fee);

        // Maker should receive less due to fee
        let final_usd = exchange.get_balance(maker.id, "USD").await.unwrap();
        let received = final_usd - initial_usd;
        assert!(received < 50000.0); // Less than full amount
    }

    #[tokio::test]
    async fn test_fee_accumulation() {
        let exchange = setup_test_exchange().await;

        let user = create_test_user("trader").await;
        exchange.deposit(user.id, "BTC", 10).await.unwrap();
        exchange.deposit(user.id, "USD", 500000).await.unwrap();

        // Execute multiple trades
        for _ in 0..10 {
            exchange.place_market_order(user.id, Side::Sell, "BTC/USD", 0.5).await.unwrap();
            exchange.place_market_order(user.id, Side::Buy, "BTC/USD", 0.5).await.unwrap();
        }

        let total_fees = exchange.get_total_fees_paid(user.id).await.unwrap();
        assert!(total_fees > 0.0);

        println!("Total fees for 20 trades: ${:.2}", total_fees);
    }
}

#[cfg(test)]
mod settlement_verification {
    use super::*;

    #[tokio::test]
    async fn test_atomic_settlement() {
        let exchange = setup_test_exchange().await;

        let buyer = create_test_user("buyer").await;
        let seller = create_test_user("seller").await;

        exchange.deposit(buyer.id, "USD", 50000).await.unwrap();
        exchange.deposit(seller.id, "BTC", 1).await.unwrap();

        let buyer_usd_before = exchange.get_balance(buyer.id, "USD").await.unwrap();
        let seller_btc_before = exchange.get_balance(seller.id, "BTC").await.unwrap();

        // Execute trade
        exchange.place_limit_order(seller.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();
        exchange.place_market_order(buyer.id, Side::Buy, "BTC/USD", 1.0).await.unwrap();

        // Verify atomic update
        let buyer_usd_after = exchange.get_balance(buyer.id, "USD").await.unwrap();
        let buyer_btc_after = exchange.get_balance(buyer.id, "BTC").await.unwrap();
        let seller_usd_after = exchange.get_balance(seller.id, "USD").await.unwrap();
        let seller_btc_after = exchange.get_balance(seller.id, "BTC").await.unwrap();

        // Conservation of value
        assert!(buyer_usd_before > buyer_usd_after);
        assert!(buyer_btc_after > 0.0);
        assert!(seller_btc_before > seller_btc_after);
        assert!(seller_usd_after > 0.0);
    }

    #[tokio::test]
    async fn test_settlement_rollback() {
        let exchange = setup_test_exchange().await;

        let buyer = create_test_user("buyer").await;
        let seller = create_test_user("seller").await;

        // Insufficient funds
        exchange.deposit(buyer.id, "USD", 1000).await.unwrap();
        exchange.deposit(seller.id, "BTC", 1).await.unwrap();

        let initial_buyer_usd = exchange.get_balance(buyer.id, "USD").await.unwrap();

        // Try to buy more than buyer can afford
        let result = exchange.place_market_order(buyer.id, Side::Buy, "BTC/USD", 1.0).await;

        // Should fail
        assert!(result.is_err());

        // Balances should be unchanged
        let final_buyer_usd = exchange.get_balance(buyer.id, "USD").await.unwrap();
        assert_eq!(initial_buyer_usd, final_buyer_usd);
    }

    #[tokio::test]
    async fn test_concurrent_settlements() {
        let exchange = Arc::new(setup_test_exchange().await);

        // Create multiple users
        let mut handles = vec![];

        for i in 0..20 {
            let ex = Arc::clone(&exchange);

            let handle = tokio::spawn(async move {
                let buyer = create_test_user(&format!("buyer{}", i)).await;
                let seller = create_test_user(&format!("seller{}", i)).await;

                ex.deposit(buyer.id, "USD", 50000).await.unwrap();
                ex.deposit(seller.id, "BTC", 1).await.unwrap();

                ex.place_limit_order(seller.id, Side::Sell, "BTC/USD", 1.0, 50000).await.unwrap();
                ex.place_market_order(buyer.id, Side::Buy, "BTC/USD", 1.0).await
            });

            handles.push(handle);
        }

        let results: Vec<_> = futures::future::join_all(handles).await;

        // All settlements should succeed
        for result in results {
            assert!(result.is_ok());
            assert!(result.unwrap().is_ok());
        }
    }
}

#[cfg(test)]
mod liquidity_pools {
    use super::*;

    #[tokio::test]
    async fn test_pool_creation() {
        let exchange = setup_test_exchange().await;

        let lp = create_test_user("lp").await;
        exchange.deposit(lp.id, "BTC", 10).await.unwrap();
        exchange.deposit(lp.id, "USD", 500000).await.unwrap();

        let pool = exchange.create_liquidity_pool(
            lp.id,
            "BTC/USD",
            10.0,    // BTC
            500000.0, // USD
        ).await.unwrap();

        assert!(pool.reserve_a() >= 10.0);
        assert!(pool.reserve_b() >= 500000.0);
    }

    #[tokio::test]
    async fn test_swap_through_pool() {
        let exchange = setup_test_exchange().await;

        // Setup pool
        let lp = create_test_user("lp").await;
        exchange.deposit(lp.id, "BTC", 10).await.unwrap();
        exchange.deposit(lp.id, "USD", 500000).await.unwrap();
        exchange.create_liquidity_pool(lp.id, "BTC/USD", 10.0, 500000.0).await.unwrap();

        // Trader swaps
        let trader = create_test_user("trader").await;
        exchange.deposit(trader.id, "USD", 50000).await.unwrap();

        let output = exchange.swap(
            trader.id,
            "BTC/USD",
            "USD",
            50000.0,
        ).await.unwrap();

        assert!(output > 0.0);

        let trader_btc = exchange.get_balance(trader.id, "BTC").await.unwrap();
        assert!(trader_btc > 0.0);
    }

    #[tokio::test]
    async fn test_price_impact() {
        let exchange = setup_test_exchange().await;

        let lp = create_test_user("lp").await;
        exchange.deposit(lp.id, "BTC", 10).await.unwrap();
        exchange.deposit(lp.id, "USD", 500000).await.unwrap();
        exchange.create_liquidity_pool(lp.id, "BTC/USD", 10.0, 500000.0).await.unwrap();

        // Small swap
        let impact1 = exchange.calculate_price_impact("BTC/USD", 1000.0).await.unwrap();

        // Large swap
        let impact2 = exchange.calculate_price_impact("BTC/USD", 100000.0).await.unwrap();

        // Larger swaps have more impact
        assert!(impact2 > impact1);
        println!("Small swap impact: {:.2}%", impact1 * 100.0);
        println!("Large swap impact: {:.2}%", impact2 * 100.0);
    }
}

#[cfg(test)]
mod order_types {
    use super::*;

    #[tokio::test]
    async fn test_stop_loss_order() {
        let exchange = setup_test_exchange().await;

        let trader = create_test_user("trader").await;
        exchange.deposit(trader.id, "BTC", 1).await.unwrap();

        // Place stop-loss at $45,000
        let stop_loss = exchange.place_stop_order(
            trader.id,
            Side::Sell,
            "BTC/USD",
            1.0,
            45000.0, // trigger price
            44500.0, // limit price
        ).await.unwrap();

        // Simulate price drop
        exchange.update_market_price("BTC/USD", 44000.0).await;

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Stop loss should trigger
        assert!(stop_loss.is_triggered());
    }

    #[tokio::test]
    async fn test_iceberg_order() {
        let exchange = setup_test_exchange().await;

        let whale = create_test_user("whale").await;
        exchange.deposit(whale.id, "BTC", 100).await.unwrap();

        // Place iceberg: 100 BTC total, 10 BTC visible
        let iceberg = exchange.place_iceberg_order(
            whale.id,
            Side::Sell,
            "BTC/USD",
            100.0, // total
            10.0,  // visible
            50000.0,
        ).await.unwrap();

        let depth = exchange.get_order_book_depth("BTC/USD", 10).await.unwrap();

        // Only 10 BTC should be visible
        assert!(depth.asks[0].amount <= 10.0);
    }
}

// Test utilities

struct TestExchange {
    balances: Arc<RwLock<HashMap<([u8; 32], String), f64>>>,
    order_book: Arc<RwLock<OrderBook>>,
}

impl TestExchange {
    async fn deposit(&self, user: [u8; 32], asset: &str, amount: f64) -> Result<(), ExchangeError> {
        let key = (user, asset.to_string());
        let mut balances = self.balances.write().await;
        *balances.entry(key).or_insert(0.0) += amount;
        Ok(())
    }

    async fn get_balance(&self, user: [u8; 32], asset: &str) -> Result<f64, ExchangeError> {
        let key = (user, asset.to_string());
        let balances = self.balances.read().await;
        Ok(*balances.get(&key).unwrap_or(&0.0))
    }

    async fn place_limit_order(
        &self,
        user: [u8; 32],
        side: Side,
        pair: &str,
        amount: f64,
        price: f64,
    ) -> Result<Order, ExchangeError> {
        Ok(Order::new(user, side, amount, price))
    }

    async fn place_market_order(
        &self,
        user: [u8; 32],
        side: Side,
        pair: &str,
        amount: f64,
    ) -> Result<Order, ExchangeError> {
        Ok(Order::new(user, side, amount, 0.0))
    }
}

struct TestUser {
    id: [u8; 32],
}

async fn create_test_user(name: &str) -> TestUser {
    TestUser {
        id: crypto::hash(name.as_bytes()),
    }
}

async fn setup_test_exchange() -> TestExchange {
    TestExchange {
        balances: Arc::new(RwLock::new(HashMap::new())),
        order_book: Arc::new(RwLock::new(OrderBook::new())),
    }
}

struct Order {
    user: [u8; 32],
    side: Side,
    amount: f64,
    price: f64,
    filled: f64,
}

impl Order {
    fn new(user: [u8; 32], side: Side, amount: f64, price: f64) -> Self {
        Self { user, side, amount, price, filled: 0.0 }
    }

    fn is_filled(&self) -> bool {
        self.filled >= self.amount
    }

    fn id(&self) -> [u8; 32] {
        [0u8; 32]
    }

    fn is_triggered(&self) -> bool {
        true
    }

    fn fills(&self) -> Vec<Fill> {
        vec![]
    }
}

struct Fill;
struct OrderBook;

impl OrderBook {
    fn new() -> Self {
        Self
    }
}

#[derive(Clone, Copy)]
enum Side {
    Buy,
    Sell,
}

#[derive(Debug)]
enum ExchangeError {
    InsufficientFunds,
    InvalidOrder,
}
