//! Integration tests for derived roles functionality
//!
//! Tests complex organizational hierarchies, concurrent role resolution,
//! multi-tenant scenarios, and performance validation.

use cretoai_authz::derived_roles::{DerivedRoleResolver, RoleResolutionCache};
use cretoai_authz::policy::{PolicyEffect, Role};
use cretoai_core::types::{CretoResult, TenantId, UserId};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::task::JoinSet;

/// Create a complex organizational hierarchy for testing
fn create_organizational_hierarchy() -> Vec<Role> {
    vec![
        // Executive level
        Role {
            id: "ceo".to_string(),
            name: "CEO".to_string(),
            description: Some("Chief Executive Officer".to_string()),
            permissions: vec!["*".to_string()].into_iter().collect(),
            inherits_from: vec![],
            metadata: Default::default(),
        },
        // VPs inherit from CEO
        Role {
            id: "vp_engineering".to_string(),
            name: "VP Engineering".to_string(),
            description: Some("Vice President of Engineering".to_string()),
            permissions: vec!["engineering:*".to_string()].into_iter().collect(),
            inherits_from: vec!["ceo".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "vp_sales".to_string(),
            name: "VP Sales".to_string(),
            description: Some("Vice President of Sales".to_string()),
            permissions: vec!["sales:*".to_string()].into_iter().collect(),
            inherits_from: vec!["ceo".to_string()],
            metadata: Default::default(),
        },
        // Directors inherit from VPs
        Role {
            id: "director_backend".to_string(),
            name: "Director Backend".to_string(),
            description: Some("Director of Backend Engineering".to_string()),
            permissions: vec!["backend:*".to_string()].into_iter().collect(),
            inherits_from: vec!["vp_engineering".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "director_frontend".to_string(),
            name: "Director Frontend".to_string(),
            description: Some("Director of Frontend Engineering".to_string()),
            permissions: vec!["frontend:*".to_string()].into_iter().collect(),
            inherits_from: vec!["vp_engineering".to_string()],
            metadata: Default::default(),
        },
        // Managers inherit from Directors
        Role {
            id: "manager_api".to_string(),
            name: "API Manager".to_string(),
            description: Some("API Team Manager".to_string()),
            permissions: vec!["api:*".to_string()].into_iter().collect(),
            inherits_from: vec!["director_backend".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "manager_ui".to_string(),
            name: "UI Manager".to_string(),
            description: Some("UI Team Manager".to_string()),
            permissions: vec!["ui:*".to_string()].into_iter().collect(),
            inherits_from: vec!["director_frontend".to_string()],
            metadata: Default::default(),
        },
        // Engineers inherit from Managers
        Role {
            id: "senior_engineer".to_string(),
            name: "Senior Engineer".to_string(),
            description: Some("Senior Software Engineer".to_string()),
            permissions: vec!["code:write".to_string(), "review:approve".to_string()]
                .into_iter()
                .collect(),
            inherits_from: vec!["manager_api".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "engineer".to_string(),
            name: "Engineer".to_string(),
            description: Some("Software Engineer".to_string()),
            permissions: vec!["code:write".to_string()].into_iter().collect(),
            inherits_from: vec!["senior_engineer".to_string()],
            metadata: Default::default(),
        },
        // Intern at the bottom
        Role {
            id: "intern".to_string(),
            name: "Intern".to_string(),
            description: Some("Engineering Intern".to_string()),
            permissions: vec!["code:read".to_string()].into_iter().collect(),
            inherits_from: vec!["engineer".to_string()],
            metadata: Default::default(),
        },
    ]
}

#[tokio::test]
async fn test_complex_role_hierarchy_resolution() -> CretoResult<()> {
    let roles = create_organizational_hierarchy();
    let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles.clone(), cache.clone());

    // Test CEO has all permissions
    let ceo_permissions = resolver.resolve_role_permissions("ceo").await?;
    assert!(ceo_permissions.contains("*"));
    assert_eq!(ceo_permissions.len(), 1); // Only direct permission

    // Test VP Engineering inherits from CEO
    let vp_eng_permissions = resolver.resolve_role_permissions("vp_engineering").await?;
    assert!(vp_eng_permissions.contains("engineering:*"));
    assert!(vp_eng_permissions.contains("*"));
    assert_eq!(vp_eng_permissions.len(), 2);

    // Test Intern inherits through entire chain
    let intern_permissions = resolver.resolve_role_permissions("intern").await?;
    assert!(intern_permissions.contains("code:read"));
    assert!(intern_permissions.contains("code:write"));
    assert!(intern_permissions.contains("review:approve"));
    assert!(intern_permissions.contains("api:*"));
    assert!(intern_permissions.contains("backend:*"));
    assert!(intern_permissions.contains("engineering:*"));
    assert!(intern_permissions.contains("*"));
    assert_eq!(intern_permissions.len(), 7);

    Ok(())
}

#[tokio::test]
async fn test_100_concurrent_role_resolutions() -> CretoResult<()> {
    let roles = create_organizational_hierarchy();
    let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let resolver = Arc::new(DerivedRoleResolver::new(roles.clone(), cache.clone()));

    let mut join_set = JoinSet::new();
    let start = Instant::now();

    // Spawn 100 concurrent role resolution tasks
    for i in 0..100 {
        let resolver = resolver.clone();
        let role_id = match i % 10 {
            0 => "ceo".to_string(),
            1 => "vp_engineering".to_string(),
            2 => "vp_sales".to_string(),
            3 => "director_backend".to_string(),
            4 => "director_frontend".to_string(),
            5 => "manager_api".to_string(),
            6 => "manager_ui".to_string(),
            7 => "senior_engineer".to_string(),
            8 => "engineer".to_string(),
            _ => "intern".to_string(),
        };

        join_set.spawn(async move {
            let permissions = resolver.resolve_role_permissions(&role_id).await?;
            Ok::<_, cretoai_core::error::CretoError>(permissions)
        });
    }

    // Wait for all tasks to complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        let permissions = result.unwrap()?;
        results.push(permissions);
    }

    let duration = start.elapsed();

    // Verify all tasks completed successfully
    assert_eq!(results.len(), 100);

    // Performance validation: Should complete in <100ms total
    assert!(
        duration < Duration::from_millis(100),
        "100 concurrent resolutions took {:?}, expected <100ms",
        duration
    );

    // Verify cache hit rate (second round should be faster)
    let cache_start = Instant::now();
    for i in 0..100 {
        let role_id = match i % 10 {
            0 => "ceo",
            1 => "vp_engineering",
            2 => "vp_sales",
            3 => "director_backend",
            4 => "director_frontend",
            5 => "manager_api",
            6 => "manager_ui",
            7 => "senior_engineer",
            8 => "engineer",
            _ => "intern",
        };
        resolver.resolve_role_permissions(role_id).await?;
    }
    let cache_duration = cache_start.elapsed();

    // Cache hits should be significantly faster
    assert!(
        cache_duration < duration / 2,
        "Cached resolutions took {:?}, original took {:?}",
        cache_duration,
        duration
    );

    println!("First 100 resolutions: {:?}", duration);
    println!("Cached 100 resolutions: {:?}", cache_duration);
    println!("Speedup: {:.2}x", duration.as_micros() as f64 / cache_duration.as_micros() as f64);

    Ok(())
}

#[tokio::test]
async fn test_multi_tenant_role_isolation() -> CretoResult<()> {
    // Create separate role hierarchies for two tenants
    let tenant1_roles = vec![
        Role {
            id: "tenant1_admin".to_string(),
            name: "Tenant 1 Admin".to_string(),
            description: Some("Administrator for Tenant 1".to_string()),
            permissions: vec!["tenant1:*".to_string()].into_iter().collect(),
            inherits_from: vec![],
            metadata: [("tenant_id".to_string(), "tenant1".to_string())]
                .into_iter()
                .collect(),
        },
        Role {
            id: "tenant1_user".to_string(),
            name: "Tenant 1 User".to_string(),
            description: Some("User for Tenant 1".to_string()),
            permissions: vec!["tenant1:read".to_string()].into_iter().collect(),
            inherits_from: vec!["tenant1_admin".to_string()],
            metadata: [("tenant_id".to_string(), "tenant1".to_string())]
                .into_iter()
                .collect(),
        },
    ];

    let tenant2_roles = vec![
        Role {
            id: "tenant2_admin".to_string(),
            name: "Tenant 2 Admin".to_string(),
            description: Some("Administrator for Tenant 2".to_string()),
            permissions: vec!["tenant2:*".to_string()].into_iter().collect(),
            inherits_from: vec![],
            metadata: [("tenant_id".to_string(), "tenant2".to_string())]
                .into_iter()
                .collect(),
        },
        Role {
            id: "tenant2_user".to_string(),
            name: "Tenant 2 User".to_string(),
            description: Some("User for Tenant 2".to_string()),
            permissions: vec!["tenant2:read".to_string()].into_iter().collect(),
            inherits_from: vec!["tenant2_admin".to_string()],
            metadata: [("tenant_id".to_string(), "tenant2".to_string())]
                .into_iter()
                .collect(),
        },
    ];

    // Create separate resolvers for each tenant
    let cache1 = Arc::new(RoleResolutionCache::new(100, Duration::from_secs(300)));
    let resolver1 = DerivedRoleResolver::new(tenant1_roles, cache1);

    let cache2 = Arc::new(RoleResolutionCache::new(100, Duration::from_secs(300)));
    let resolver2 = DerivedRoleResolver::new(tenant2_roles, cache2);

    // Verify tenant 1 permissions
    let tenant1_user_perms = resolver1.resolve_role_permissions("tenant1_user").await?;
    assert!(tenant1_user_perms.contains("tenant1:read"));
    assert!(tenant1_user_perms.contains("tenant1:*"));
    assert!(!tenant1_user_perms.contains("tenant2:read"));
    assert!(!tenant1_user_perms.contains("tenant2:*"));

    // Verify tenant 2 permissions
    let tenant2_user_perms = resolver2.resolve_role_permissions("tenant2_user").await?;
    assert!(tenant2_user_perms.contains("tenant2:read"));
    assert!(tenant2_user_perms.contains("tenant2:*"));
    assert!(!tenant2_user_perms.contains("tenant1:read"));
    assert!(!tenant2_user_perms.contains("tenant1:*"));

    Ok(())
}

#[tokio::test]
async fn test_role_resolution_performance_target() -> CretoResult<()> {
    let roles = create_organizational_hierarchy();
    let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles, cache);

    // Measure single role resolution time
    let start = Instant::now();
    resolver.resolve_role_permissions("intern").await?;
    let duration = start.elapsed();

    // Target: <1ms per resolution (uncached)
    assert!(
        duration < Duration::from_millis(1),
        "Role resolution took {:?}, expected <1ms",
        duration
    );

    println!("Single role resolution (uncached): {:?}", duration);

    // Measure cached resolution time
    let cached_start = Instant::now();
    resolver.resolve_role_permissions("intern").await?;
    let cached_duration = cached_start.elapsed();

    // Cached should be much faster
    assert!(
        cached_duration < Duration::from_micros(100),
        "Cached resolution took {:?}, expected <100μs",
        cached_duration
    );

    println!("Single role resolution (cached): {:?}", cached_duration);

    Ok(())
}

#[tokio::test]
async fn test_cache_hit_rate_verification() -> CretoResult<()> {
    let roles = create_organizational_hierarchy();
    let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles, cache.clone());

    // First pass: populate cache
    for role in &["ceo", "vp_engineering", "director_backend", "manager_api", "intern"] {
        resolver.resolve_role_permissions(role).await?;
    }

    // Get initial cache stats
    let initial_stats = cache.stats();
    let initial_hits = initial_stats.hits;

    // Second pass: should hit cache
    for role in &["ceo", "vp_engineering", "director_backend", "manager_api", "intern"] {
        resolver.resolve_role_permissions(role).await?;
    }

    // Verify cache hits increased
    let final_stats = cache.stats();
    let cache_hits = final_stats.hits - initial_hits;

    assert_eq!(cache_hits, 5, "Expected 5 cache hits, got {}", cache_hits);

    // Calculate hit rate
    let total_requests = final_stats.hits + final_stats.misses;
    let hit_rate = if total_requests > 0 {
        final_stats.hits as f64 / total_requests as f64
    } else {
        0.0
    };

    println!("Cache statistics:");
    println!("  Total requests: {}", total_requests);
    println!("  Cache hits: {}", final_stats.hits);
    println!("  Cache misses: {}", final_stats.misses);
    println!("  Hit rate: {:.2}%", hit_rate * 100.0);

    // Expect >50% hit rate in this test
    assert!(hit_rate > 0.5, "Cache hit rate {:.2}% is too low", hit_rate * 100.0);

    Ok(())
}

#[tokio::test]
async fn test_circular_inheritance_detection() -> CretoResult<()> {
    // Create roles with circular inheritance
    let roles = vec![
        Role {
            id: "role_a".to_string(),
            name: "Role A".to_string(),
            description: Some("Role with circular inheritance".to_string()),
            permissions: vec!["a:read".to_string()].into_iter().collect(),
            inherits_from: vec!["role_b".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "role_b".to_string(),
            name: "Role B".to_string(),
            description: Some("Role with circular inheritance".to_string()),
            permissions: vec!["b:read".to_string()].into_iter().collect(),
            inherits_from: vec!["role_c".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "role_c".to_string(),
            name: "Role C".to_string(),
            description: Some("Role with circular inheritance".to_string()),
            permissions: vec!["c:read".to_string()].into_iter().collect(),
            inherits_from: vec!["role_a".to_string()], // Circular!
            metadata: Default::default(),
        },
    ];

    let cache = Arc::new(RoleResolutionCache::new(100, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles, cache);

    // Should detect circular inheritance and return error
    let result = resolver.resolve_role_permissions("role_a").await;
    assert!(result.is_err(), "Expected error for circular inheritance");

    Ok(())
}

#[tokio::test]
async fn test_deep_hierarchy_performance() -> CretoResult<()> {
    // Create a deep hierarchy (20 levels)
    let mut roles = Vec::new();
    for i in 0..20 {
        roles.push(Role {
            id: format!("level_{}", i),
            name: format!("Level {}", i),
            description: Some(format!("Role at level {}", i)),
            permissions: vec![format!("level_{}:read", i)].into_iter().collect(),
            inherits_from: if i > 0 {
                vec![format!("level_{}", i - 1)]
            } else {
                vec![]
            },
            metadata: Default::default(),
        });
    }

    let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles, cache);

    // Measure time to resolve deepest role
    let start = Instant::now();
    let permissions = resolver.resolve_role_permissions("level_19").await?;
    let duration = start.elapsed();

    // Verify all permissions inherited
    assert_eq!(permissions.len(), 20, "Expected 20 inherited permissions");

    // Performance target: <1ms even for deep hierarchies
    assert!(
        duration < Duration::from_millis(1),
        "Deep hierarchy resolution took {:?}, expected <1ms",
        duration
    );

    println!("Deep hierarchy (20 levels) resolution: {:?}", duration);

    Ok(())
}
