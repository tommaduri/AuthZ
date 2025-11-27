# Package Conflict Fix - URGENT

## Issue
The file `internal/auth/jwks_validator.go` declares `package jwt` but is located in the `internal/auth` directory. This creates a package conflict because Go expects all files in a directory to belong to the same package.

## Error Message
```
internal/auth/apikey/middleware.go:8:2: found packages auth (claims.go) and jwt (jwks_validator.go) in /Users/tommaduri/Documents/GitHub/authz-engine/go-core/internal/auth
FAIL	github.com/authz-engine/go-core/internal/auth/apikey [setup failed]
```

## Root Cause
- File: `internal/auth/jwks_validator.go`
- Current package: `package jwt`
- Current location: `internal/auth/`
- Expected location: `internal/auth/jwt/`

## Fix (Choose One)

### Option 1: Move to Correct Directory (Recommended)
```bash
cd go-core
mkdir -p internal/auth/jwt
mv internal/auth/jwks_validator.go internal/auth/jwt/
```

Then update imports in any files that reference it.

### Option 2: Change Package Declaration
Edit `internal/auth/jwks_validator.go` and change:
```go
package jwt
```
to:
```go
package auth
```

This may require renaming exported types to avoid conflicts.

### Option 3: Separate JWT Package (Best Practice)
If JWT functionality should be separate:

```bash
cd go-core
mkdir -p internal/jwt
mv internal/auth/jwks_validator.go internal/jwt/
mv internal/auth/jwt/* internal/jwt/ 2>/dev/null || true
```

Then update all imports:
```go
// Before
import "github.com/authz-engine/go-core/internal/auth/jwt"

// After
import "github.com/authz-engine/go-core/internal/jwt"
```

## Impact

### Files Affected
- `internal/auth/jwks_validator.go` (the problematic file)
- Any files importing `internal/auth/jwt`

### Tests Affected
Cannot run ANY tests in the `internal/auth/apikey` package until this is fixed:
- ❌ `generator_test.go`
- ❌ `validator_test.go`
- ❌ `rate_limiter_test.go`
- ❌ `middleware_test.go`
- ❌ `service_test.go`
- ❌ `postgres_store_test.go`
- ❌ Integration tests

## Quick Fix Script

```bash
#!/bin/bash
# Quick fix: Move jwks_validator.go to jwt subdirectory

cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core

# Create jwt directory if it doesn't exist
mkdir -p internal/auth/jwt

# Move the problematic file
mv internal/auth/jwks_validator.go internal/auth/jwt/

# Run tests to verify fix
go test ./internal/auth/apikey/...
```

## Verification

After applying the fix, run:
```bash
# Should compile without errors
go build ./internal/auth/apikey/...

# Should run all tests
go test -v ./internal/auth/apikey/...

# Should show coverage >70%
go test -cover ./internal/auth/apikey/...
```

## Status
- **Discovered**: During test coverage analysis
- **Severity**: HIGH (blocks all testing)
- **Pre-existing**: Yes (not introduced by recent changes)
- **Fix Required**: Yes (immediate)

## Next Steps
1. Apply one of the fixes above
2. Run `go test ./internal/auth/apikey/...` to verify
3. Generate coverage report
4. Proceed with deployment if coverage >70%
