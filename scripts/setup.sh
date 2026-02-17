#!/bin/bash
# scripts/setup.sh – First-time instance setup
set -e

if [ -f .env ]; then
  echo "⚠️  .env already exists. Skipping secret generation."
else
  SESSION_SECRET=$(openssl rand -hex 64)
  PORTABLE_KEY_HMAC_SECRET=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 32)

  cp .env.example .env
  echo "" >> .env
  echo "# Generated secrets" >> .env
  echo "SESSION_SECRET=$SESSION_SECRET" >> .env
  echo "PORTABLE_KEY_HMAC_SECRET=$PORTABLE_KEY_HMAC_SECRET" >> .env
  echo "DB_PASSWORD=$DB_PASSWORD" >> .env

  echo "✓ Secrets written to .env"
fi

echo ""
echo "⚙️  Edit .env and configure BASE_URL, STORAGE_*, etc."
echo ""
echo "Next steps:"
echo "  1. docker compose -f docker/docker-compose.yml up -d db pgbouncer"
echo "  2. docker compose -f docker/docker-compose.yml run --rm app node dist/index.js"
echo "  3. docker compose -f docker/docker-compose.yml run --rm -e ADMIN_USERNAME=admin -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=changeme app node dist/scripts/createAdmin.js"
echo "  4. docker compose -f docker/docker-compose.yml up -d"
