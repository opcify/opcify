#!/usr/bin/env bash
set -euo pipefail

SCHEMA="prisma/schema.prisma"
DB="prisma/opcify.db"

echo "=== Opcify Migration Squash ==="
echo ""

# Safety: verify we're in the right directory
if [ ! -f "$SCHEMA" ]; then
  echo "ERROR: Run from the project root ($SCHEMA not found)"
  exit 1
fi

# Safety: check for uncommitted changes to migrations
if ! git diff --quiet prisma/migrations/ 2>/dev/null; then
  echo "ERROR: Uncommitted changes in prisma/migrations/. Commit or stash first."
  exit 1
fi

# Step 1: Backup
echo "Step 1: Backing up database..."
if [ -f "$DB" ]; then
  cp "$DB" "${DB}.pre-squash"
  echo "  -> Backed up to ${DB}.pre-squash"
else
  echo "  -> No database file found (clean state)"
fi

# Step 2: Remove old migrations
echo "Step 2: Removing old migrations..."
rm -rf prisma/migrations/

# Step 3: Generate fresh baseline
echo "Step 3: Generating fresh baseline migration..."
pnpm exec prisma migrate dev --name init --create-only --schema "$SCHEMA"

# Step 4: Resolve against existing database
echo "Step 4: Baselining existing database..."
MIGRATION_DIR=$(ls -1 prisma/migrations/ | grep -v migration_lock | head -1)
if [ -z "$MIGRATION_DIR" ]; then
  echo "ERROR: No migration directory generated"
  exit 1
fi
pnpm exec prisma migrate resolve --applied "$MIGRATION_DIR" --schema "$SCHEMA"

# Step 5: Verify
echo ""
echo "Step 5: Verifying..."
pnpm exec prisma migrate status --schema "$SCHEMA"

echo ""
echo "=== Squash complete ==="
echo "Review the changes, then:"
echo "  git add prisma/migrations/ && git commit -m 'chore(db): squash migrations to single baseline'"
