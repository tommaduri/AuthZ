/// Scope type definitions and validation
///
/// Provides the core Scope type with hierarchical representation
/// and pattern matching capabilities.

use std::fmt;
use std::str::FromStr;

/// Result type for scope operations
pub type ScopeResult<T> = Result<T, ScopeError>;

/// Errors that can occur during scope operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeError {
    /// Empty scope string provided
    EmptyScope,
    /// Invalid scope format
    InvalidFormat(String),
    /// Invalid wildcard usage
    InvalidWildcard(String),
    /// Scope segment is empty
    EmptySegment,
    /// Pattern matching failed
    PatternError(String),
}

impl fmt::Display for ScopeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyScope => write!(f, "Scope cannot be empty"),
            Self::InvalidFormat(msg) => write!(f, "Invalid scope format: {}", msg),
            Self::InvalidWildcard(msg) => write!(f, "Invalid wildcard usage: {}", msg),
            Self::EmptySegment => write!(f, "Scope segment cannot be empty"),
            Self::PatternError(msg) => write!(f, "Pattern matching error: {}", msg),
        }
    }
}

impl std::error::Error for ScopeError {}

/// Represents a hierarchical scope with pattern matching capabilities
///
/// A scope is a colon-separated string representing a hierarchy:
/// - `org:acme:dept:engineering`
/// - `org:acme:*` (single wildcard - matches one segment)
/// - `org:**` (double wildcard - matches zero or more segments)
///
/// # Examples
///
/// ```
/// use authz::scope::Scope;
///
/// let scope = Scope::from_str("org:acme:dept:engineering").unwrap();
/// assert_eq!(scope.segments().len(), 4);
/// assert!(scope.matches("org:acme:*").unwrap());
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Scope {
    /// Original scope string
    raw: String,
    /// Parsed segments
    segments: Vec<String>,
    /// Whether this scope contains wildcards
    has_wildcards: bool,
}

impl Scope {
    /// Creates a new scope from a string slice
    ///
    /// # Arguments
    ///
    /// * `s` - The scope string (e.g., "org:acme:dept")
    ///
    /// # Returns
    ///
    /// Returns a `ScopeResult<Self>` containing the parsed scope or an error
    pub fn new(s: &str) -> ScopeResult<Self> {
        if s.is_empty() {
            return Err(ScopeError::EmptyScope);
        }

        let segments: Vec<String> = s.split(':').map(|s| s.to_string()).collect();

        // Validate segments
        for (idx, segment) in segments.iter().enumerate() {
            if segment.is_empty() {
                return Err(ScopeError::EmptySegment);
            }

            // Check for invalid wildcard patterns
            if segment.contains('*') && segment != "*" && segment != "**" {
                return Err(ScopeError::InvalidWildcard(
                    format!("Wildcards must be standalone: '{}'", segment)
                ));
            }

            // Double wildcard can only appear at the end
            if segment == "**" && idx < segments.len() - 1 {
                return Err(ScopeError::InvalidWildcard(
                    "Double wildcard '**' can only appear at the end".to_string()
                ));
            }
        }

        let has_wildcards = segments.iter().any(|s| s == "*" || s == "**");

        Ok(Self {
            raw: s.to_string(),
            segments,
            has_wildcards,
        })
    }

    /// Returns the segments of this scope
    pub fn segments(&self) -> &[String] {
        &self.segments
    }

    /// Returns the raw scope string
    pub fn as_str(&self) -> &str {
        &self.raw
    }

    /// Returns whether this scope contains wildcards
    pub fn has_wildcards(&self) -> bool {
        self.has_wildcards
    }

    /// Checks if this scope matches a given pattern
    ///
    /// Supports:
    /// - Exact matching: `org:acme` matches `org:acme`
    /// - Single wildcard: `org:*` matches `org:acme`
    /// - Double wildcard: `org:**` matches `org:acme:dept:engineering`
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to match against
    ///
    /// # Returns
    ///
    /// Returns `true` if the scope matches the pattern
    pub fn matches(&self, pattern: &str) -> ScopeResult<bool> {
        let pattern_scope = Scope::new(pattern)?;
        self.matches_scope(&pattern_scope)
    }

    /// Checks if this scope matches another scope
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern scope to match against
    ///
    /// # Returns
    ///
    /// Returns `true` if the scope matches the pattern
    pub fn matches_scope(&self, pattern: &Scope) -> ScopeResult<bool> {
        let self_segments = &self.segments;
        let pattern_segments = &pattern.segments;

        // Handle double wildcard at the end
        if let Some(last) = pattern_segments.last() {
            if last == "**" {
                return Ok(self.matches_prefix(&pattern_segments[..pattern_segments.len() - 1]));
            }
        }

        // Check length match for non-** patterns
        if self_segments.len() != pattern_segments.len() {
            return Ok(false);
        }

        // Match each segment
        for (self_seg, pattern_seg) in self_segments.iter().zip(pattern_segments.iter()) {
            if pattern_seg == "*" {
                // Single wildcard matches any single segment
                continue;
            } else if self_seg != pattern_seg {
                // Exact match required
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Checks if this scope matches a prefix pattern
    ///
    /// Used internally for handling patterns that end with wildcards
    fn matches_prefix(&self, prefix: &[String]) -> bool {
        if prefix.len() > self.segments.len() {
            return false;
        }

        for (self_seg, pattern_seg) in self.segments.iter().zip(prefix.iter()) {
            if pattern_seg == "*" {
                continue;
            } else if self_seg != pattern_seg {
                return false;
            }
        }

        true
    }

    /// Returns the parent scope if it exists
    ///
    /// # Examples
    ///
    /// ```
    /// use authz::scope::Scope;
    ///
    /// let scope = Scope::from_str("org:acme:dept").unwrap();
    /// let parent = scope.parent().unwrap();
    /// assert_eq!(parent.as_str(), "org:acme");
    /// ```
    pub fn parent(&self) -> Option<Self> {
        if self.segments.len() <= 1 {
            return None;
        }

        let parent_segments = &self.segments[..self.segments.len() - 1];
        let parent_str = parent_segments.join(":");

        Self::new(&parent_str).ok()
    }

    /// Returns the depth of this scope (number of segments)
    pub fn depth(&self) -> usize {
        self.segments.len()
    }

    /// Checks if this scope is a parent of another scope
    ///
    /// # Arguments
    ///
    /// * `other` - The potential child scope
    ///
    /// # Returns
    ///
    /// Returns `true` if this scope is a parent of the other scope
    pub fn is_parent_of(&self, other: &Scope) -> bool {
        if self.segments.len() >= other.segments.len() {
            return false;
        }

        for (self_seg, other_seg) in self.segments.iter().zip(other.segments.iter()) {
            if self_seg != other_seg {
                return false;
            }
        }

        true
    }

    /// Checks if this scope is a child of another scope
    pub fn is_child_of(&self, other: &Scope) -> bool {
        other.is_parent_of(self)
    }
}

impl FromStr for Scope {
    type Err = ScopeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scope_creation() {
        let scope = Scope::new("org:acme:dept").unwrap();
        assert_eq!(scope.segments().len(), 3);
        assert_eq!(scope.as_str(), "org:acme:dept");
        assert!(!scope.has_wildcards());
    }

    #[test]
    fn test_scope_with_wildcards() {
        let scope = Scope::new("org:*:dept").unwrap();
        assert!(scope.has_wildcards());

        let scope = Scope::new("org:**").unwrap();
        assert!(scope.has_wildcards());
    }

    #[test]
    fn test_empty_scope() {
        let result = Scope::new("");
        assert!(matches!(result, Err(ScopeError::EmptyScope)));
    }

    #[test]
    fn test_empty_segment() {
        let result = Scope::new("org::dept");
        assert!(matches!(result, Err(ScopeError::EmptySegment)));
    }

    #[test]
    fn test_invalid_wildcard() {
        let result = Scope::new("org:acme*");
        assert!(matches!(result, Err(ScopeError::InvalidWildcard(_))));
    }

    #[test]
    fn test_double_wildcard_position() {
        let result = Scope::new("org:**:dept");
        assert!(matches!(result, Err(ScopeError::InvalidWildcard(_))));

        let result = Scope::new("org:**");
        assert!(result.is_ok());
    }

    #[test]
    fn test_exact_matching() {
        let scope = Scope::new("org:acme:dept").unwrap();
        assert!(scope.matches("org:acme:dept").unwrap());
        assert!(!scope.matches("org:acme:other").unwrap());
    }

    #[test]
    fn test_single_wildcard_matching() {
        let scope = Scope::new("org:acme:dept").unwrap();
        assert!(scope.matches("org:acme:*").unwrap());
        assert!(scope.matches("org:*:dept").unwrap());
        assert!(scope.matches("*:acme:dept").unwrap());
        assert!(!scope.matches("org:*:*:*").unwrap());
    }

    #[test]
    fn test_double_wildcard_matching() {
        let scope = Scope::new("org:acme:dept:engineering").unwrap();
        assert!(scope.matches("org:**").unwrap());
        assert!(scope.matches("org:acme:**").unwrap());
        assert!(scope.matches("org:acme:dept:**").unwrap());
        assert!(!scope.matches("other:**").unwrap());
    }

    #[test]
    fn test_parent() {
        let scope = Scope::new("org:acme:dept").unwrap();
        let parent = scope.parent().unwrap();
        assert_eq!(parent.as_str(), "org:acme");

        let parent2 = parent.parent().unwrap();
        assert_eq!(parent2.as_str(), "org");

        assert!(parent2.parent().is_none());
    }

    #[test]
    fn test_depth() {
        let scope = Scope::new("org:acme:dept:engineering").unwrap();
        assert_eq!(scope.depth(), 4);
    }

    #[test]
    fn test_parent_child_relationships() {
        let parent = Scope::new("org:acme").unwrap();
        let child = Scope::new("org:acme:dept").unwrap();

        assert!(parent.is_parent_of(&child));
        assert!(child.is_child_of(&parent));
        assert!(!child.is_parent_of(&parent));
    }
}
