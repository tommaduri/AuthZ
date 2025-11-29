#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

MIGRATIONS_DIR="/Users/tommaduri/Documents/GitHub/authz-engine/rust-migration/creto-ai/src/authz/migrations"

echo "=================================="
echo "Migration Verification Script"
echo "=================================="
echo ""

# Track overall status
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Function to print status
check_status() {
    local status=$1
    local message=$2
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    if [ "$status" = "pass" ]; then
        echo -e "${GREEN}✓${NC} $message"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    elif [ "$status" = "fail" ]; then
        echo -e "${RED}✗${NC} $message"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    else
        echo -e "${YELLOW}⚠${NC} $message"
    fi
}

# Check 1: Verify migrations directory exists
echo "1. Checking migrations directory..."
if [ -d "$MIGRATIONS_DIR" ]; then
    check_status "pass" "Migrations directory exists: $MIGRATIONS_DIR"
else
    check_status "fail" "Migrations directory not found: $MIGRATIONS_DIR"
    exit 1
fi
echo ""

# Check 2: Verify all migration files exist
echo "2. Checking migration files..."
EXPECTED_FILES=(
    "001_create_policies_table.sql"
    "002_create_vector_extension.sql"
    "003_create_derived_roles.sql"
    "004_create_policy_embeddings.sql"
)

for file in "${EXPECTED_FILES[@]}"; do
    if [ -f "$MIGRATIONS_DIR/$file" ]; then
        check_status "pass" "Found: $file"
    else
        check_status "fail" "Missing: $file"
    fi
done
echo ""

# Check 3: Validate SQL syntax (basic check)
echo "3. Validating SQL syntax..."
for file in "$MIGRATIONS_DIR"/*.sql; do
    filename=$(basename "$file")

    # Check for common SQL errors
    if grep -q "CREATE TABLE.*CREATE TABLE" "$file"; then
        check_status "fail" "$filename: Multiple CREATE TABLE without semicolon"
        continue
    fi

    if grep -q "CREATE INDEX.*CREATE INDEX" "$file"; then
        check_status "fail" "$filename: Multiple CREATE INDEX without semicolon"
        continue
    fi

    # Check for balanced parentheses (basic check)
    open_parens=$(grep -o "(" "$file" | wc -l)
    close_parens=$(grep -o ")" "$file" | wc -l)

    if [ "$open_parens" -ne "$close_parens" ]; then
        check_status "fail" "$filename: Unbalanced parentheses (open: $open_parens, close: $close_parens)"
        continue
    fi

    check_status "pass" "$filename: Basic syntax validation passed"
done
echo ""

# Check 4: Verify pgvector extension
echo "4. Checking pgvector extension setup..."
if grep -q "CREATE EXTENSION.*vector" "$MIGRATIONS_DIR/002_create_vector_extension.sql"; then
    check_status "pass" "pgvector extension creation found"
else
    check_status "fail" "pgvector extension creation not found"
fi

if grep -q "cosine_similarity" "$MIGRATIONS_DIR/002_create_vector_extension.sql"; then
    check_status "pass" "cosine_similarity function found"
else
    check_status "fail" "cosine_similarity function not found"
fi

if grep -q "l2_distance_normalized" "$MIGRATIONS_DIR/002_create_vector_extension.sql"; then
    check_status "pass" "l2_distance_normalized function found"
else
    check_status "fail" "l2_distance_normalized function not found"
fi
echo ""

# Check 5: Verify derived_roles table
echo "5. Checking derived_roles table..."
if grep -q "CREATE TABLE.*derived_roles" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "derived_roles table creation found"
else
    check_status "fail" "derived_roles table creation not found"
fi

if grep -q "parent_roles TEXT\[\]" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "parent_roles array column found"
else
    check_status "fail" "parent_roles array column not found"
fi

if grep -q "condition JSONB" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "condition JSONB column found"
else
    check_status "fail" "condition JSONB column not found"
fi

if grep -q "GIN.*parent_roles" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "GIN index on parent_roles found"
else
    check_status "fail" "GIN index on parent_roles not found"
fi

if grep -q "check_role_hierarchy_cycles" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "Cycle detection function found"
else
    check_status "fail" "Cycle detection function not found"
fi
echo ""

# Check 6: Verify policy_embeddings table
echo "6. Checking policy_embeddings table..."
if grep -q "CREATE TABLE.*policy_embeddings" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "policy_embeddings table creation found"
else
    check_status "fail" "policy_embeddings table creation not found"
fi

if grep -q "embedding vector(1536)" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "embedding vector(1536) column found"
else
    check_status "fail" "embedding vector(1536) column not found"
fi

if grep -q "USING hnsw.*vector_cosine_ops" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "HNSW cosine index found"
else
    check_status "fail" "HNSW cosine index not found"
fi

if grep -q "USING hnsw.*vector_l2_ops" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "HNSW L2 index found"
else
    check_status "fail" "HNSW L2 index not found"
fi

if grep -q "search_similar_policies" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "Semantic search function found"
else
    check_status "fail" "Semantic search function not found"
fi
echo ""

# Check 7: Verify foreign key relationships
echo "7. Checking foreign key relationships..."
if grep -q "REFERENCES policies" "$MIGRATIONS_DIR/004_create_policy_embeddings.sql"; then
    check_status "pass" "Foreign key to policies table found"
else
    check_status "fail" "Foreign key to policies table not found"
fi
echo ""

# Check 8: Verify RLS policies
echo "8. Checking Row Level Security policies..."
if grep -q "ENABLE ROW LEVEL SECURITY" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "RLS enabled on derived_roles"
else
    check_status "fail" "RLS not enabled on derived_roles"
fi

if grep -q "CREATE POLICY.*tenant_isolation" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "Tenant isolation policy found"
else
    check_status "fail" "Tenant isolation policy not found"
fi
echo ""

# Check 9: Verify optimistic locking
echo "9. Checking optimistic locking..."
if grep -q "version INTEGER" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "Version column found in derived_roles"
else
    check_status "fail" "Version column not found in derived_roles"
fi

if grep -q "OLD.version.*1" "$MIGRATIONS_DIR/003_create_derived_roles.sql"; then
    check_status "pass" "Version increment logic found"
else
    check_status "fail" "Version increment logic not found"
fi
echo ""

# Check 10: Verify indexing strategy
echo "10. Checking indexing strategy..."
total_indexes=$(grep -c "CREATE.*INDEX" "$MIGRATIONS_DIR"/*.sql || echo "0")
hnsw_indexes=$(grep -c "USING hnsw" "$MIGRATIONS_DIR"/*.sql || echo "0")
gin_indexes=$(grep -c "USING GIN" "$MIGRATIONS_DIR"/*.sql || echo "0")

echo "   Total indexes: $total_indexes"
echo "   HNSW indexes: $hnsw_indexes"
echo "   GIN indexes: $gin_indexes"

if [ "$total_indexes" -ge 15 ]; then
    check_status "pass" "Sufficient indexes created ($total_indexes)"
else
    check_status "warn" "Consider adding more indexes ($total_indexes found)"
fi
echo ""

# Summary
echo "=================================="
echo "Verification Summary"
echo "=================================="
echo "Total checks: $TOTAL_CHECKS"
echo -e "${GREEN}Passed: $PASSED_CHECKS${NC}"
echo -e "${RED}Failed: $FAILED_CHECKS${NC}"
echo ""

if [ "$FAILED_CHECKS" -eq 0 ]; then
    echo -e "${GREEN}✓ All migration verifications passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some verifications failed. Please review the errors above.${NC}"
    exit 1
fi
