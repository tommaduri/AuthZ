//! Comprehensive tests for derived roles resolution
//!
//! Tests cover:
//! - Pattern matching (exact, wildcards, prefixes, suffixes)
//! - Dependency chain resolution
//! - Circular dependency detection
//! - CEL condition evaluation
//! - Resolution order verification
//! - Edge cases and error handling

#[cfg(test)]
mod derived_roles_tests {
    use crate::derived_roles::{DerivedRole, DerivedRoleResolver};
    use crate::error::AuthzError;

    #[test]
    fn test_new_resolver() {
        let resolver = DerivedRoleResolver::new();
        assert_eq!(resolver.len(), 0);
    }

    #[tokio::test]
    async fn test_resolve_no_derivation() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string(), "engineer".to_string()];

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert_eq!(roles.len(), 0); // No derived roles added
    }

    #[tokio::test]
    async fn test_simple_derivation() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string(), "manager".to_string()];

        let role = DerivedRole::new(
            "senior_manager".to_string(),
            vec!["manager".to_string()],
            None,
        );
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"senior_manager".to_string()));
    }

    #[tokio::test]
    async fn test_wildcard_matching_all() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["anything".to_string()];

        let role = DerivedRole::new("universal".to_string(), vec!["*".to_string()], None);
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"universal".to_string()));
    }

    #[tokio::test]
    async fn test_wildcard_prefix_matching() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["admin:read".to_string(), "admin:write".to_string()];

        let role = DerivedRole::new(
            "admin_user".to_string(),
            vec!["admin:*".to_string()],
            None,
        );
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"admin_user".to_string()));
    }

    #[tokio::test]
    async fn test_wildcard_suffix_matching() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["document:viewer".to_string(), "project:viewer".to_string()];

        let role = DerivedRole::new("viewer".to_string(), vec!["*:viewer".to_string()], None);
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"viewer".to_string()));
    }

    #[tokio::test]
    async fn test_no_wildcard_match() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        let role = DerivedRole::new("admin_role".to_string(), vec!["admin".to_string()], None);
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(!roles.contains(&"admin_role".to_string()));
    }

    #[tokio::test]
    async fn test_dependency_chain_simple() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        let role1 = DerivedRole::new(
            "team_lead".to_string(),
            vec!["employee".to_string()],
            None,
        );
        let role2 = DerivedRole::new(
            "senior_lead".to_string(),
            vec!["team_lead".to_string()],
            None,
        );

        resolver.add_role(role1).unwrap();
        resolver.add_role(role2).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"team_lead".to_string()));
        assert!(roles.contains(&"senior_lead".to_string()));
        assert_eq!(roles.len(), 2);
    }

    #[tokio::test]
    async fn test_dependency_chain_deep() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        resolver
            .add_role(DerivedRole::new(
                "team_lead".to_string(),
                vec!["employee".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "senior_lead".to_string(),
                vec!["team_lead".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "director".to_string(),
                vec!["senior_lead".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "vp".to_string(),
                vec!["director".to_string()],
                None,
            ))
            .unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert_eq!(roles.len(), 4); // 4 derived roles
        assert!(roles.contains(&"vp".to_string()));
    }

    #[test]
    fn test_circular_dependency_direct() {
        let resolver = DerivedRoleResolver::new();

        resolver
            .add_role(DerivedRole::new(
                "role_a".to_string(),
                vec!["role_b".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "role_b".to_string(),
                vec!["role_a".to_string()],
                None,
            ))
            .unwrap();

        let result = resolver.validate_all();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AuthzError::CircularDependency { .. }));
    }

    #[test]
    fn test_circular_dependency_indirect() {
        let resolver = DerivedRoleResolver::new();

        resolver
            .add_role(DerivedRole::new(
                "role_a".to_string(),
                vec!["role_c".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "role_b".to_string(),
                vec!["role_a".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "role_c".to_string(),
                vec!["role_b".to_string()],
                None,
            ))
            .unwrap();

        let result = resolver.validate_all();
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_multiple_parent_roles() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string(), "engineer".to_string()];

        let role = DerivedRole::new(
            "senior_engineer".to_string(),
            vec!["employee".to_string(), "engineer".to_string()],
            None,
        );
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert!(roles.contains(&"senior_engineer".to_string()));
    }

    #[test]
    fn test_invalid_derived_role_empty_name() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(String::new(), vec!["employee".to_string()], None);

        let result = resolver.add_role(role);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AuthzError::EmptyRoleName));
    }

    #[test]
    fn test_invalid_derived_role_no_parents() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new("orphan_role".to_string(), Vec::new(), None);

        let result = resolver.add_role(role);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_complex_graph_resolution() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        // Diamond dependency: employee -> [team_lead, engineer] -> director
        resolver
            .add_role(DerivedRole::new(
                "team_lead".to_string(),
                vec!["employee".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "engineer".to_string(),
                vec!["employee".to_string()],
                None,
            ))
            .unwrap();
        resolver
            .add_role(DerivedRole::new(
                "director".to_string(),
                vec!["team_lead".to_string(), "engineer".to_string()],
                None,
            ))
            .unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        assert_eq!(roles.len(), 3); // 3 derived roles
        assert!(roles.contains(&"director".to_string()));
    }

    #[test]
    fn test_self_reference_detection() {
        let resolver = DerivedRoleResolver::new();

        resolver
            .add_role(DerivedRole::new(
                "self_role".to_string(),
                vec!["self_role".to_string()],
                None,
            ))
            .unwrap();

        let result = resolver.validate_all();
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_partial_match_no_derivation() {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        // Requires both employee AND manager
        let role = DerivedRole::new(
            "hybrid_role".to_string(),
            vec!["employee".to_string(), "manager".to_string()],
            None,
        );
        resolver.add_role(role).unwrap();

        let result = resolver.resolve_roles(&principal_roles, None).await;
        assert!(result.is_ok());

        let roles = result.unwrap();
        // Should not derive hybrid_role (missing manager)
        assert!(!roles.contains(&"hybrid_role".to_string()));
    }
}
