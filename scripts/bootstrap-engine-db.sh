#!/usr/bin/env bash
# =============================================================================
# Bootstrap the casino_roulette_db database on the AGD shared postgres,
# for INTEGRATED-AGD mode of the Python game-roulette engine.
# =============================================================================
# Workaround for AGD_INTEGRATION_REQUESTS REQ-010 (AGD init script does not
# create this DB). Idempotent.
#
# Run AFTER the AGD shared infra is up and BEFORE
# `docker compose -f docker-compose.integrated-agd.yml up -d --build`.
# =============================================================================

set -euo pipefail

DB_NAME="${DB_NAME:-casino_roulette_db}"
DB_USER="${DB_USER:-agd}"
CONTAINER="${CONTAINER:-agd-postgres}"

echo "Bootstrapping $DB_NAME on $CONTAINER..."

docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres <<SQL
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" >/dev/null

echo "✅ $DB_NAME ready."
