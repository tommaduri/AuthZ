//! Resource marketplace implementation
//!
//! Provides a decentralized marketplace for trading computational resources,
//! storage, bandwidth, and other AGI infrastructure services.

use crate::error::{ExchangeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

/// Resource type enumeration
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceType {
    /// Computational resources (CPU, GPU)
    Compute,
    /// Storage resources
    Storage,
    /// Network bandwidth
    Bandwidth,
    /// Memory resources
    Memory,
    /// Custom resource type
    Custom(String),
}

/// Resource unit for pricing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceUnit {
    /// CPU cores
    CpuCore,
    /// GPU units
    GpuUnit,
    /// Gigabytes
    Gigabyte,
    /// Megabits per second
    Mbps,
    /// Per hour
    Hour,
}

/// Resource listing on the marketplace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceListing {
    /// Unique listing ID
    pub id: String,
    /// Provider agent ID
    pub provider_id: String,
    /// Resource type
    pub resource_type: ResourceType,
    /// Available quantity
    pub quantity: f64,
    /// Unit of measurement
    pub unit: ResourceUnit,
    /// Price per unit (in credits)
    pub price_per_unit: f64,
    /// Minimum order quantity
    pub min_quantity: f64,
    /// Provider reputation score (0.0 - 1.0)
    pub reputation: f64,
    /// Listing creation timestamp
    pub created_at: i64,
    /// Listing expiration timestamp
    pub expires_at: i64,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl ResourceListing {
    /// Create a new resource listing
    pub fn new(
        provider_id: String,
        resource_type: ResourceType,
        quantity: f64,
        unit: ResourceUnit,
        price_per_unit: f64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: Uuid::new_v4().to_string(),
            provider_id,
            resource_type,
            quantity,
            unit,
            price_per_unit,
            min_quantity: 1.0,
            reputation: 0.5, // Default neutral reputation
            created_at: now,
            expires_at: now + 86400, // 24 hours default
            metadata: HashMap::new(),
        }
    }

    /// Check if listing is still valid
    pub fn is_valid(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        self.quantity > 0.0 && self.expires_at > now
    }

    /// Calculate total price for a quantity
    pub fn calculate_price(&self, quantity: f64) -> Result<f64> {
        if quantity < self.min_quantity {
            return Err(ExchangeError::Marketplace(format!(
                "Quantity {} below minimum {}",
                quantity, self.min_quantity
            )));
        }
        if quantity > self.quantity {
            return Err(ExchangeError::ResourceUnavailable(format!(
                "Requested {} but only {} available",
                quantity, self.quantity
            )));
        }
        Ok(quantity * self.price_per_unit)
    }
}

/// Marketplace order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceOrder {
    /// Order ID
    pub id: String,
    /// Listing ID
    pub listing_id: String,
    /// Buyer agent ID
    pub buyer_id: String,
    /// Ordered quantity
    pub quantity: f64,
    /// Total price
    pub total_price: f64,
    /// Order status
    pub status: OrderStatus,
    /// Order creation timestamp
    pub created_at: i64,
}

/// Order status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus {
    /// Order pending acceptance
    Pending,
    /// Order accepted by provider
    Accepted,
    /// Order in progress
    InProgress,
    /// Order completed successfully
    Completed,
    /// Order cancelled
    Cancelled,
    /// Order failed
    Failed,
}

/// Marketplace configuration
#[derive(Debug, Clone)]
pub struct MarketplaceConfig {
    /// Maximum active listings per provider
    pub max_listings_per_provider: usize,
    /// Default listing expiration (seconds)
    pub default_expiration: i64,
    /// Minimum reputation for listing
    pub min_reputation: f64,
}

impl Default for MarketplaceConfig {
    fn default() -> Self {
        Self {
            max_listings_per_provider: 100,
            default_expiration: 86400, // 24 hours
            min_reputation: 0.3,        // Minimum 30% reputation
        }
    }
}

/// Marketplace managing resource listings and orders
pub struct Marketplace {
    config: MarketplaceConfig,
    listings: Arc<RwLock<HashMap<String, ResourceListing>>>,
    orders: Arc<RwLock<HashMap<String, MarketplaceOrder>>>,
    provider_listings: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl Marketplace {
    /// Create a new marketplace
    pub fn new(config: MarketplaceConfig) -> Self {
        Self {
            config,
            listings: Arc::new(RwLock::new(HashMap::new())),
            orders: Arc::new(RwLock::new(HashMap::new())),
            provider_listings: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Add a resource listing
    pub fn add_listing(&self, mut listing: ResourceListing) -> Result<String> {
        // Validate reputation
        if listing.reputation < self.config.min_reputation {
            return Err(ExchangeError::InsufficientReputation(format!(
                "Reputation {} below minimum {}",
                listing.reputation, self.config.min_reputation
            )));
        }

        // Check provider listing limit
        let provider_listings = self.provider_listings.read().unwrap();
        if let Some(listings) = provider_listings.get(&listing.provider_id) {
            if listings.len() >= self.config.max_listings_per_provider {
                return Err(ExchangeError::Marketplace(format!(
                    "Provider has reached maximum listings ({})",
                    self.config.max_listings_per_provider
                )));
            }
        }
        drop(provider_listings);

        // Set default expiration if not set
        if listing.expires_at == 0 {
            listing.expires_at = listing.created_at + self.config.default_expiration;
        }

        let listing_id = listing.id.clone();
        let provider_id = listing.provider_id.clone();

        // Add to listings
        let mut listings = self.listings.write().unwrap();
        listings.insert(listing_id.clone(), listing);
        drop(listings);

        // Track provider listings
        let mut provider_listings = self.provider_listings.write().unwrap();
        provider_listings
            .entry(provider_id)
            .or_insert_with(Vec::new)
            .push(listing_id.clone());

        Ok(listing_id)
    }

    /// Get a listing by ID
    pub fn get_listing(&self, listing_id: &str) -> Result<ResourceListing> {
        let listings = self.listings.read().unwrap();
        listings
            .get(listing_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Marketplace(format!("Listing {} not found", listing_id)))
    }

    /// Search listings by resource type
    pub fn search_listings(&self, resource_type: &ResourceType) -> Vec<ResourceListing> {
        let listings = self.listings.read().unwrap();
        listings
            .values()
            .filter(|l| &l.resource_type == resource_type && l.is_valid())
            .cloned()
            .collect()
    }

    /// Get all valid listings
    pub fn list_all_active(&self) -> Vec<ResourceListing> {
        let listings = self.listings.read().unwrap();
        listings
            .values()
            .filter(|l| l.is_valid())
            .cloned()
            .collect()
    }

    /// Create an order for a listing
    pub fn create_order(
        &self,
        listing_id: String,
        buyer_id: String,
        quantity: f64,
    ) -> Result<String> {
        // Get and validate listing
        let listing = self.get_listing(&listing_id)?;
        if !listing.is_valid() {
            return Err(ExchangeError::ResourceUnavailable(
                "Listing expired or invalid".to_string(),
            ));
        }

        // Calculate price
        let total_price = listing.calculate_price(quantity)?;

        // Create order
        let order = MarketplaceOrder {
            id: Uuid::new_v4().to_string(),
            listing_id,
            buyer_id,
            quantity,
            total_price,
            status: OrderStatus::Pending,
            created_at: chrono::Utc::now().timestamp(),
        };

        let order_id = order.id.clone();

        // Store order
        let mut orders = self.orders.write().unwrap();
        orders.insert(order_id.clone(), order);

        Ok(order_id)
    }

    /// Update order status
    pub fn update_order_status(&self, order_id: &str, status: OrderStatus) -> Result<()> {
        let mut orders = self.orders.write().unwrap();
        let order = orders
            .get_mut(order_id)
            .ok_or_else(|| ExchangeError::Marketplace(format!("Order {} not found", order_id)))?;

        order.status = status;
        Ok(())
    }

    /// Get order by ID
    pub fn get_order(&self, order_id: &str) -> Result<MarketplaceOrder> {
        let orders = self.orders.read().unwrap();
        orders
            .get(order_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Marketplace(format!("Order {} not found", order_id)))
    }

    /// Remove expired listings
    pub fn cleanup_expired(&self) -> usize {
        let mut listings = self.listings.write().unwrap();
        let mut provider_listings = self.provider_listings.write().unwrap();

        let now = chrono::Utc::now().timestamp();
        let expired: Vec<String> = listings
            .iter()
            .filter(|(_, l)| l.expires_at <= now)
            .map(|(id, _)| id.clone())
            .collect();

        let count = expired.len();

        // Remove from listings
        for id in &expired {
            if let Some(listing) = listings.remove(id) {
                // Remove from provider tracking
                if let Some(provider_list) = provider_listings.get_mut(&listing.provider_id) {
                    provider_list.retain(|l| l != id);
                }
            }
        }

        count
    }

    /// Get marketplace statistics
    pub fn get_stats(&self) -> MarketplaceStats {
        let listings = self.listings.read().unwrap();
        let orders = self.orders.read().unwrap();

        let active_listings = listings.values().filter(|l| l.is_valid()).count();
        let pending_orders = orders
            .values()
            .filter(|o| o.status == OrderStatus::Pending)
            .count();
        let completed_orders = orders
            .values()
            .filter(|o| o.status == OrderStatus::Completed)
            .count();

        MarketplaceStats {
            total_listings: listings.len(),
            active_listings,
            total_orders: orders.len(),
            pending_orders,
            completed_orders,
        }
    }
}

/// Marketplace statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceStats {
    pub total_listings: usize,
    pub active_listings: usize,
    pub total_orders: usize,
    pub pending_orders: usize,
    pub completed_orders: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resource_listing_creation() {
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );

        assert_eq!(listing.provider_id, "provider-001");
        assert_eq!(listing.resource_type, ResourceType::Compute);
        assert_eq!(listing.quantity, 100.0);
        assert_eq!(listing.price_per_unit, 10.0);
        assert!(listing.is_valid());
    }

    #[test]
    fn test_listing_price_calculation() {
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Storage,
            1000.0,
            ResourceUnit::Gigabyte,
            0.5,
        );

        assert_eq!(listing.calculate_price(100.0).unwrap(), 50.0);
        assert_eq!(listing.calculate_price(500.0).unwrap(), 250.0);
    }

    #[test]
    fn test_listing_validation() {
        let mut listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Bandwidth,
            50.0,
            ResourceUnit::Mbps,
            2.0,
        );

        // Test minimum quantity
        listing.min_quantity = 10.0;
        assert!(listing.calculate_price(5.0).is_err());
        assert!(listing.calculate_price(10.0).is_ok());

        // Test maximum quantity
        assert!(listing.calculate_price(100.0).is_err());
    }

    #[test]
    fn test_marketplace_add_listing() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );

        let listing_id = marketplace.add_listing(listing).unwrap();
        assert!(!listing_id.is_empty());

        let retrieved = marketplace.get_listing(&listing_id).unwrap();
        assert_eq!(retrieved.provider_id, "provider-001");
    }

    #[test]
    fn test_marketplace_search() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());

        // Add multiple listings
        let listing1 = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );
        let listing2 = ResourceListing::new(
            "provider-002".to_string(),
            ResourceType::Storage,
            500.0,
            ResourceUnit::Gigabyte,
            0.5,
        );
        let listing3 = ResourceListing::new(
            "provider-003".to_string(),
            ResourceType::Compute,
            50.0,
            ResourceUnit::GpuUnit,
            20.0,
        );

        marketplace.add_listing(listing1).unwrap();
        marketplace.add_listing(listing2).unwrap();
        marketplace.add_listing(listing3).unwrap();

        let compute_listings = marketplace.search_listings(&ResourceType::Compute);
        assert_eq!(compute_listings.len(), 2);

        let storage_listings = marketplace.search_listings(&ResourceType::Storage);
        assert_eq!(storage_listings.len(), 1);
    }

    #[test]
    fn test_marketplace_create_order() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );

        let listing_id = marketplace.add_listing(listing).unwrap();
        let order_id = marketplace
            .create_order(listing_id, "buyer-001".to_string(), 10.0)
            .unwrap();

        let order = marketplace.get_order(&order_id).unwrap();
        assert_eq!(order.buyer_id, "buyer-001");
        assert_eq!(order.quantity, 10.0);
        assert_eq!(order.total_price, 100.0);
        assert_eq!(order.status, OrderStatus::Pending);
    }

    #[test]
    fn test_marketplace_order_status_update() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Storage,
            500.0,
            ResourceUnit::Gigabyte,
            0.5,
        );

        let listing_id = marketplace.add_listing(listing).unwrap();
        let order_id = marketplace
            .create_order(listing_id, "buyer-001".to_string(), 100.0)
            .unwrap();

        marketplace
            .update_order_status(&order_id, OrderStatus::Accepted)
            .unwrap();
        let order = marketplace.get_order(&order_id).unwrap();
        assert_eq!(order.status, OrderStatus::Accepted);

        marketplace
            .update_order_status(&order_id, OrderStatus::Completed)
            .unwrap();
        let order = marketplace.get_order(&order_id).unwrap();
        assert_eq!(order.status, OrderStatus::Completed);
    }

    #[test]
    fn test_marketplace_stats() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());

        let listing1 = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );
        let listing2 = ResourceListing::new(
            "provider-002".to_string(),
            ResourceType::Storage,
            500.0,
            ResourceUnit::Gigabyte,
            0.5,
        );

        let listing_id1 = marketplace.add_listing(listing1).unwrap();
        marketplace.add_listing(listing2).unwrap();

        marketplace
            .create_order(listing_id1, "buyer-001".to_string(), 10.0)
            .unwrap();

        let stats = marketplace.get_stats();
        assert_eq!(stats.total_listings, 2);
        assert_eq!(stats.active_listings, 2);
        assert_eq!(stats.total_orders, 1);
        assert_eq!(stats.pending_orders, 1);
    }

    #[test]
    fn test_insufficient_reputation() {
        let marketplace = Marketplace::new(MarketplaceConfig::default());
        let mut listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            10.0,
        );

        listing.reputation = 0.1; // Below minimum 0.3
        let result = marketplace.add_listing(listing);
        assert!(result.is_err());
    }

    #[test]
    fn test_provider_listing_limit() {
        let mut config = MarketplaceConfig::default();
        config.max_listings_per_provider = 2;
        let marketplace = Marketplace::new(config);

        // Add 2 listings (should succeed)
        for i in 0..2 {
            let listing = ResourceListing::new(
                "provider-001".to_string(),
                ResourceType::Compute,
                100.0,
                ResourceUnit::CpuCore,
                10.0 + i as f64,
            );
            marketplace.add_listing(listing).unwrap();
        }

        // Try to add 3rd listing (should fail)
        let listing = ResourceListing::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            ResourceUnit::CpuCore,
            12.0,
        );
        let result = marketplace.add_listing(listing);
        assert!(result.is_err());
    }
}
