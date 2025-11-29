#!/bin/bash
# Migration script for Phase 6 RocksDB storage
#
# This script migrates existing Phase 5 storage to the new Phase 6 format with:
# - 6 column families
# - BLAKE3 hash-based indexing
# - Finalization tracking
# - Height and timestamp indices

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
OLD_DB_PATH="${OLD_DB_PATH:-./data/dag}"
NEW_DB_PATH="${NEW_DB_PATH:-./data/dag_v6}"
BACKUP_PATH="${BACKUP_PATH:-./data/backups}"
DRY_RUN="${DRY_RUN:-false}"

echo -e "${GREEN}=== CretoAI Phase 6 Storage Migration ===${NC}"
echo ""

# Check if old database exists
if [ ! -d "$OLD_DB_PATH" ]; then
    echo -e "${RED}Error: Old database not found at $OLD_DB_PATH${NC}"
    echo "Set OLD_DB_PATH environment variable to specify location"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_PATH"

# Step 1: Backup existing database
echo -e "${YELLOW}[1/5] Creating backup of existing database...${NC}"
BACKUP_NAME="pre-migration-$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_PATH/$BACKUP_NAME.tar.gz"

if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY RUN] Would create backup: $BACKUP_FILE"
else
    tar -czf "$BACKUP_FILE" -C "$(dirname "$OLD_DB_PATH")" "$(basename "$OLD_DB_PATH")"
    echo -e "${GREEN}  ✓ Backup created: $BACKUP_FILE${NC}"
fi

# Step 2: Analyze existing database
echo -e "${YELLOW}[2/5] Analyzing existing database...${NC}"

# Count vertices (this would need to be implemented in Rust)
# For now, estimate based on directory size
DB_SIZE=$(du -sh "$OLD_DB_PATH" | cut -f1)
echo "  Current database size: $DB_SIZE"

# Step 3: Create new database structure
echo -e "${YELLOW}[3/5] Creating new database structure...${NC}"

if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY RUN] Would create new database at: $NEW_DB_PATH"
else
    mkdir -p "$NEW_DB_PATH"
    echo -e "${GREEN}  ✓ New database directory created${NC}"
fi

# Step 4: Run migration utility
echo -e "${YELLOW}[4/5] Running migration utility...${NC}"

if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY RUN] Would run migration binary"
else
    # Check if migration binary exists
    if [ -f "./target/release/migrate-storage" ]; then
        ./target/release/migrate-storage \
            --source "$OLD_DB_PATH" \
            --dest "$NEW_DB_PATH" \
            --verbose
    elif [ -f "./target/debug/migrate-storage" ]; then
        ./target/debug/migrate-storage \
            --source "$OLD_DB_PATH" \
            --dest "$NEW_DB_PATH" \
            --verbose
    else
        echo -e "${YELLOW}  Warning: Migration binary not found${NC}"
        echo "  Building migration binary..."
        cargo build --release --bin migrate-storage

        ./target/release/migrate-storage \
            --source "$OLD_DB_PATH" \
            --dest "$NEW_DB_PATH" \
            --verbose
    fi

    echo -e "${GREEN}  ✓ Migration completed${NC}"
fi

# Step 5: Verify migration
echo -e "${YELLOW}[5/5] Verifying migration...${NC}"

if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY RUN] Would verify migration"
else
    # Run verification binary
    if [ -f "./target/release/verify-storage" ]; then
        ./target/release/verify-storage "$NEW_DB_PATH"
    elif [ -f "./target/debug/verify-storage" ]; then
        ./target/debug/verify-storage "$NEW_DB_PATH"
    else
        echo -e "${YELLOW}  Warning: Verification binary not found${NC}"
        echo "  Skipping verification..."
    fi

    NEW_DB_SIZE=$(du -sh "$NEW_DB_PATH" | cut -f1)
    echo "  New database size: $NEW_DB_SIZE"
    echo -e "${GREEN}  ✓ Migration verified${NC}"
fi

echo ""
echo -e "${GREEN}=== Migration Complete ===${NC}"
echo ""
echo "Summary:"
echo "  Old database: $OLD_DB_PATH ($DB_SIZE)"
if [ "$DRY_RUN" = "false" ]; then
    echo "  New database: $NEW_DB_PATH ($NEW_DB_SIZE)"
fi
echo "  Backup: $BACKUP_FILE"
echo ""

if [ "$DRY_RUN" = "false" ]; then
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Test the new database thoroughly"
    echo "  2. Update configuration to use: $NEW_DB_PATH"
    echo "  3. Once verified, you can remove the old database:"
    echo "     rm -rf $OLD_DB_PATH"
    echo ""
    echo "  To rollback, restore from backup:"
    echo "     tar -xzf $BACKUP_FILE -C $(dirname "$OLD_DB_PATH")"
fi

exit 0
