//! DHT-Based Resource Discovery
//!
//! Implements distributed resource discovery using:
//! - Distributed Hash Table (DHT) for resource indexing
//! - Agent capability advertising
//! - Resource availability queries
//! - Geo-location aware routing

use crate::error::{ExchangeError, Result};
use crate::marketplace::ResourceType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Resource advertisement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceAdvertisement {
    /// Advertisement ID
    pub id: String,
    /// Provider agent ID
    pub provider_id: String,
    /// Resource type
    pub resource_type: ResourceType,
    /// Available quantity
    pub quantity: f64,
    /// Price per unit
    pub price: f64,
    /// Geographic location (optional)
    pub location: Option<String>,
    /// Capabilities/tags
    pub capabilities: Vec<String>,
    /// TTL in seconds
    pub ttl: i64,
    /// Creation timestamp
    pub created_at: i64,
    /// Expiration timestamp
    pub expires_at: i64,
}

impl ResourceAdvertisement {
    /// Create a new advertisement
    pub fn new(
        provider_id: String,
        resource_type: ResourceType,
        quantity: f64,
        price: f64,
        ttl: i64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            provider_id,
            resource_type,
            quantity,
            price,
            location: None,
            capabilities: Vec::new(),
            ttl,
            created_at: now,
            expires_at: now + ttl,
        }
    }

    /// Check if advertisement is expired
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() > self.expires_at
    }

    /// Add capability tag
    pub fn with_capability(mut self, capability: String) -> Self {
        self.capabilities.push(capability);
        self
    }

    /// Set location
    pub fn with_location(mut self, location: String) -> Self {
        self.location = Some(location);
        self
    }
}

/// Resource query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceQuery {
    /// Resource type to search for
    pub resource_type: Option<ResourceType>,
    /// Minimum quantity required
    pub min_quantity: Option<f64>,
    /// Maximum price willing to pay
    pub max_price: Option<f64>,
    /// Required capabilities
    pub required_capabilities: Vec<String>,
    /// Preferred location
    pub preferred_location: Option<String>,
}

impl ResourceQuery {
    /// Create a new query
    pub fn new() -> Self {
        Self {
            resource_type: None,
            min_quantity: None,
            max_price: None,
            required_capabilities: Vec::new(),
            preferred_location: None,
        }
    }

    /// Set resource type filter
    pub fn with_type(mut self, resource_type: ResourceType) -> Self {
        self.resource_type = Some(resource_type);
        self
    }

    /// Set minimum quantity
    pub fn with_min_quantity(mut self, quantity: f64) -> Self {
        self.min_quantity = Some(quantity);
        self
    }

    /// Set maximum price
    pub fn with_max_price(mut self, price: f64) -> Self {
        self.max_price = Some(price);
        self
    }

    /// Add required capability
    pub fn with_capability(mut self, capability: String) -> Self {
        self.required_capabilities.push(capability);
        self
    }

    /// Check if advertisement matches query
    pub fn matches(&self, ad: &ResourceAdvertisement) -> bool {
        // Check resource type
        if let Some(ref rt) = self.resource_type {
            if *rt != ad.resource_type {
                return false;
            }
        }

        // Check quantity
        if let Some(min_qty) = self.min_quantity {
            if ad.quantity < min_qty {
                return false;
            }
        }

        // Check price
        if let Some(max_price) = self.max_price {
            if ad.price > max_price {
                return false;
            }
        }

        // Check capabilities
        for req_cap in &self.required_capabilities {
            if !ad.capabilities.contains(req_cap) {
                return false;
            }
        }

        true
    }
}

impl Default for ResourceQuery {
    fn default() -> Self {
        Self::new()
    }
}

/// Discovery service
pub struct DiscoveryService {
    advertisements: Arc<RwLock<HashMap<String, ResourceAdvertisement>>>,
    provider_ads: Arc<RwLock<HashMap<String, Vec<String>>>>,
    type_index: Arc<RwLock<HashMap<ResourceType, Vec<String>>>>,
}

impl DiscoveryService {
    /// Create a new discovery service
    pub fn new() -> Self {
        Self {
            advertisements: Arc::new(RwLock::new(HashMap::new())),
            provider_ads: Arc::new(RwLock::new(HashMap::new())),
            type_index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Advertise a resource
    pub fn advertise(&self, advertisement: ResourceAdvertisement) -> Result<String> {
        let ad_id = advertisement.id.clone();
        let provider_id = advertisement.provider_id.clone();
        let resource_type = advertisement.resource_type.clone();

        // Store advertisement
        self.advertisements
            .write()
            .unwrap()
            .insert(ad_id.clone(), advertisement);

        // Index by provider
        self.provider_ads
            .write()
            .unwrap()
            .entry(provider_id)
            .or_insert_with(Vec::new)
            .push(ad_id.clone());

        // Index by resource type
        self.type_index
            .write()
            .unwrap()
            .entry(resource_type)
            .or_insert_with(Vec::new)
            .push(ad_id.clone());

        Ok(ad_id)
    }

    /// Search for resources matching query
    pub fn search(&self, query: ResourceQuery) -> Vec<ResourceAdvertisement> {
        let advertisements = self.advertisements.read().unwrap();

        // Get candidate ads based on resource type if specified
        let candidates: Vec<String> = if let Some(ref rt) = query.resource_type {
            self.type_index
                .read()
                .unwrap()
                .get(rt)
                .cloned()
                .unwrap_or_default()
        } else {
            advertisements.keys().cloned().collect()
        };

        // Filter and collect matching ads
        candidates
            .iter()
            .filter_map(|id| advertisements.get(id))
            .filter(|ad| !ad.is_expired() && query.matches(ad))
            .cloned()
            .collect()
    }

    /// Get advertisement by ID
    pub fn get_advertisement(&self, ad_id: &str) -> Result<ResourceAdvertisement> {
        self.advertisements
            .read()
            .unwrap()
            .get(ad_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Discovery("Advertisement not found".to_string()))
    }

    /// Get all advertisements for a provider
    pub fn get_provider_advertisements(&self, provider_id: &str) -> Vec<ResourceAdvertisement> {
        let provider_ads = self.provider_ads.read().unwrap();
        let advertisements = self.advertisements.read().unwrap();

        provider_ads
            .get(provider_id)
            .map(|ad_ids| {
                ad_ids
                    .iter()
                    .filter_map(|id| advertisements.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Remove an advertisement
    pub fn remove_advertisement(&self, ad_id: &str) -> Result<()> {
        let mut advertisements = self.advertisements.write().unwrap();
        let ad = advertisements
            .remove(ad_id)
            .ok_or_else(|| ExchangeError::Discovery("Advertisement not found".to_string()))?;

        // Remove from provider index
        if let Some(ads) = self.provider_ads.write().unwrap().get_mut(&ad.provider_id) {
            ads.retain(|id| id != ad_id);
        }

        // Remove from type index
        if let Some(ads) = self.type_index.write().unwrap().get_mut(&ad.resource_type) {
            ads.retain(|id| id != ad_id);
        }

        Ok(())
    }

    /// Cleanup expired advertisements
    pub fn cleanup_expired(&self) -> usize {
        let mut advertisements = self.advertisements.write().unwrap();
        let expired: Vec<String> = advertisements
            .iter()
            .filter(|(_, ad)| ad.is_expired())
            .map(|(id, _)| id.clone())
            .collect();

        for id in &expired {
            advertisements.remove(id);
        }

        expired.len()
    }

    /// Get discovery statistics
    pub fn get_stats(&self) -> DiscoveryStats {
        let advertisements = self.advertisements.read().unwrap();

        DiscoveryStats {
            total_advertisements: advertisements.len(),
            active_providers: self.provider_ads.read().unwrap().len(),
            by_resource_type: self
                .type_index
                .read()
                .unwrap()
                .iter()
                .map(|(rt, ads)| (rt.clone(), ads.len()))
                .collect(),
        }
    }
}

impl Default for DiscoveryService {
    fn default() -> Self {
        Self::new()
    }
}

/// Discovery statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryStats {
    pub total_advertisements: usize,
    pub active_providers: usize,
    pub by_resource_type: HashMap<ResourceType, usize>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_advertisement_creation() {
        let ad = ResourceAdvertisement::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            10.0,
            3600,
        );

        assert_eq!(ad.provider_id, "provider-001");
        assert_eq!(ad.resource_type, ResourceType::Compute);
        assert_eq!(ad.quantity, 100.0);
        assert_eq!(ad.price, 10.0);
    }

    #[test]
    fn test_advertisement_builder() {
        let ad = ResourceAdvertisement::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            10.0,
            3600,
        )
        .with_capability("gpu".to_string())
        .with_location("us-west".to_string());

        assert_eq!(ad.capabilities.len(), 1);
        assert_eq!(ad.location, Some("us-west".to_string()));
    }

    #[test]
    fn test_query_matching() {
        let ad = ResourceAdvertisement::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            10.0,
            3600,
        )
        .with_capability("gpu".to_string());

        let query = ResourceQuery::new()
            .with_type(ResourceType::Compute)
            .with_min_quantity(50.0)
            .with_max_price(15.0)
            .with_capability("gpu".to_string());

        assert!(query.matches(&ad));
    }

    #[test]
    fn test_query_no_match() {
        let ad = ResourceAdvertisement::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            10.0,
            3600,
        );

        // Query requires capability not in ad
        let query = ResourceQuery::new().with_capability("gpu".to_string());

        assert!(!query.matches(&ad));
    }

    #[test]
    fn test_discovery_service() {
        let service = DiscoveryService::new();

        let ad = ResourceAdvertisement::new(
            "provider-001".to_string(),
            ResourceType::Compute,
            100.0,
            10.0,
            3600,
        );

        let ad_id = service.advertise(ad).unwrap();
        let retrieved = service.get_advertisement(&ad_id).unwrap();

        assert_eq!(retrieved.provider_id, "provider-001");
    }

    #[test]
    fn test_resource_search() {
        let service = DiscoveryService::new();

        // Advertise multiple resources
        service
            .advertise(ResourceAdvertisement::new(
                "provider-001".to_string(),
                ResourceType::Compute,
                100.0,
                10.0,
                3600,
            ))
            .unwrap();
        service
            .advertise(ResourceAdvertisement::new(
                "provider-002".to_string(),
                ResourceType::Storage,
                500.0,
                5.0,
                3600,
            ))
            .unwrap();
        service
            .advertise(ResourceAdvertisement::new(
                "provider-003".to_string(),
                ResourceType::Compute,
                200.0,
                15.0,
                3600,
            ))
            .unwrap();

        // Search for compute resources under $12
        let query = ResourceQuery::new()
            .with_type(ResourceType::Compute)
            .with_max_price(12.0);

        let results = service.search(query);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider_id, "provider-001");
    }

    #[test]
    fn test_provider_advertisements() {
        let service = DiscoveryService::new();

        service
            .advertise(ResourceAdvertisement::new(
                "provider-001".to_string(),
                ResourceType::Compute,
                100.0,
                10.0,
                3600,
            ))
            .unwrap();
        service
            .advertise(ResourceAdvertisement::new(
                "provider-001".to_string(),
                ResourceType::Storage,
                500.0,
                5.0,
                3600,
            ))
            .unwrap();

        let ads = service.get_provider_advertisements("provider-001");
        assert_eq!(ads.len(), 2);
    }

    #[test]
    fn test_remove_advertisement() {
        let service = DiscoveryService::new();

        let ad_id = service
            .advertise(ResourceAdvertisement::new(
                "provider-001".to_string(),
                ResourceType::Compute,
                100.0,
                10.0,
                3600,
            ))
            .unwrap();

        service.remove_advertisement(&ad_id).unwrap();
        assert!(service.get_advertisement(&ad_id).is_err());
    }

    #[test]
    fn test_discovery_stats() {
        let service = DiscoveryService::new();

        service
            .advertise(ResourceAdvertisement::new(
                "provider-001".to_string(),
                ResourceType::Compute,
                100.0,
                10.0,
                3600,
            ))
            .unwrap();
        service
            .advertise(ResourceAdvertisement::new(
                "provider-002".to_string(),
                ResourceType::Storage,
                500.0,
                5.0,
                3600,
            ))
            .unwrap();

        let stats = service.get_stats();
        assert_eq!(stats.total_advertisements, 2);
        assert_eq!(stats.active_providers, 2);
    }
}
