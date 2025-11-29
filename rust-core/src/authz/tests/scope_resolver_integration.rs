//! Integration tests for scope resolver functionality
//!
//! Tests multi-level hierarchies, parallel scope matching, cache performance,
//! TTL expiration, and performance targets.

use cretoai_authz::scope::{ScopeResolver, ScopeCache, ScopePattern, ResourcePath};
use cretoai_core::types::CretoResult;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::task::JoinSet;
use tokio::time::sleep;

/// Create multi-level organizational scope hierarchy
fn create_scope_hierarchy() -> Vec<(ScopePattern, ResourcePath)> {
    vec![
        // Top level: organization
        (
            ScopePattern::new("org:*"),
            ResourcePath::new("/org/acme"),
        ),
        // Division level
        (
            ScopePattern::new("org:acme/division:*"),
            ResourcePath::new("/org/acme/division/engineering"),
        ),
        (
            ScopePattern::new("org:acme/division:*"),
            ResourcePath::new("/org/acme/division/sales"),
        ),
        // Department level
        (
            ScopePattern::new("org:acme/division:engineering/dept:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering/dept:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/frontend"),
        ),
        // Team level
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend/team:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend/team:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/database"),
        ),
        // Project level
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend/team:api/project:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend/team:api/project:*"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/payments"),
        ),
    ]
}

#[tokio::test]
async fn test_multi_level_hierarchy_matching() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = ScopeResolver::new(scopes, cache);

    // Test top-level wildcard matches everything
    let org_matches = resolver
        .match_scope(&ScopePattern::new("org:*"), &ResourcePath::new("/org/acme/division/engineering/dept/backend"))
        .await?;
    assert!(org_matches, "Top-level wildcard should match");

    // Test division-level matching
    let division_matches = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:engineering"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend"),
        )
        .await?;
    assert!(division_matches, "Division scope should match");

    // Test department-level matching
    let dept_matches = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:engineering/dept:backend"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api"),
        )
        .await?;
    assert!(dept_matches, "Department scope should match");

    // Test team-level matching
    let team_matches = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:engineering/dept:backend/team:api"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth"),
        )
        .await?;
    assert!(team_matches, "Team scope should match");

    // Test project-level exact matching
    let project_matches = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:engineering/dept:backend/team:api/project:auth"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth"),
        )
        .await?;
    assert!(project_matches, "Project scope should match exactly");

    // Test non-matching scope
    let no_match = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:sales"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend"),
        )
        .await?;
    assert!(!no_match, "Different division should not match");

    Ok(())
}

#[tokio::test]
async fn test_100_parallel_scope_matches() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = Arc::new(ScopeResolver::new(scopes, cache));

    let mut join_set = JoinSet::new();
    let start = Instant::now();

    // Spawn 100 concurrent scope matching tasks
    for i in 0..100 {
        let resolver = resolver.clone();
        let scope_pattern = match i % 5 {
            0 => ScopePattern::new("org:*"),
            1 => ScopePattern::new("org:acme/division:engineering"),
            2 => ScopePattern::new("org:acme/division:engineering/dept:backend"),
            3 => ScopePattern::new("org:acme/division:engineering/dept:backend/team:api"),
            _ => ScopePattern::new("org:acme/division:engineering/dept:backend/team:api/project:auth"),
        };

        let resource_path = ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth");

        join_set.spawn(async move {
            resolver.match_scope(&scope_pattern, &resource_path).await
        });
    }

    // Wait for all tasks to complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        let matches = result.unwrap()?;
        results.push(matches);
    }

    let duration = start.elapsed();

    // Verify all tasks completed successfully
    assert_eq!(results.len(), 100);

    // All should match (hierarchical matching)
    let match_count = results.iter().filter(|&&m| m).count();
    assert_eq!(match_count, 100, "All scopes should match hierarchically");

    // Performance validation: <100ms total for 100 parallel operations
    assert!(
        duration < Duration::from_millis(100),
        "100 parallel scope matches took {:?}, expected <100ms",
        duration
    );

    println!("100 parallel scope matches: {:?}", duration);
    println!("Average per match: {:?}", duration / 100);

    Ok(())
}

#[tokio::test]
async fn test_cache_performance() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = ScopeResolver::new(scopes, cache.clone());

    let scope = ScopePattern::new("org:acme/division:engineering/dept:backend");
    let resource = ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api");

    // First match: cache miss
    let miss_start = Instant::now();
    resolver.match_scope(&scope, &resource).await?;
    let miss_duration = miss_start.elapsed();

    // Second match: cache hit
    let hit_start = Instant::now();
    resolver.match_scope(&scope, &resource).await?;
    let hit_duration = hit_start.elapsed();

    println!("Cache miss: {:?}", miss_duration);
    println!("Cache hit: {:?}", hit_duration);
    println!("Speedup: {:.2}x", miss_duration.as_nanos() as f64 / hit_duration.as_nanos() as f64);

    // Cache hit should be significantly faster
    assert!(
        hit_duration < miss_duration / 2,
        "Cache hit should be at least 2x faster than miss"
    );

    // Get cache statistics
    let stats = cache.stats();
    assert_eq!(stats.hits, 1, "Expected 1 cache hit");
    assert_eq!(stats.misses, 1, "Expected 1 cache miss");

    Ok(())
}

#[tokio::test]
async fn test_ttl_expiration() -> CretoResult<()> {
    // Create cache with very short TTL for testing
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(100, Duration::from_millis(100)));
    let resolver = ScopeResolver::new(scopes, cache.clone());

    let scope = ScopePattern::new("org:acme/division:engineering");
    let resource = ResourcePath::new("/org/acme/division/engineering/dept/backend");

    // First match: populate cache
    resolver.match_scope(&scope, &resource).await?;

    let initial_stats = cache.stats();
    assert_eq!(initial_stats.misses, 1);

    // Second match: should hit cache
    resolver.match_scope(&scope, &resource).await?;

    let cached_stats = cache.stats();
    assert_eq!(cached_stats.hits, 1);

    // Wait for TTL to expire
    sleep(Duration::from_millis(150)).await;

    // Third match: cache should be expired, new miss
    resolver.match_scope(&scope, &resource).await?;

    let expired_stats = cache.stats();
    assert_eq!(expired_stats.misses, 2, "Expected cache miss after TTL expiration");

    println!("TTL expiration test passed");
    println!("Initial misses: {}", initial_stats.misses);
    println!("Cache hits: {}", cached_stats.hits);
    println!("Post-expiration misses: {}", expired_stats.misses);

    Ok(())
}

#[tokio::test]
async fn test_scope_matching_performance_target() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = ScopeResolver::new(scopes, cache);

    let scope = ScopePattern::new("org:acme/division:engineering/dept:backend/team:api");
    let resource = ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth");

    // Measure single scope match time (uncached)
    let start = Instant::now();
    resolver.match_scope(&scope, &resource).await?;
    let duration = start.elapsed();

    // Target: <100μs per match
    assert!(
        duration < Duration::from_micros(100),
        "Scope match took {:?}, expected <100μs",
        duration
    );

    println!("Single scope match (uncached): {:?}", duration);

    // Measure cached match time
    let cached_start = Instant::now();
    resolver.match_scope(&scope, &resource).await?;
    let cached_duration = cached_start.elapsed();

    // Cached should be even faster
    assert!(
        cached_duration < Duration::from_micros(50),
        "Cached scope match took {:?}, expected <50μs",
        cached_duration
    );

    println!("Single scope match (cached): {:?}", cached_duration);

    Ok(())
}

#[tokio::test]
async fn test_wildcard_pattern_matching() -> CretoResult<()> {
    let scopes = vec![
        (
            ScopePattern::new("org:*/division:*"),
            ResourcePath::new("/org/any/division/any"),
        ),
        (
            ScopePattern::new("org:acme/division:*/dept:*"),
            ResourcePath::new("/org/acme/division/any/dept/any"),
        ),
    ];

    let cache = Arc::new(ScopeCache::new(100, Duration::from_secs(300)));
    let resolver = ScopeResolver::new(scopes, cache);

    // Test single-level wildcard
    let single_wildcard = resolver
        .match_scope(
            &ScopePattern::new("org:*/division:engineering"),
            &ResourcePath::new("/org/acme/division/engineering"),
        )
        .await?;
    assert!(single_wildcard, "Single-level wildcard should match");

    // Test multi-level wildcard
    let multi_wildcard = resolver
        .match_scope(
            &ScopePattern::new("org:acme/division:*/dept:backend"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend"),
        )
        .await?;
    assert!(multi_wildcard, "Multi-level wildcard should match");

    // Test catch-all wildcard
    let catch_all = resolver
        .match_scope(
            &ScopePattern::new("org:*"),
            &ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api"),
        )
        .await?;
    assert!(catch_all, "Catch-all wildcard should match");

    Ok(())
}

#[tokio::test]
async fn test_scope_resolution_with_caching_benchmark() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = ScopeResolver::new(scopes, cache.clone());

    let test_cases = vec![
        (
            ScopePattern::new("org:*"),
            ResourcePath::new("/org/acme/division/engineering"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api"),
        ),
        (
            ScopePattern::new("org:acme/division:engineering/dept:backend/team:api"),
            ResourcePath::new("/org/acme/division/engineering/dept/backend/team/api/project/auth"),
        ),
    ];

    // First pass: populate cache
    let first_pass_start = Instant::now();
    for (scope, resource) in &test_cases {
        resolver.match_scope(scope, resource).await?;
    }
    let first_pass_duration = first_pass_start.elapsed();

    // Second pass: all cache hits
    let second_pass_start = Instant::now();
    for (scope, resource) in &test_cases {
        resolver.match_scope(scope, resource).await?;
    }
    let second_pass_duration = second_pass_start.elapsed();

    println!("First pass (cache misses): {:?}", first_pass_duration);
    println!("Second pass (cache hits): {:?}", second_pass_duration);
    println!("Speedup: {:.2}x", first_pass_duration.as_nanos() as f64 / second_pass_duration.as_nanos() as f64);

    let stats = cache.stats();
    println!("Cache statistics:");
    println!("  Hits: {}", stats.hits);
    println!("  Misses: {}", stats.misses);
    println!("  Hit rate: {:.2}%", stats.hits as f64 / (stats.hits + stats.misses) as f64 * 100.0);

    // Verify cache effectiveness
    assert_eq!(stats.misses, test_cases.len(), "Expected {} cache misses", test_cases.len());
    assert_eq!(stats.hits, test_cases.len(), "Expected {} cache hits", test_cases.len());

    Ok(())
}

#[tokio::test]
async fn test_concurrent_cache_access() -> CretoResult<()> {
    let scopes = create_scope_hierarchy();
    let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
    let resolver = Arc::new(ScopeResolver::new(scopes, cache.clone()));

    let scope = ScopePattern::new("org:acme/division:engineering");
    let resource = ResourcePath::new("/org/acme/division/engineering/dept/backend");

    // First, populate cache
    resolver.match_scope(&scope, &resource).await?;

    // Now spawn many concurrent readers
    let mut join_set = JoinSet::new();
    for _ in 0..50 {
        let resolver = resolver.clone();
        let scope = scope.clone();
        let resource = resource.clone();

        join_set.spawn(async move {
            resolver.match_scope(&scope, &resource).await
        });
    }

    // All should complete successfully
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        results.push(result.unwrap()?);
    }

    assert_eq!(results.len(), 50);
    assert!(results.iter().all(|&r| r), "All concurrent matches should succeed");

    // Verify cache handled concurrent access correctly
    let stats = cache.stats();
    assert!(stats.hits >= 50, "Expected at least 50 cache hits, got {}", stats.hits);

    Ok(())
}
