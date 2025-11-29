//! Wildcard pattern matching for role names
//!
//! Supports three pattern types:
//! 1. Exact match: `"admin"` matches `"admin"`
//! 2. Universal wildcard: `"*"` matches any role
//! 3. Prefix wildcard: `"admin:*"` matches `"admin:read"`, `"admin:write"`
//! 4. Suffix wildcard: `"*:viewer"` matches `"document:viewer"`, `"project:viewer"`

/// Checks if a role matches a wildcard pattern
///
/// # Pattern Types
///
/// - **Exact match**: `"admin"` matches `"admin"`
/// - **Universal wildcard**: `"*"` matches any role
/// - **Prefix wildcard**: `"admin:*"` matches `"admin:read"`, `"admin:write"`
/// - **Suffix wildcard**: `"*:viewer"` matches `"document:viewer"`, `"project:viewer"`
///
/// # Arguments
///
/// * `role` - The role to match
/// * `pattern` - The pattern to match against
///
/// # Returns
///
/// `true` if the role matches the pattern, `false` otherwise
///
/// # Examples
///
/// ```rust
/// use authz::derived_roles::matches_pattern;
///
/// // Exact match
/// assert!(matches_pattern("admin", "admin"));
///
/// // Universal wildcard
/// assert!(matches_pattern("any_role", "*"));
///
/// // Prefix wildcard
/// assert!(matches_pattern("admin:read", "admin:*"));
/// assert!(matches_pattern("admin:write", "admin:*"));
/// assert!(!matches_pattern("user:read", "admin:*"));
///
/// // Suffix wildcard
/// assert!(matches_pattern("document:viewer", "*:viewer"));
/// assert!(matches_pattern("project:viewer", "*:viewer"));
/// assert!(!matches_pattern("document:editor", "*:viewer"));
/// ```
pub fn matches_pattern(role: &str, pattern: &str) -> bool {
    // Exact match
    if role == pattern {
        return true;
    }

    // Universal wildcard
    if pattern == "*" {
        return true;
    }

    // Prefix wildcard: "prefix:*"
    if let Some(prefix) = pattern.strip_suffix(":*") {
        return role.starts_with(&format!("{}:", prefix));
    }

    // Suffix wildcard: "*:suffix"
    if let Some(suffix) = pattern.strip_prefix("*:") {
        return role.ends_with(&format!(":{}", suffix));
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(matches_pattern("admin", "admin"));
        assert!(matches_pattern("user", "user"));
        assert!(matches_pattern("manager:finance", "manager:finance"));
    }

    #[test]
    fn test_exact_no_match() {
        assert!(!matches_pattern("admin", "user"));
        assert!(!matches_pattern("manager:finance", "manager:hr"));
    }

    #[test]
    fn test_universal_wildcard() {
        assert!(matches_pattern("admin", "*"));
        assert!(matches_pattern("user", "*"));
        assert!(matches_pattern("manager:finance", "*"));
        assert!(matches_pattern("", "*"));
    }

    #[test]
    fn test_prefix_wildcard_match() {
        assert!(matches_pattern("admin:read", "admin:*"));
        assert!(matches_pattern("admin:write", "admin:*"));
        assert!(matches_pattern("admin:delete", "admin:*"));
        assert!(matches_pattern("manager:finance:view", "manager:*"));
    }

    #[test]
    fn test_prefix_wildcard_no_match() {
        assert!(!matches_pattern("user:read", "admin:*"));
        assert!(!matches_pattern("admin", "admin:*")); // Missing colon
        assert!(!matches_pattern("adminread", "admin:*")); // Missing colon
    }

    #[test]
    fn test_suffix_wildcard_match() {
        assert!(matches_pattern("document:viewer", "*:viewer"));
        assert!(matches_pattern("project:viewer", "*:viewer"));
        assert!(matches_pattern("system:admin:viewer", "*:viewer"));
    }

    #[test]
    fn test_suffix_wildcard_no_match() {
        assert!(!matches_pattern("document:editor", "*:viewer"));
        assert!(!matches_pattern("viewer", "*:viewer")); // Missing colon
        assert!(!matches_pattern("viewerdocument", "*:viewer")); // Missing colon
    }

    #[test]
    fn test_edge_cases() {
        // Empty strings
        assert!(matches_pattern("", ""));
        assert!(matches_pattern("", "*"));
        assert!(!matches_pattern("", "admin"));
        assert!(!matches_pattern("admin", ""));

        // Single character
        assert!(matches_pattern("a", "a"));
        assert!(matches_pattern("a", "*"));
        assert!(!matches_pattern("a", "b"));

        // Colon only
        assert!(matches_pattern(":", ":"));
        assert!(matches_pattern(":", "*"));
    }

    #[test]
    fn test_multiple_colons() {
        assert!(matches_pattern("org:dept:team:viewer", "*:viewer"));
        assert!(matches_pattern("org:dept:team:read", "org:*"));
        assert!(matches_pattern("org:dept:team:read", "org:dept:*"));
    }

    #[test]
    fn test_pattern_itself_contains_colon() {
        assert!(matches_pattern("admin:read", "admin:read"));
        assert!(!matches_pattern("admin:read", "admin:write"));
    }

    #[test]
    fn test_case_sensitivity() {
        // Pattern matching is case-sensitive
        assert!(!matches_pattern("Admin", "admin"));
        assert!(!matches_pattern("ADMIN:READ", "admin:*"));
        assert!(!matches_pattern("document:Viewer", "*:viewer"));
    }
}
