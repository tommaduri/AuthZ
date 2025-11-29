# Scope Module - Usage Guide

## Quick Start

### Building the Project

```bash
cd src/authz
cargo build --release
```

### Running Tests

```bash
# All tests
cargo test

# Only scope tests
cargo test scope

# With output
cargo test -- --nocapture

# Specific test
cargo test test_build_scope_chain
```

### Running Benchmarks

```bash
# All benchmarks
cargo bench

# Only scope benchmarks
cargo bench --bench scope_benchmarks

# Specific benchmark
cargo bench build_scope_chain
```

### Generating Documentation

```bash
# Generate and open docs
cargo doc --no-deps --open

# Just generate
cargo doc --no-deps
```

## Basic Usage

### 1. Creating a Scope

```rust
use authz::Scope;

// Create a scope
let scope = Scope::new("org.acme.dept.engineering")?;

// Access properties
println!("Scope: {}", scope);
println!("Depth: {}", scope.depth());
println!("Segments: {:?}", scope.segments());

// Navigate hierarchy
if let Some(parent) = scope.parent() {
    println!("Parent: {}", parent);
}

// Check relationships
let parent = Scope::new("org.acme")?;
let child = Scope::new("org.acme.dept")?;
assert!(parent.is_prefix_of(&child));
```

### 2. Creating a Resolver

```rust
use authz::{ScopeResolver, ScopeConfig};
use std::time::Duration;

// Use defaults
let resolver = ScopeResolver::new(ScopeConfig::default());

// Or customize
let config = ScopeConfig {
    max_depth: 5,
    allow_wildcards: true,
    cache_ttl: Duration::from_secs(300),
    allowed_chars_regex: regex::Regex::new(r"^[a-z0-9-]+$")?,
    max_cache_size: 50_000,
};
let resolver = ScopeResolver::new(config);
```

### 3. Building Scope Chains

```rust
use authz::ScopeResolver;

let resolver = ScopeResolver::new(Default::default());

// Build chain
let chain = resolver.build_scope_chain("org.acme.dept.engineering")?;
// Returns: ["org.acme.dept.engineering", "org.acme.dept", "org.acme", "org"]

// Empty scope
let chain = resolver.build_scope_chain("")?;
// Returns: []

// Chains are cached automatically
let chain2 = resolver.build_scope_chain("org.acme.dept.engineering")?;
// This is a cache hit
```

### 4. Pattern Matching

```rust
use authz::ScopeResolver;

let resolver = ScopeResolver::new(Default::default());

// Exact match
assert!(resolver.match_scope("org.acme", "org.acme"));

// Single wildcard (*)
assert!(resolver.match_scope("org.*", "org.acme"));
assert!(!resolver.match_scope("org.*", "org.acme.dept"));

// Double wildcard (**)
assert!(resolver.match_scope("org.**", "org.acme.dept.engineering"));
assert!(resolver.match_scope("org.**", "org.acme"));
assert!(resolver.match_scope("org.**", "org"));

// Wildcard in middle
assert!(resolver.match_scope("org.*.dept", "org.acme.dept"));
assert!(resolver.match_scope("org.**.dev", "org.acme.sub.dev"));
```

### 5. Validation

```rust
use authz::ScopeResolver;

let resolver = ScopeResolver::new(Default::default());

// Valid scopes
resolver.validate_scope("org.acme.dept")?;
resolver.validate_scope("")?;  // Empty is valid
resolver.validate_scope("org-name.dept_1")?;

// Invalid scopes
assert!(resolver.validate_scope("org..dept").is_err());  // Empty segment
assert!(resolver.validate_scope("org.a.b.c.d.e.f.g.h.i.j.k").is_err());  // Too deep
```

### 6. Cache Management

```rust
use authz::{ScopeResolver, CacheStats};

let resolver = ScopeResolver::new(Default::default());

// Use the cache
resolver.build_scope_chain("org.acme")?;
resolver.build_scope_chain("org.acme")?;  // Cache hit

// Get statistics
let stats = resolver.get_stats();
println!("Cache size: {}", stats.size);
println!("Hit count: {}", stats.hit_count);
println!("Miss count: {}", stats.miss_count);
println!("Hit rate: {:.2}%", stats.hit_rate * 100.0);

// Clear cache
resolver.clear_cache();
```

## Advanced Usage

### Thread-Safe Sharing

```rust
use authz::ScopeResolver;
use std::sync::Arc;
use std::thread;

let resolver = Arc::new(ScopeResolver::new(Default::default()));

let handles: Vec<_> = (0..4).map(|i| {
    let resolver = Arc::clone(&resolver);
    thread::spawn(move || {
        let scope = format!("org.dept{}", i);
        resolver.build_scope_chain(&scope)
    })
}).collect();

for handle in handles {
    let chain = handle.join().unwrap()?;
    println!("Chain: {:?}", chain);
}
```

### Custom Character Validation

```rust
use authz::ScopeConfig;
use regex::Regex;

let mut config = ScopeConfig::default();

// Only lowercase letters
config.allowed_chars_regex = Regex::new(r"^[a-z]+$")?;

let resolver = ScopeResolver::new(config);

assert!(resolver.validate_scope("org.acme").is_ok());
assert!(resolver.validate_scope("Org.Acme").is_err());
```

### PolicyStore Integration (Example)

```rust
use authz::ScopeResolver;

struct PolicyService {
    resolver: ScopeResolver,
    // ... other fields
}

impl PolicyService {
    pub async fn find_policies_for_scope(&self, scope: &str)
        -> Result<Vec<Policy>, Error>
    {
        // Build scope chain
        let chain = self.resolver.build_scope_chain(scope)?;

        // Query database for policies matching any scope in chain
        let policies = self.db.query(
            "SELECT * FROM policies WHERE scope = ANY($1)",
            &[&chain]
        ).await?;

        Ok(policies)
    }

    pub fn filter_policies_by_pattern(&self,
        policies: &[Policy],
        pattern: &str
    ) -> Vec<&Policy> {
        policies.iter()
            .filter(|p| self.resolver.match_scope(pattern, &p.scope))
            .collect()
    }
}
```

## Performance Tips

### 1. Reuse Resolver Instances

```rust
// ✅ Good: Share one resolver
let resolver = Arc::new(ScopeResolver::new(config));

// ❌ Bad: Create new resolver for each operation
fn process_scope(scope: &str) {
    let resolver = ScopeResolver::new(config);  // Wasteful
    resolver.build_scope_chain(scope).unwrap();
}
```

### 2. Cache Hot Patterns

```rust
// For frequently used patterns, cache the results
let mut pattern_cache = HashMap::new();

fn matches_cached(
    resolver: &ScopeResolver,
    pattern: &str,
    scope: &str,
    cache: &mut HashMap<(String, String), bool>
) -> bool {
    let key = (pattern.to_string(), scope.to_string());
    *cache.entry(key).or_insert_with(|| {
        resolver.match_scope(pattern, scope)
    })
}
```

### 3. Batch Operations

```rust
// Process multiple scopes at once
fn build_chains_batch(
    resolver: &ScopeResolver,
    scopes: &[&str]
) -> Result<Vec<Vec<String>>, Error> {
    scopes.iter()
        .map(|&s| resolver.build_scope_chain(s))
        .collect()
}
```

### 4. Use Exact Matches When Possible

```rust
// ✅ Fast: Exact match (~3 ns)
if resolver.match_scope("org.acme", scope) {
    // ...
}

// ❌ Slow: Unnecessary wildcard (~25 µs)
if resolver.match_scope("org.acme.**", "org.acme") {
    // ...
}
```

## Error Handling

### Handling Validation Errors

```rust
use authz::{ScopeError, Scope};

match Scope::new("org..dept") {
    Ok(scope) => println!("Valid scope: {}", scope),
    Err(ScopeError::EmptySegment) => {
        eprintln!("Scope contains empty segment");
    }
    Err(ScopeError::DepthExceeded { depth, max_depth }) => {
        eprintln!("Scope depth {} exceeds max {}", depth, max_depth);
    }
    Err(ScopeError::InvalidSegment { segment }) => {
        eprintln!("Invalid segment: {}", segment);
    }
    Err(e) => {
        eprintln!("Other error: {}", e);
    }
}
```

### Propagating Errors

```rust
use authz::{ScopeResolver, ScopeError};

fn process_user_scope(scope: &str) -> Result<Vec<String>, ScopeError> {
    let resolver = ScopeResolver::new(Default::default());

    // ? operator propagates errors
    let chain = resolver.build_scope_chain(scope)?;

    Ok(chain)
}
```

## Testing

### Unit Testing with Scopes

```rust
#[cfg(test)]
mod tests {
    use authz::{Scope, ScopeResolver};

    #[test]
    fn test_scope_hierarchy() {
        let scope = Scope::new("org.acme.dept").unwrap();
        assert_eq!(scope.depth(), 3);

        let parent = scope.parent().unwrap();
        assert_eq!(parent.as_str(), "org.acme");
    }

    #[test]
    fn test_pattern_matching() {
        let resolver = ScopeResolver::new(Default::default());

        assert!(resolver.match_scope("org.*", "org.acme"));
        assert!(!resolver.match_scope("org.*", "org.acme.dept"));
    }
}
```

### Integration Testing

```rust
#[cfg(test)]
mod integration_tests {
    use authz::ScopeResolver;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_concurrent_access() {
        let resolver = Arc::new(ScopeResolver::new(Default::default()));

        let handles: Vec<_> = (0..10).map(|i| {
            let resolver = Arc::clone(&resolver);
            thread::spawn(move || {
                let scope = format!("org.dept{}", i);
                resolver.build_scope_chain(&scope).unwrap()
            })
        }).collect();

        for handle in handles {
            let chain = handle.join().unwrap();
            assert!(!chain.is_empty());
        }
    }
}
```

## Common Patterns

### 1. Hierarchical Permission Check

```rust
fn has_permission(
    resolver: &ScopeResolver,
    user_scopes: &[String],
    required_scope: &str
) -> bool {
    // Build required scope chain
    let chain = match resolver.build_scope_chain(required_scope) {
        Ok(chain) => chain,
        Err(_) => return false,
    };

    // Check if any user scope matches the chain
    for user_scope in user_scopes {
        for scope in &chain {
            if resolver.match_scope(user_scope, scope) {
                return true;
            }
        }
    }

    false
}
```

### 2. Multi-Tenant Scope Isolation

```rust
fn filter_by_tenant(
    resolver: &ScopeResolver,
    items: &[Item],
    tenant_id: &str
) -> Vec<&Item> {
    let tenant_pattern = format!("tenant:{}.**", tenant_id);

    items.iter()
        .filter(|item| {
            resolver.match_scope(&tenant_pattern, &item.scope)
        })
        .collect()
}
```

### 3. Scope-Based Resource Discovery

```rust
async fn discover_resources(
    resolver: &ScopeResolver,
    db: &Database,
    scope: &str
) -> Result<Vec<Resource>, Error> {
    // Build scope chain for hierarchical query
    let chain = resolver.build_scope_chain(scope)?;

    // Query resources in scope hierarchy
    let resources = db.query(
        "SELECT * FROM resources WHERE scope = ANY($1)",
        &[&chain]
    ).await?;

    Ok(resources)
}
```

## Configuration Examples

### Development Configuration

```rust
use authz::ScopeConfig;
use std::time::Duration;

let config = ScopeConfig {
    max_depth: 10,
    allow_wildcards: true,
    cache_ttl: Duration::from_secs(60),
    allowed_chars_regex: regex::Regex::new(r"^[a-zA-Z0-9_-]+$")?,
    max_cache_size: 1_000,  // Small cache for dev
};
```

### Production Configuration

```rust
let config = ScopeConfig {
    max_depth: 8,  // Stricter limit
    allow_wildcards: true,
    cache_ttl: Duration::from_secs(300),  // 5 minutes
    allowed_chars_regex: regex::Regex::new(r"^[a-z0-9-]+$")?,  // Lowercase only
    max_cache_size: 100_000,  // Large cache for prod
};
```

### High-Security Configuration

```rust
let config = ScopeConfig {
    max_depth: 5,  // Very strict
    allow_wildcards: false,  // Disable wildcards
    cache_ttl: Duration::from_secs(30),  // Short TTL
    allowed_chars_regex: regex::Regex::new(r"^[a-z]+$")?,  // Alpha only
    max_cache_size: 10_000,
};
```

## Troubleshooting

### Performance Issues

**Problem**: Slow pattern matching

**Solutions**:
1. Use exact matches when possible
2. Cache frequently used patterns
3. Consider pattern compilation caching (future enhancement)

**Problem**: High memory usage

**Solutions**:
1. Reduce `max_cache_size`
2. Decrease `cache_ttl`
3. Call `clear_cache()` periodically

### Validation Errors

**Problem**: "scope contains empty segment"

**Solution**: Check for double dots (`..`) in scope strings

**Problem**: "scope depth exceeds maximum"

**Solution**: Increase `max_depth` or restructure scope hierarchy

**Problem**: "invalid scope segment"

**Solution**: Check `allowed_chars_regex` configuration

## See Also

- [Architecture Documentation](./scope-architecture.md)
- [Implementation Summary](./scope-implementation-summary.md)
- [API Documentation](../target/doc/authz/scope/index.html) (generated by `cargo doc`)
