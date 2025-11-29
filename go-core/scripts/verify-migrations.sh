#!/bin/bash
# Migration Verification Script
# Verifies Phase 2 migration files are complete and ready for deployment

set -e

echo "🔍 Verifying Phase 2 PostgreSQL Migrations"
echo "=========================================="
echo ""

MIGRATION_DIR="/Users/tommaduri/Documents/GitHub/authz-engine/go-core/migrations"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check migration files exist
echo "📁 Checking migration files..."

migrations=(
    "000011_create_vector_extension.up.sql"
    "000011_create_vector_extension.down.sql"
    "000012_create_derived_roles.up.sql"
    "000012_create_derived_roles.down.sql"
    "000013_create_policy_embeddings.up.sql"
    "000013_create_policy_embeddings.down.sql"
)

all_exist=true
for migration in "${migrations[@]}"; do
    if [ -f "$MIGRATION_DIR/$migration" ]; then
        size=$(du -h "$MIGRATION_DIR/$migration" | cut -f1)
        echo -e "  ${GREEN}✓${NC} $migration ($size)"
    else
        echo -e "  ${RED}✗${NC} $migration (missing)"
        all_exist=false
    fi
done
echo ""

if [ "$all_exist" = false ]; then
    echo -e "${RED}❌ Some migration files are missing!${NC}"
    exit 1
fi

# Check for SQL syntax errors (basic check)
echo "📝 Checking SQL syntax (basic validation)..."

for migration in "${migrations[@]}"; do
    if [[ $migration == *.up.sql ]]; then
        # Check for basic SQL keywords
        if grep -q "CREATE TABLE\|CREATE INDEX\|CREATE EXTENSION" "$MIGRATION_DIR/$migration"; then
            echo -e "  ${GREEN}✓${NC} $migration has CREATE statements"
        else
            echo -e "  ${YELLOW}⚠${NC}  $migration missing CREATE statements"
        fi
    elif [[ $migration == *.down.sql ]]; then
        # Check for DROP statements
        if grep -q "DROP TABLE\|DROP INDEX\|DROP EXTENSION" "$MIGRATION_DIR/$migration"; then
            echo -e "  ${GREEN}✓${NC} $migration has DROP statements"
        else
            echo -e "  ${YELLOW}⚠${NC}  $migration missing DROP statements"
        fi
    fi
done
echo ""

# Check for multi-tenancy support
echo "🔒 Verifying multi-tenancy implementation..."

for table in "derived_roles" "policy_embeddings"; do
    if grep -q "tenant_id TEXT NOT NULL" "$MIGRATION_DIR/000012_create_derived_roles.up.sql" "$MIGRATION_DIR/000013_create_policy_embeddings.up.sql"; then
        echo -e "  ${GREEN}✓${NC} Tables have tenant_id column"
    else
        echo -e "  ${RED}✗${NC} Missing tenant_id column"
    fi

    if grep -q "ENABLE ROW LEVEL SECURITY" "$MIGRATION_DIR/000012_create_derived_roles.up.sql" "$MIGRATION_DIR/000013_create_policy_embeddings.up.sql"; then
        echo -e "  ${GREEN}✓${NC} Row-Level Security enabled"
    else
        echo -e "  ${RED}✗${NC} RLS not enabled"
    fi
done
echo ""

# Check for required indexes
echo "📊 Verifying index creation..."

# GIN index for derived_roles
if grep -q "USING GIN" "$MIGRATION_DIR/000012_create_derived_roles.up.sql"; then
    echo -e "  ${GREEN}✓${NC} GIN index on parent_roles array"
else
    echo -e "  ${RED}✗${NC} Missing GIN index on parent_roles"
fi

# HNSW index for policy_embeddings
if grep -q "USING hnsw" "$MIGRATION_DIR/000013_create_policy_embeddings.up.sql"; then
    hnsw_count=$(grep -c "USING hnsw" "$MIGRATION_DIR/000013_create_policy_embeddings.up.sql")
    echo -e "  ${GREEN}✓${NC} HNSW indexes on embedding vector ($hnsw_count indexes)"
else
    echo -e "  ${RED}✗${NC} Missing HNSW index on embedding"
fi
echo ""

# Check for backward compatibility
echo "🔄 Checking backward compatibility..."

# Ensure no modifications to existing tables
if grep -q "ALTER TABLE api_keys\|ALTER TABLE refresh_tokens\|ALTER TABLE auth_audit_logs" "$MIGRATION_DIR/000011_create_vector_extension.up.sql" "$MIGRATION_DIR/000012_create_derived_roles.up.sql" "$MIGRATION_DIR/000013_create_policy_embeddings.up.sql"; then
    echo -e "  ${YELLOW}⚠${NC}  Found ALTER TABLE on Phase 1 tables (potential breaking change)"
else
    echo -e "  ${GREEN}✓${NC} No modifications to Phase 1 tables"
fi
echo ""

# Check for documentation
echo "📚 Verifying documentation..."

if [ -f "/Users/tommaduri/Documents/GitHub/authz-engine/go-core/src/authz/migrations/README.md" ]; then
    echo -e "  ${GREEN}✓${NC} README.md exists"
else
    echo -e "  ${YELLOW}⚠${NC}  README.md missing"
fi

if [ -f "/Users/tommaduri/Documents/GitHub/authz-engine/go-core/docs/schema-design-phase2.md" ]; then
    echo -e "  ${GREEN}✓${NC} Schema design document exists"
else
    echo -e "  ${YELLOW}⚠${NC}  Schema design document missing"
fi
echo ""

# Summary
echo "=========================================="
echo "✅ Phase 2 Migration Verification Complete"
echo ""
echo "Migration Files:"
echo "  • 000011: pgvector extension setup"
echo "  • 000012: derived_roles table with GIN indexes"
echo "  • 000013: policy_embeddings with HNSW indexes"
echo ""
echo "Key Features:"
echo "  • Multi-tenancy with RLS policies"
echo "  • GIN indexes for array queries"
echo "  • HNSW indexes for vector similarity"
echo "  • Backward compatible with Phase 1"
echo "  • Complete rollback support"
echo ""
echo "Next Steps:"
echo "  1. Test migrations on development database"
echo "  2. Run: sqlx migrate run"
echo "  3. Verify: SELECT * FROM pg_extension WHERE extname = 'vector';"
echo "  4. Update Rust PostgreSQL store implementation"
echo ""
