//! Integration tests for scope resolver with real-world scenarios

#[cfg(test)]
mod integration_tests {
    use authz::{ScopeConfig, ScopeResolver};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::task::JoinSet;

    #[tokio::test]
    async fn test_multi_tenant_scope_isolation() {
        let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));

        // Tenant A policies
        let chain_a = resolver.build_scope_chain("tenant.acme.dept.engineering").unwrap();
        assert!(resolver.match_scope("tenant.acme.**", "tenant.acme.dept.engineering"));
        assert!(!resolver.match_scope("tenant.beta.**", "tenant.acme.dept.engineering"));

        // Tenant B policies
        let chain_b = resolver.build_scope_chain("tenant.beta.dept.sales").unwrap();
        assert!(resolver.match_scope("tenant.beta.**", "tenant.beta.dept.sales"));
        assert!(!resolver.match_scope("tenant.acme.**", "tenant.beta.dept.sales"));

        assert_ne!(chain_a[0], chain_b[0]);
    }

    #[tokio::test]
    async fn test_concurrent_scope_operations() {
        let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));
        let mut set = JoinSet::new();

        // Spawn 100 concurrent operations
        for i in 0..100 {
            let resolver = Arc::clone(&resolver);
            set.spawn(async move {
                let scope = format!("org.dept{}.team{}", i % 10, i % 5);

                // Build chain
                let chain = resolver.build_scope_chain(&scope);
                assert!(chain.is_ok());

                // Match patterns
                let matches = resolver.match_scope(&format!("org.dept{}.**", i % 10), &scope);
                assert!(matches);

                // Validate
                let valid = resolver.validate_scope(&scope);
                assert!(valid.is_ok());
            });
        }

        let mut completed = 0;
        while let Some(result) = set.join_next().await {
            assert!(result.is_ok());
            completed += 1;
        }

        assert_eq!(completed, 100);

        // Verify cache statistics
        let stats = resolver.get_stats();
        assert!(stats.size > 0);
        assert!(stats.hit_count > 0);
    }

    #[tokio::test]
    async fn test_hierarchical_policy_matching() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        // Test hierarchical matching at different levels
        let test_cases = vec![
            ("org.**", "org.acme.dept.engineering", true),
            ("org.acme.**", "org.acme.dept.engineering", true),
            ("org.acme.dept.**", "org.acme.dept.engineering", true),
            ("org.acme.*", "org.acme.dept", true),
            ("org.acme.*", "org.acme.dept.engineering", false), // * only matches one segment
            ("org.*.dept", "org.acme.dept", true),
            ("org.*.dept", "org.beta.dept", true),
            ("**.engineering", "org.acme.dept.engineering", true),
            ("**.engineering", "engineering", true),
        ];

        for (pattern, scope, expected) in test_cases {
            let result = resolver.match_scope(pattern, scope);
            assert_eq!(
                result, expected,
                "Pattern {} against scope {} expected {}",
                pattern, scope, expected
            );
        }
    }

    #[tokio::test]
    async fn test_cache_performance_under_load() {
        let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));

        // Build a set of scopes to exercise cache
        let scopes: Vec<String> = (0..10)
            .map(|i| format!("org.dept{}.team.project", i))
            .collect();

        // First pass - populate cache
        for scope in &scopes {
            resolver.build_scope_chain(scope).unwrap();
        }

        let stats1 = resolver.get_stats();
        assert_eq!(stats1.miss_count, 10);

        // Second pass - should all be cache hits
        for scope in &scopes {
            resolver.build_scope_chain(scope).unwrap();
        }

        let stats2 = resolver.get_stats();
        assert_eq!(stats2.hit_count, 10);
        assert_eq!(stats2.miss_count, 10);
        assert!((stats2.hit_rate - 0.5).abs() < 0.01); // 50% hit rate
    }

    #[tokio::test]
    async fn test_cache_ttl_behavior() {
        let mut config = ScopeConfig::default();
        config.cache_ttl = Duration::from_millis(100);
        let resolver = ScopeResolver::new(config);

        let scope = "org.acme.dept";

        // First build
        resolver.build_scope_chain(scope).unwrap();
        let stats1 = resolver.get_stats();
        assert_eq!(stats1.miss_count, 1);

        // Immediate second build (cache hit)
        resolver.build_scope_chain(scope).unwrap();
        let stats2 = resolver.get_stats();
        assert_eq!(stats2.hit_count, 1);

        // Wait for TTL expiration
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Third build after expiration (cache miss)
        resolver.build_scope_chain(scope).unwrap();
        let stats3 = resolver.get_stats();
        assert_eq!(stats3.miss_count, 2);
    }

    #[tokio::test]
    async fn test_scope_validation_rules() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        // Valid scopes
        let valid_scopes = vec![
            "org",
            "org-name",
            "org_name",
            "Org123",
            "org.dept.team",
            "a-b_c.d-e_f",
        ];

        for scope in valid_scopes {
            assert!(
                resolver.validate_scope(scope).is_ok(),
                "Expected {} to be valid",
                scope
            );
        }

        // Invalid scopes
        let invalid_scopes = vec![
            "org..dept",       // Empty segment
            "org.dept.",       // Trailing dot
            ".org.dept",       // Leading dot
            "org@dept",        // Invalid character
            "org dept",        // Space
            "org.dept.team.project.sub1.sub2.sub3.sub4.sub5.sub6.sub7", // Exceeds max depth
        ];

        for scope in invalid_scopes {
            assert!(
                resolver.validate_scope(scope).is_err(),
                "Expected {} to be invalid",
                scope
            );
        }
    }

    #[tokio::test]
    async fn test_custom_config_enforcement() {
        let mut config = ScopeConfig::default();
        config.max_depth = 3;
        config.allow_wildcards = false;
        let resolver = ScopeResolver::new(config);

        // Depth enforcement
        assert!(resolver.build_scope_chain("a.b.c").is_ok());
        assert!(resolver.build_scope_chain("a.b.c.d").is_err());

        // Wildcard enforcement
        assert!(!resolver.match_scope("org.*", "org.acme"));
        assert!(resolver.match_scope("org.acme", "org.acme")); // Exact match still works
    }

    #[tokio::test]
    async fn test_scope_chain_correctness() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        let test_cases = vec![
            ("org", vec!["org"]),
            ("org.acme", vec!["org.acme", "org"]),
            (
                "org.acme.dept",
                vec!["org.acme.dept", "org.acme", "org"],
            ),
            (
                "org.acme.dept.eng",
                vec!["org.acme.dept.eng", "org.acme.dept", "org.acme", "org"],
            ),
        ];

        for (scope, expected) in test_cases {
            let chain = resolver.build_scope_chain(scope).unwrap();
            assert_eq!(
                chain, expected,
                "Scope chain for {} did not match expected",
                scope
            );
        }
    }

    #[tokio::test]
    async fn test_performance_target_scope_matching() {
        let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));

        let start = std::time::Instant::now();

        // Perform 10,000 scope matching operations
        for i in 0..10_000 {
            let scope = format!("org.dept{}.team{}.project{}", i % 10, i % 5, i % 3);
            let pattern = format!("org.dept{}.**", i % 10);

            let matches = resolver.match_scope(&pattern, &scope);
            assert!(matches);
        }

        let duration = start.elapsed();
        let avg_per_match = duration / 10_000;

        println!("Average match time: {:?}", avg_per_match);

        // Target: <100μs per match
        assert!(avg_per_match.as_micros() < 100);
    }

    #[tokio::test]
    #[ignore]
    async fn test_postgres_scope_storage() {
        // Integration test for PostgreSQL storage (requires database)
        // Run with: cargo test --features postgres -- --ignored

        // TODO: Implement when PostgreSQL integration is added
        // 1. Store scope patterns in database
        // 2. Retrieve and validate
        // 3. Verify matching behavior
    }
}
