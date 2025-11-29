//! Scope types and validation

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

/// Errors that can occur during scope operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum ScopeError {
    #[error("scope contains empty segment")]
    EmptySegment,

    #[error("scope depth {depth} exceeds maximum {max_depth}")]
    DepthExceeded { depth: usize, max_depth: usize },

    #[error("invalid scope segment: {segment} (allowed: alphanumeric, underscore, hyphen)")]
    InvalidSegment { segment: String },

    #[error("invalid scope format: {0}")]
    InvalidFormat(String),
}

/// Scope represents a hierarchical authorization scope
///
/// Scopes use dot notation for hierarchy (e.g., "org.acme.dept.engineering")
/// and support wildcards for pattern matching:
/// - `*` matches a single segment
/// - `**` matches zero or more segments
///
/// # Examples
///
/// ```
/// use authz::Scope;
///
/// let scope = Scope::new("org.acme.dept.engineering").unwrap();
/// assert_eq!(scope.as_str(), "org.acme.dept.engineering");
/// assert_eq!(scope.segments().len(), 4);
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Scope {
    raw: String,
    segments: Vec<String>,
}

impl Scope {
    /// Creates a new Scope from a string
    ///
    /// # Arguments
    ///
    /// * `scope` - Dot-separated scope string (e.g., "org.acme.dept")
    ///
    /// # Errors
    ///
    /// Returns `ScopeError` if:
    /// - Scope contains empty segments
    /// - Segments contain invalid characters
    /// - Depth exceeds configured maximum (validated externally)
    pub fn new(scope: impl Into<String>) -> Result<Self, ScopeError> {
        let raw = scope.into();

        if raw.is_empty() {
            return Ok(Self {
                raw: String::new(),
                segments: Vec::new(),
            });
        }

        let segments: Vec<String> = raw.split('.').map(|s| s.to_string()).collect();

        // Validate segments
        for segment in &segments {
            if segment.is_empty() {
                return Err(ScopeError::EmptySegment);
            }
        }

        Ok(Self { raw, segments })
    }

    /// Returns the raw scope string
    pub fn as_str(&self) -> &str {
        &self.raw
    }

    /// Returns the scope segments
    pub fn segments(&self) -> &[String] {
        &self.segments
    }

    /// Returns the depth (number of segments) of the scope
    pub fn depth(&self) -> usize {
        self.segments.len()
    }

    /// Checks if this is an empty (global) scope
    pub fn is_empty(&self) -> bool {
        self.raw.is_empty()
    }

    /// Checks if this scope is a prefix of another scope
    ///
    /// # Examples
    ///
    /// ```
    /// use authz::Scope;
    ///
    /// let parent = Scope::new("org.acme").unwrap();
    /// let child = Scope::new("org.acme.dept").unwrap();
    /// assert!(parent.is_prefix_of(&child));
    /// assert!(!child.is_prefix_of(&parent));
    /// ```
    pub fn is_prefix_of(&self, other: &Scope) -> bool {
        if self.segments.len() > other.segments.len() {
            return false;
        }

        self.segments
            .iter()
            .zip(other.segments.iter())
            .all(|(a, b)| a == b)
    }

    /// Returns the parent scope (one level up in hierarchy)
    ///
    /// # Examples
    ///
    /// ```
    /// use authz::Scope;
    ///
    /// let scope = Scope::new("org.acme.dept").unwrap();
    /// let parent = scope.parent().unwrap();
    /// assert_eq!(parent.as_str(), "org.acme");
    /// ```
    pub fn parent(&self) -> Option<Scope> {
        if self.segments.is_empty() {
            return None;
        }

        let parent_segments = &self.segments[..self.segments.len() - 1];
        if parent_segments.is_empty() {
            return Some(Scope {
                raw: String::new(),
                segments: Vec::new(),
            });
        }

        let raw = parent_segments.join(".");
        Some(Scope {
            raw,
            segments: parent_segments.to_vec(),
        })
    }

    /// Validates a segment according to the default rules
    pub(crate) fn validate_segment(segment: &str, allowed_chars: &Regex) -> Result<(), ScopeError> {
        if segment.is_empty() {
            return Err(ScopeError::EmptySegment);
        }

        if !allowed_chars.is_match(segment) {
            return Err(ScopeError::InvalidSegment {
                segment: segment.to_string(),
            });
        }

        Ok(())
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.raw)
    }
}

impl From<Scope> for String {
    fn from(scope: Scope) -> Self {
        scope.raw
    }
}

impl AsRef<str> for Scope {
    fn as_ref(&self) -> &str {
        &self.raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_scope() {
        let scope = Scope::new("org.acme.dept").unwrap();
        assert_eq!(scope.as_str(), "org.acme.dept");
        assert_eq!(scope.segments(), &["org", "acme", "dept"]);
        assert_eq!(scope.depth(), 3);
    }

    #[test]
    fn test_empty_scope() {
        let scope = Scope::new("").unwrap();
        assert!(scope.is_empty());
        assert_eq!(scope.depth(), 0);
    }

    #[test]
    fn test_invalid_empty_segment() {
        let result = Scope::new("org..dept");
        assert!(matches!(result, Err(ScopeError::EmptySegment)));
    }

    #[test]
    fn test_is_prefix_of() {
        let parent = Scope::new("org.acme").unwrap();
        let child = Scope::new("org.acme.dept").unwrap();
        let other = Scope::new("org.beta").unwrap();

        assert!(parent.is_prefix_of(&child));
        assert!(!child.is_prefix_of(&parent));
        assert!(!parent.is_prefix_of(&other));
    }

    #[test]
    fn test_parent() {
        let scope = Scope::new("org.acme.dept").unwrap();
        let parent = scope.parent().unwrap();
        assert_eq!(parent.as_str(), "org.acme");

        let grandparent = parent.parent().unwrap();
        assert_eq!(grandparent.as_str(), "org");

        let root = grandparent.parent().unwrap();
        assert!(root.is_empty());

        assert!(root.parent().is_none());
    }

    #[test]
    fn test_display() {
        let scope = Scope::new("org.acme.dept").unwrap();
        assert_eq!(format!("{}", scope), "org.acme.dept");
    }
}
