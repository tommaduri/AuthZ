//! Integration tests for scope module

use super::*;
use regex::Regex;
use std::sync::Arc;
use std::thread;

#[test]
fn test_complex_wildcard_patterns() {
    let resolver = ScopeResolver::new(ScopeConfig::default());

    // Multiple wildcards
    assert!(resolver.match_scope("*.corp.*", "acme.corp.engineering"));
    assert!(!resolver.match_scope("*.corp.*", "acme.corp"));

    // Mixed wildcards
    assert!(resolver.match_scope("org.**.dev", "org.acme.dept.dev"));
    assert!(resolver.match_scope("org.**.dev", "org.dev"));

    // Double wildcard at start
    assert!(resolver.match_scope("**.engineering", "org.acme.dept.engineering"));

    // Double wildcard matches empty
    assert!(resolver.match_scope("org.**.engineering", "org.engineering"));
}

#[test]
fn test_scope_hierarchy() {
    let scope = Scope::new("org.acme.dept.engineering").unwrap();

    let mut current = Some(scope);
    let mut hierarchy = Vec::new();

    while let Some(s) = current {
        hierarchy.push(s.as_str().to_string());
        current = s.parent();
    }

    assert_eq!(
        hierarchy,
        vec![
            "org.acme.dept.engineering",
            "org.acme.dept",
            "org.acme",
            "org",
            ""
        ]
    );
}

#[test]
fn test_concurrent_access() {
    let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));
    let scopes = vec![
        "org.acme",
        "org.acme.dept",
        "org.beta",
        "org.beta.sales",
    ];

    let mut handles = vec![];

    for i in 0..10 {
        let resolver_clone = Arc::clone(&resolver);
        let scope = scopes[i % scopes.len()].to_string();

        let handle = thread::spawn(move || {
            // Build chain
            let chain = resolver_clone.build_scope_chain(&scope).unwrap();
            assert!(!chain.is_empty());

            // Match patterns
            assert!(resolver_clone.match_scope("org.*", &scope) || scope.split('.').count() > 2);

            // Validate
            resolver_clone.validate_scope(&scope).unwrap();
        });

        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    let stats = resolver.get_stats();
    assert!(stats.size > 0);
}

#[test]
fn test_without_wildcards() {
    let mut config = ScopeConfig::default();
    config.allow_wildcards = false;
    let resolver = ScopeResolver::new(config);

    assert!(resolver.match_scope("org.acme", "org.acme"));
    assert!(!resolver.match_scope("org.*", "org.acme"));
}

#[test]
fn test_custom_allowed_chars() {
    let mut config = ScopeConfig::default();
    config.allowed_chars_regex = Regex::new(r"^[a-z]+$").unwrap();
    let resolver = ScopeResolver::new(config);

    assert!(resolver.validate_scope("org.acme").is_ok());
    assert!(resolver.validate_scope("Org.Acme").is_err());
    assert!(resolver.validate_scope("org123").is_err());
}

#[test]
fn test_deep_scope_chain() {
    let resolver = ScopeResolver::new(ScopeConfig::default());

    let segments: Vec<&str> = vec!["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    let scope = segments.join(".");

    let chain = resolver.build_scope_chain(&scope).unwrap();
    assert_eq!(chain.len(), 10);

    let expected: Vec<String> = (1..=10)
        .rev()
        .map(|i| segments[..i].join("."))
        .collect();

    assert_eq!(chain, expected);
}

#[test]
fn test_cache_hit_rate() {
    let resolver = ScopeResolver::new(ScopeConfig::default());
    let scope = "org.acme";

    // First call - miss
    resolver.build_scope_chain(scope).unwrap();

    // Next 9 calls - hits
    for _ in 0..9 {
        resolver.build_scope_chain(scope).unwrap();
    }

    let stats = resolver.get_stats();
    assert_eq!(stats.hit_count, 9);
    assert_eq!(stats.miss_count, 1);
    assert!((stats.hit_rate - 0.9).abs() < 0.01);
}

#[test]
fn test_scope_prefix() {
    let parent = Scope::new("org.acme").unwrap();
    let child = Scope::new("org.acme.dept").unwrap();
    let sibling = Scope::new("org.beta").unwrap();

    assert!(parent.is_prefix_of(&child));
    assert!(!child.is_prefix_of(&parent));
    assert!(!parent.is_prefix_of(&sibling));
}

#[test]
fn test_error_handling() {
    let resolver = ScopeResolver::new(ScopeConfig::default());

    // Empty segment
    match resolver.build_scope_chain("org..dept") {
        Err(ScopeError::EmptySegment) => {}
        _ => panic!("Expected EmptySegment error"),
    }

    // Depth exceeded
    let mut config = ScopeConfig::default();
    config.max_depth = 2;
    let resolver = ScopeResolver::new(config);

    match resolver.build_scope_chain("a.b.c") {
        Err(ScopeError::DepthExceeded { .. }) => {}
        _ => panic!("Expected DepthExceeded error"),
    }
}
