/// Comprehensive test suite for scope module
///
/// Tests cover:
/// - Exact matching
/// - Hierarchical matching
/// - Wildcard patterns
/// - Cache functionality
/// - Concurrent access
/// - Edge cases

use super::*;
use std::sync::Arc;
use std::thread;
use std::str::FromStr;

// ============================================================================
// Scope Type Tests
// ============================================================================

#[test]
fn test_scope_parsing() {
    let scope = Scope::from_str("org:acme:dept:engineering").unwrap();
    assert_eq!(scope.segments().len(), 4);
    assert_eq!(scope.depth(), 4);
    assert_eq!(scope.as_str(), "org:acme:dept:engineering");
}

#[test]
fn test_scope_validation_errors() {
    // Empty scope
    assert!(matches!(
        Scope::new(""),
        Err(ScopeError::EmptyScope)
    ));

    // Empty segment
    assert!(matches!(
        Scope::new("org::dept"),
        Err(ScopeError::EmptySegment)
    ));

    // Invalid wildcard position
    assert!(matches!(
        Scope::new("org:acme*"),
        Err(ScopeError::InvalidWildcard(_))
    ));

    // Double wildcard not at end
    assert!(matches!(
        Scope::new("org:**:dept"),
        Err(ScopeError::InvalidWildcard(_))
    ));
}

#[test]
fn test_scope_display() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert_eq!(format!("{}", scope), "org:acme:dept");
}

// ============================================================================
// Exact Matching Tests
// ============================================================================

#[test]
fn test_exact_match_identical() {
    let scope = Scope::new("org:acme:dept:engineering").unwrap();
    assert!(scope.matches("org:acme:dept:engineering").unwrap());
}

#[test]
fn test_exact_match_different() {
    let scope = Scope::new("org:acme:dept:engineering").unwrap();
    assert!(!scope.matches("org:acme:dept:sales").unwrap());
}

#[test]
fn test_exact_match_different_length() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(!scope.matches("org:acme:dept:engineering").unwrap());
    assert!(!scope.matches("org:acme").unwrap());
}

// ============================================================================
// Single Wildcard Tests
// ============================================================================

#[test]
fn test_single_wildcard_end() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(scope.matches("org:acme:*").unwrap());
}

#[test]
fn test_single_wildcard_middle() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(scope.matches("org:*:dept").unwrap());
}

#[test]
fn test_single_wildcard_start() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(scope.matches("*:acme:dept").unwrap());
}

#[test]
fn test_single_wildcard_multiple() {
    let scope = Scope::new("org:acme:dept:engineering").unwrap();
    assert!(scope.matches("org:*:*:engineering").unwrap());
    assert!(scope.matches("*:*:dept:engineering").unwrap());
}

#[test]
fn test_single_wildcard_wrong_length() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(!scope.matches("org:*").unwrap());
    assert!(!scope.matches("org:*:*:*").unwrap());
}

// ============================================================================
// Double Wildcard Tests
// ============================================================================

#[test]
fn test_double_wildcard_matches_rest() {
    let scope = Scope::new("org:acme:dept:engineering:team1").unwrap();
    assert!(scope.matches("org:**").unwrap());
    assert!(scope.matches("org:acme:**").unwrap());
    assert!(scope.matches("org:acme:dept:**").unwrap());
}

#[test]
fn test_double_wildcard_no_match_different_prefix() {
    let scope = Scope::new("org:acme:dept").unwrap();
    assert!(!scope.matches("other:**").unwrap());
    assert!(!scope.matches("org:different:**").unwrap());
}

#[test]
fn test_double_wildcard_with_single_wildcard() {
    let scope = Scope::new("org:acme:dept:engineering").unwrap();
    assert!(scope.matches("org:*:**").unwrap());
    assert!(scope.matches("*:acme:**").unwrap());
}

// ============================================================================
// Hierarchical Tests
// ============================================================================

#[test]
fn test_parent_child_relationships() {
    let parent = Scope::new("org:acme").unwrap();
    let child = Scope::new("org:acme:dept").unwrap();
    let grandchild = Scope::new("org:acme:dept:engineering").unwrap();

    assert!(parent.is_parent_of(&child));
    assert!(parent.is_parent_of(&grandchild));
    assert!(child.is_parent_of(&grandchild));

    assert!(child.is_child_of(&parent));
    assert!(grandchild.is_child_of(&parent));
    assert!(grandchild.is_child_of(&child));

    assert!(!child.is_parent_of(&parent));
    assert!(!parent.is_child_of(&child));
}

#[test]
fn test_parent_method() {
    let scope = Scope::new("org:acme:dept:engineering").unwrap();

    let parent1 = scope.parent().unwrap();
    assert_eq!(parent1.as_str(), "org:acme:dept");

    let parent2 = parent1.parent().unwrap();
    assert_eq!(parent2.as_str(), "org:acme");

    let parent3 = parent2.parent().unwrap();
    assert_eq!(parent3.as_str(), "org");

    assert!(parent3.parent().is_none());
}

#[test]
fn test_scope_depth() {
    assert_eq!(Scope::new("org").unwrap().depth(), 1);
    assert_eq!(Scope::new("org:acme").unwrap().depth(), 2);
    assert_eq!(Scope::new("org:acme:dept").unwrap().depth(), 3);
}

// ============================================================================
// ScopeResolver Tests
// ============================================================================

#[test]
fn test_build_chain() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept:engineering").unwrap();

    let chain = resolver.build_chain(&scope);
    assert_eq!(chain.len(), 4);
    assert_eq!(chain[0].as_str(), "org");
    assert_eq!(chain[1].as_str(), "org:acme");
    assert_eq!(chain[2].as_str(), "org:acme:dept");
    assert_eq!(chain[3].as_str(), "org:acme:dept:engineering");
}

#[test]
fn test_build_chain_single_segment() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org").unwrap();

    let chain = resolver.build_chain(&scope);
    assert_eq!(chain.len(), 1);
    assert_eq!(chain[0].as_str(), "org");
}

#[test]
fn test_resolver_pattern_matching() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept:engineering").unwrap();

    assert!(resolver.matches_pattern(&scope, "org:acme:dept:engineering").unwrap());
    assert!(resolver.matches_pattern(&scope, "org:acme:dept:*").unwrap());
    assert!(resolver.matches_pattern(&scope, "org:acme:*:engineering").unwrap());
    assert!(resolver.matches_pattern(&scope, "org:**").unwrap());
    assert!(!resolver.matches_pattern(&scope, "other:**").unwrap());
}

// ============================================================================
// Cache Tests
// ============================================================================

#[test]
fn test_chain_caching() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    // First call - should be a cache miss
    let chain1 = resolver.build_chain(&scope);
    let stats_after_first = resolver.stats();
    assert_eq!(stats_after_first.misses, 1);
    assert_eq!(stats_after_first.hits, 0);

    // Second call - should be a cache hit
    let chain2 = resolver.build_chain(&scope);
    let stats_after_second = resolver.stats();
    assert_eq!(stats_after_second.misses, 1);
    assert_eq!(stats_after_second.hits, 1);

    assert_eq!(chain1, chain2);
}

#[test]
fn test_pattern_caching() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    // First call - should be a cache miss
    let result1 = resolver.matches_pattern(&scope, "org:acme:*").unwrap();
    let stats_after_first = resolver.stats();
    assert_eq!(stats_after_first.misses, 1);

    // Second call - should be a cache hit
    let result2 = resolver.matches_pattern(&scope, "org:acme:*").unwrap();
    let stats_after_second = resolver.stats();
    assert_eq!(stats_after_second.hits, 1);

    assert_eq!(result1, result2);
}

#[test]
fn test_cache_stats() {
    let resolver = ScopeResolver::new();
    let scope1 = Scope::new("org:acme:dept").unwrap();
    let scope2 = Scope::new("org:acme:sales").unwrap();

    // Generate cache activity
    resolver.build_chain(&scope1); // miss
    resolver.build_chain(&scope1); // hit
    resolver.build_chain(&scope2); // miss
    resolver.matches_pattern(&scope1, "org:acme:*").unwrap(); // miss
    resolver.matches_pattern(&scope1, "org:acme:*").unwrap(); // hit

    let stats = resolver.stats();
    assert_eq!(stats.misses, 3);
    assert_eq!(stats.hits, 2);
    assert_eq!(stats.entries, 3); // 2 chains + 1 pattern

    let hit_rate = stats.hit_rate();
    assert!((hit_rate - 0.4).abs() < 0.01); // 2/5 = 0.4
}

#[test]
fn test_cache_clear() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    resolver.build_chain(&scope);
    resolver.matches_pattern(&scope, "org:acme:*").unwrap();

    assert!(resolver.chain_cache_size() > 0);
    assert!(resolver.pattern_cache_size() > 0);

    resolver.clear_cache();

    assert_eq!(resolver.chain_cache_size(), 0);
    assert_eq!(resolver.pattern_cache_size(), 0);
}

#[test]
fn test_cache_expiration() {
    use std::time::Duration;

    let resolver = ScopeResolver::with_ttl(Duration::from_millis(50));
    let scope = Scope::new("org:acme:dept").unwrap();

    // Add entry to cache
    resolver.build_chain(&scope);
    assert_eq!(resolver.chain_cache_size(), 1);

    // Wait for expiration
    thread::sleep(Duration::from_millis(100));

    // Access should detect expiration
    resolver.build_chain(&scope);
    let stats = resolver.stats();
    assert!(stats.expirations > 0);

    // Cleanup should remove expired entries
    resolver.cleanup_expired();
}

// ============================================================================
// Bulk Operations Tests
// ============================================================================

#[test]
fn test_matches_any() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    let patterns = vec!["org:acme:*", "org:other:*", "different:**"];
    assert!(resolver.matches_any(&scope, &patterns).unwrap());

    let patterns = vec!["other:*", "different:**"];
    assert!(!resolver.matches_any(&scope, &patterns).unwrap());

    let patterns: Vec<&str> = vec![];
    assert!(!resolver.matches_any(&scope, &patterns).unwrap());
}

#[test]
fn test_matches_all() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    let patterns = vec!["org:*:dept", "org:acme:*", "org:**"];
    assert!(resolver.matches_all(&scope, &patterns).unwrap());

    let patterns = vec!["org:*:dept", "other:*"];
    assert!(!resolver.matches_all(&scope, &patterns).unwrap());

    let patterns: Vec<&str> = vec![];
    assert!(resolver.matches_all(&scope, &patterns).unwrap());
}

#[test]
fn test_filter_matching() {
    let resolver = ScopeResolver::new();
    let scopes = vec![
        Scope::new("org:acme:dept").unwrap(),
        Scope::new("org:acme:sales").unwrap(),
        Scope::new("org:other:dept").unwrap(),
        Scope::new("different:acme:dept").unwrap(),
    ];

    let matching = resolver.filter_matching(&scopes, "org:acme:*").unwrap();
    assert_eq!(matching.len(), 2);

    let matching = resolver.filter_matching(&scopes, "org:**").unwrap();
    assert_eq!(matching.len(), 3);

    let matching = resolver.filter_matching(&scopes, "*:*:dept").unwrap();
    assert_eq!(matching.len(), 3);
}

// ============================================================================
// Concurrent Access Tests
// ============================================================================

#[test]
fn test_concurrent_chain_building() {
    let resolver = Arc::new(ScopeResolver::new());
    let mut handles = vec![];

    for i in 0..10 {
        let resolver = Arc::clone(&resolver);
        let handle = thread::spawn(move || {
            let scope = Scope::new(&format!("org:acme:dept{}", i)).unwrap();
            resolver.build_chain(&scope)
        });
        handles.push(handle);
    }

    for handle in handles {
        let chain = handle.join().unwrap();
        assert_eq!(chain.len(), 3);
    }

    assert_eq!(resolver.chain_cache_size(), 10);
}

#[test]
fn test_concurrent_pattern_matching() {
    let resolver = Arc::new(ScopeResolver::new());
    let mut handles = vec![];

    for i in 0..10 {
        let resolver = Arc::clone(&resolver);
        let handle = thread::spawn(move || {
            let scope = Scope::new(&format!("org:acme:dept{}", i)).unwrap();
            resolver.matches_pattern(&scope, "org:acme:*").unwrap()
        });
        handles.push(handle);
    }

    for handle in handles {
        assert!(handle.join().unwrap());
    }

    assert_eq!(resolver.pattern_cache_size(), 10);
}

#[test]
fn test_concurrent_mixed_operations() {
    let resolver = Arc::new(ScopeResolver::new());
    let mut handles = vec![];

    for i in 0..20 {
        let resolver = Arc::clone(&resolver);
        let handle = thread::spawn(move || {
            let scope = Scope::new(&format!("org:acme:dept{}", i % 5)).unwrap();
            if i % 2 == 0 {
                resolver.build_chain(&scope);
            } else {
                resolver.matches_pattern(&scope, "org:acme:*").unwrap();
            }
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    let stats = resolver.stats();
    // Should have hits due to reuse of scopes (i % 5)
    assert!(stats.hits > 0);
    assert!(stats.misses > 0);
}

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

#[test]
fn test_empty_pattern() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    let result = resolver.matches_pattern(&scope, "");
    assert!(result.is_err());
}

#[test]
fn test_invalid_pattern() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    let result = resolver.matches_pattern(&scope, "org::dept");
    assert!(result.is_err());
}

#[test]
fn test_scope_with_special_characters() {
    // Should handle alphanumeric and some special chars
    let scope = Scope::new("org:acme-corp:dept_1").unwrap();
    assert_eq!(scope.segments().len(), 3);
    assert_eq!(scope.as_str(), "org:acme-corp:dept_1");
}

#[test]
fn test_very_deep_hierarchy() {
    let deep_scope = "a:b:c:d:e:f:g:h:i:j:k:l:m:n:o:p";
    let scope = Scope::new(deep_scope).unwrap();
    assert_eq!(scope.depth(), 16);

    let resolver = ScopeResolver::new();
    let chain = resolver.build_chain(&scope);
    assert_eq!(chain.len(), 16);
}

#[test]
fn test_resolver_custom_ttl() {
    use std::time::Duration;

    let resolver = ScopeResolver::with_ttl(Duration::from_secs(120));
    assert_eq!(resolver.ttl(), Duration::from_secs(120));
}

#[test]
fn test_reset_stats() {
    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept").unwrap();

    resolver.build_chain(&scope);
    resolver.build_chain(&scope);

    let stats_before = resolver.stats();
    assert!(stats_before.hits > 0 || stats_before.misses > 0);

    resolver.reset_stats();

    let stats_after = resolver.stats();
    assert_eq!(stats_after.hits, 0);
    assert_eq!(stats_after.misses, 0);
}
