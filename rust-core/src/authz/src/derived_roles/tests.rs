//! Comprehensive tests for derived roles system
//!
//! This module contains integration tests that verify the complete derived roles
//! functionality including pattern matching, dependency resolution, caching, and
//! edge cases.

use super::graph::{DependencyGraphBuilder, GraphError};
use super::resolver::RoleResolver;
use super::types::DerivedRole;
use std::collections::HashMap;

// ============================================================================
// Pattern Matching Tests
// ============================================================================

#[test]
fn test_exact_pattern_match() {
    let role = DerivedRole::new("manager", vec!["employee".to_string()]);

    assert!(role.matches(&["employee".to_string()]));
    assert!(!role.matches(&["contractor".to_string()]));
}

#[test]
fn test_universal_wildcard() {
    let role = DerivedRole::new("super_user", vec!["*".to_string()]);

    assert!(role.matches(&["anything".to_string()]));
    assert!(role.matches(&["admin".to_string()]));
    assert!(role.matches(&["user:read".to_string()]));
}

#[test]
fn test_prefix_wildcard() {
    let role = DerivedRole::new("admin_user", vec!["admin:*".to_string()]);

    assert!(role.matches(&["admin:read".to_string()]));
    assert!(role.matches(&["admin:write".to_string()]));
    assert!(role.matches(&["admin:delete".to_string()]));
    assert!(!role.matches(&["user:read".to_string()]));
    assert!(!role.matches(&["admin".to_string()])); // No colon
}

#[test]
fn test_suffix_wildcard() {
    let role = DerivedRole::new("viewer", vec!["*:view".to_string()]);

    assert!(role.matches(&["document:view".to_string()]));
    assert!(role.matches(&["project:view".to_string()]));
    assert!(!role.matches(&["document:edit".to_string()]));
    assert!(!role.matches(&["view".to_string()])); // No colon
}

#[test]
fn test_multiple_patterns() {
    let role = DerivedRole::new(
        "power_user",
        vec!["admin:*".to_string(), "*:write".to_string()],
    );

    // Must have BOTH patterns
    assert!(role.matches(&[
        "admin:read".to_string(),
        "document:write".to_string(),
    ]));

    // Missing one pattern
    assert!(!role.matches(&["admin:read".to_string()]));
    assert!(!role.matches(&["document:write".to_string()]));
}

// ============================================================================
// Dependency Graph Tests
// ============================================================================

#[test]
fn test_simple_dependency_chain() {
    let mut builder = DependencyGraphBuilder::new();

    let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
    let role2 = DerivedRole::new("senior_manager", vec!["manager".to_string()]);

    builder.add_role(role1).unwrap();
    builder.add_role(role2).unwrap();

    let graph = builder.build().unwrap();
    let order = graph.resolve_order().unwrap();

    // manager must come before senior_manager
    let manager_idx = order.iter().position(|r| r == "manager").unwrap();
    let senior_idx = order.iter().position(|r| r == "senior_manager").unwrap();
    assert!(manager_idx < senior_idx);
}

#[test]
fn test_diamond_dependency() {
    // Base: employee, contributor
    // Derived: manager (employee), developer (contributor)
    // Derived: tech_lead (manager + developer)
    let mut builder = DependencyGraphBuilder::new();

    builder.add_role(DerivedRole::new("manager", vec!["employee".to_string()])).unwrap();
    builder.add_role(DerivedRole::new("developer", vec!["contributor".to_string()])).unwrap();
    builder.add_role(DerivedRole::new(
        "tech_lead",
        vec!["manager".to_string(), "developer".to_string()],
    )).unwrap();

    let graph = builder.build().unwrap();
    let order = graph.resolve_order().unwrap();

    let manager_idx = order.iter().position(|r| r == "manager").unwrap();
    let developer_idx = order.iter().position(|r| r == "developer").unwrap();
    let tech_lead_idx = order.iter().position(|r| r == "tech_lead").unwrap();

    assert!(manager_idx < tech_lead_idx);
    assert!(developer_idx < tech_lead_idx);
}

#[test]
fn test_direct_cycle_detection() {
    // A -> B -> A
    let mut builder = DependencyGraphBuilder::new();

    builder.add_role(DerivedRole::new("role_a", vec!["role_b".to_string()])).unwrap();
    builder.add_role(DerivedRole::new("role_b", vec!["role_a".to_string()])).unwrap();

    let result = builder.build();
    assert!(matches!(result, Err(GraphError::CircularDependency(_))));
}

#[test]
fn test_indirect_cycle_detection() {
    // A -> B -> C -> A
    let mut builder = DependencyGraphBuilder::new();

    builder.add_role(DerivedRole::new("role_a", vec!["role_b".to_string()])).unwrap();
    builder.add_role(DerivedRole::new("role_b", vec!["role_c".to_string()])).unwrap();
    builder.add_role(DerivedRole::new("role_c", vec!["role_a".to_string()])).unwrap();

    let result = builder.build();
    assert!(matches!(result, Err(GraphError::CircularDependency(_))));
}

#[test]
fn test_self_reference_prevention() {
    let role = DerivedRole::new("manager", vec!["manager".to_string()]);
    let result = role.validate();

    assert!(result.is_err());
}

// ============================================================================
// Role Resolver Tests
// ============================================================================

#[tokio::test]
async fn test_resolver_basic_resolution() {
    let mut resolver = RoleResolver::new();

    let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
    resolver.add_derived_role(manager).unwrap();

    let principal_roles = vec!["employee".to_string()];
    let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

    assert_eq!(resolved.len(), 2);
    assert!(resolved.contains(&"employee".to_string()));
    assert!(resolved.contains(&"manager".to_string()));
}

#[tokio::test]
async fn test_resolver_deep_chain() {
    let mut resolver = RoleResolver::new();

    // employee -> manager -> senior_manager -> director
    resolver.add_derived_roles(vec![
        DerivedRole::new("manager", vec!["employee".to_string()]),
        DerivedRole::new("senior_manager", vec!["manager".to_string()]),
        DerivedRole::new("director", vec!["senior_manager".to_string()]),
    ]).unwrap();

    let principal_roles = vec!["employee".to_string()];
    let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

    assert_eq!(resolved.len(), 4);
    assert!(resolved.contains(&"employee".to_string()));
    assert!(resolved.contains(&"manager".to_string()));
    assert!(resolved.contains(&"senior_manager".to_string()));
    assert!(resolved.contains(&"director".to_string()));
}

#[tokio::test]
async fn test_resolver_multiple_base_roles() {
    let mut resolver = RoleResolver::new();

    // tech_lead requires BOTH manager AND developer
    let tech_lead = DerivedRole::new(
        "tech_lead",
        vec!["manager".to_string(), "developer".to_string()],
    );
    resolver.add_derived_role(tech_lead).unwrap();

    // Only manager - no tech_lead
    let resolved1 = resolver.resolve_roles(
        &vec!["manager".to_string()],
        &HashMap::new(),
    ).await.unwrap();
    assert!(!resolved1.contains(&"tech_lead".to_string()));

    // Both roles - gets tech_lead
    let resolved2 = resolver.resolve_roles(
        &vec!["manager".to_string(), "developer".to_string()],
        &HashMap::new(),
    ).await.unwrap();
    assert!(resolved2.contains(&"tech_lead".to_string()));
}

#[tokio::test]
async fn test_resolver_wildcard_matching() {
    let mut resolver = RoleResolver::new();

    // Create derived roles with wildcards
    resolver.add_derived_roles(vec![
        DerivedRole::new("admin_user", vec!["admin:*".to_string()]),
        DerivedRole::new("viewer", vec!["*:view".to_string()]),
        DerivedRole::new("super_admin", vec!["admin_user".to_string(), "viewer".to_string()]),
    ]).unwrap();

    let principal_roles = vec![
        "admin:write".to_string(),
        "document:view".to_string(),
    ];

    let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

    assert!(resolved.contains(&"admin_user".to_string()));
    assert!(resolved.contains(&"viewer".to_string()));
    assert!(resolved.contains(&"super_admin".to_string()));
}

#[tokio::test]
async fn test_resolver_caching() {
    let resolver = RoleResolver::new();

    let principal_roles = vec!["employee".to_string()];
    let context = HashMap::new();

    // First call - populates cache
    let _result1 = resolver.resolve_roles(&principal_roles, &context).await.unwrap();
    assert_eq!(resolver.cache_stats().size, 1);

    // Second call - uses cache
    let _result2 = resolver.resolve_roles(&principal_roles, &context).await.unwrap();
    assert_eq!(resolver.cache_stats().size, 1);

    // Different roles - new cache entry
    let _result3 = resolver.resolve_roles(&vec!["admin".to_string()], &context).await.unwrap();
    assert_eq!(resolver.cache_stats().size, 2);
}

#[tokio::test]
async fn test_resolver_cache_invalidation_on_add() {
    let mut resolver = RoleResolver::new();

    // Resolve with empty derived roles
    let _result1 = resolver.resolve_roles(
        &vec!["employee".to_string()],
        &HashMap::new(),
    ).await.unwrap();
    assert_eq!(resolver.cache_stats().size, 1);

    // Add a derived role - should invalidate cache
    let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
    resolver.add_derived_role(manager).unwrap();

    assert_eq!(resolver.cache_stats().size, 0);
}

#[tokio::test]
async fn test_resolver_concurrent_access() {
    use std::sync::Arc;
    use tokio::task;

    let resolver = Arc::new(RoleResolver::new());
    let principal_roles = vec!["employee".to_string()];

    // Spawn multiple concurrent resolution tasks
    let mut handles = vec![];

    for _ in 0..10 {
        let resolver_clone = Arc::clone(&resolver);
        let roles = principal_roles.clone();

        let handle = task::spawn(async move {
            resolver_clone.resolve_roles(&roles, &HashMap::new()).await.unwrap()
        });

        handles.push(handle);
    }

    // Wait for all tasks
    for handle in handles {
        let _result = handle.await.unwrap();
    }

    // Cache should have 1 entry (all same key)
    assert_eq!(resolver.cache_stats().size, 1);
}

// ============================================================================
// Edge Cases and Validation Tests
// ============================================================================

#[test]
fn test_empty_role_name() {
    let role = DerivedRole::new("", vec!["employee".to_string()]);
    assert!(role.validate().is_err());
}

#[test]
fn test_empty_parent_roles() {
    let role = DerivedRole::new("manager", vec![]);
    assert!(role.validate().is_err());
}

#[test]
fn test_empty_parent_role_string() {
    let role = DerivedRole::new("manager", vec!["".to_string()]);
    assert!(role.validate().is_err());
}

#[test]
fn test_no_matching_roles() {
    let role = DerivedRole::new("manager", vec!["employee".to_string()]);

    assert!(!role.matches(&["contractor".to_string()]));
    assert!(!role.matches(&[]));
}

#[tokio::test]
async fn test_resolver_empty_principal_roles() {
    let resolver = RoleResolver::new();

    let resolved = resolver.resolve_roles(&vec![], &HashMap::new()).await.unwrap();
    assert_eq!(resolved.len(), 0);
}

#[tokio::test]
async fn test_resolver_no_derived_roles() {
    let resolver = RoleResolver::new();

    let principal_roles = vec!["employee".to_string(), "developer".to_string()];
    let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

    // Should just return the principal roles
    assert_eq!(resolved, principal_roles);
}

// ============================================================================
// Complex Scenarios
// ============================================================================

#[tokio::test]
async fn test_complex_organizational_hierarchy() {
    let mut resolver = RoleResolver::new();

    // Organizational hierarchy:
    // - employee
    //   - developer (employee)
    //     - senior_developer (developer)
    //       - tech_lead (senior_developer + team_member)
    //   - manager (employee)
    //     - senior_manager (manager)
    //       - director (senior_manager)
    // - team_member
    //   - team_lead (team_member + developer)

    resolver.add_derived_roles(vec![
        DerivedRole::new("developer", vec!["employee".to_string()]),
        DerivedRole::new("senior_developer", vec!["developer".to_string()]),
        DerivedRole::new("manager", vec!["employee".to_string()]),
        DerivedRole::new("senior_manager", vec!["manager".to_string()]),
        DerivedRole::new("director", vec!["senior_manager".to_string()]),
        DerivedRole::new("team_lead", vec!["team_member".to_string(), "developer".to_string()]),
        DerivedRole::new("tech_lead", vec!["senior_developer".to_string(), "team_member".to_string()]),
    ]).unwrap();

    // Employee who is also a team member
    let resolved = resolver.resolve_roles(
        &vec!["employee".to_string(), "team_member".to_string()],
        &HashMap::new(),
    ).await.unwrap();

    assert!(resolved.contains(&"employee".to_string()));
    assert!(resolved.contains(&"developer".to_string()));
    assert!(resolved.contains(&"senior_developer".to_string()));
    assert!(resolved.contains(&"team_member".to_string()));
    assert!(resolved.contains(&"team_lead".to_string()));
    assert!(resolved.contains(&"tech_lead".to_string()));
}

#[tokio::test]
async fn test_partial_wildcard_matching() {
    let mut resolver = RoleResolver::new();

    // Create roles with different wildcard patterns
    resolver.add_derived_roles(vec![
        DerivedRole::new("admin", vec!["admin:*".to_string()]),
        DerivedRole::new("viewer", vec!["*:view".to_string()]),
        DerivedRole::new("power_user", vec!["admin".to_string(), "viewer".to_string()]),
    ]).unwrap();

    // Has admin:read but not any :view role
    let resolved1 = resolver.resolve_roles(
        &vec!["admin:read".to_string()],
        &HashMap::new(),
    ).await.unwrap();

    assert!(resolved1.contains(&"admin".to_string()));
    assert!(!resolved1.contains(&"viewer".to_string()));
    assert!(!resolved1.contains(&"power_user".to_string()));

    // Has both patterns
    let resolved2 = resolver.resolve_roles(
        &vec!["admin:read".to_string(), "document:view".to_string()],
        &HashMap::new(),
    ).await.unwrap();

    assert!(resolved2.contains(&"admin".to_string()));
    assert!(resolved2.contains(&"viewer".to_string()));
    assert!(resolved2.contains(&"power_user".to_string()));
}

#[test]
fn test_duplicate_role_detection() {
    let mut builder = DependencyGraphBuilder::new();

    let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
    let role2 = DerivedRole::new("manager", vec!["contributor".to_string()]);

    builder.add_role(role1).unwrap();
    let result = builder.add_role(role2);

    assert!(matches!(result, Err(GraphError::DuplicateRole(_))));
}

#[tokio::test]
async fn test_cache_key_consistency() {
    let resolver = RoleResolver::new();

    // Same roles, different order - should use same cache key
    let roles1 = vec!["employee".to_string(), "developer".to_string()];
    let roles2 = vec!["developer".to_string(), "employee".to_string()];

    let _result1 = resolver.resolve_roles(&roles1, &HashMap::new()).await.unwrap();
    let _result2 = resolver.resolve_roles(&roles2, &HashMap::new()).await.unwrap();

    // Should only have 1 cache entry (same sorted key)
    assert_eq!(resolver.cache_stats().size, 1);
}
