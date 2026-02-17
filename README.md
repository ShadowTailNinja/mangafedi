# MangaFedi

**Federated Manga, Manhwa & Manhua Hosting Platform**

A fediverse-native platform where every series and user is an ActivityPub actor. Chapter releases federate as activities. Any Mastodon user can follow a series and receive chapter notifications.

## Features

- **Federated**: ActivityPub actors for users and series; follows, comments, and chapter announces federate across the fediverse
- **Portable Identity**: BIP-39 seed phrases allow account and series recovery on any MangaFedi instance
- **Archive Upload**: CBZ/ZIP chapter upload with single-pass Sharp processing
- **Admin & Moderation**: Instance config, user management, report queue, DMCA takedowns, federation block management
- **No Redis required**: Runs on a single VPS with a single PostgreSQL instance

## Quick Start

### Requirements

- Node.js 22+
- PostgreSQL 16+
- S3-compatible storage (Cloudflare R2, MinIO, etc.)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-org/mangafedi
cd mangafedi
pnpm install

# 2. Generate secrets and configure
bash scripts/setup.sh
# Edit .env with your BASE_URL, STORAGE_* values

# 3. Start services
docker compose -f docker/docker-compose.yml up -d db pgbouncer

# 4. Run migrations and create admin
pnpm build
pnpm create-admin
# or with env vars:
ADMIN_USERNAME=admin ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=changeme pnpm create-admin

# 5. Start the app
docker compose -f docker/docker-compose.yml up -d
```

### Development

```bash
pnpm dev          # Start dev server with hot reload
pnpm db:generate  # Generate migrations from schema changes
pnpm db:migrate   # Apply migrations
pnpm test         # Run tests
```

## Architecture

- **Stack**: Node.js 22, TypeScript (strict), Hono, Fedify, Drizzle ORM, PostgreSQL
- **Queue**: `@fedify/postgres` (LISTEN/NOTIFY, direct connection – bypasses PgBouncer)
- **Storage**: S3-compatible (Cloudflare R2 recommended)
- **CDN**: Images served from CDN, never from origin

### Scaling Ladder

| Stage | Config | MAU |
|---|---|---|
| 1 | `RUN_MODE=all`, single Compose | 0–5K |
| 2 | Split web + worker | 5K–20K |
| 3 | Add `DATABASE_REPLICA_URL` | 20K–100K |
| 4 | `QUEUE_BACKEND=redis` + managed DB | 100K+ |

Zero code changes required at any stage.

## API

API documentation available at `GET /api/v1/docs`  
OpenAPI spec: `GET /api/v1/openapi.json`

## License

AGPL-3.0
