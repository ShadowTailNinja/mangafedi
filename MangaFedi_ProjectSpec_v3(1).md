# MangaFedi — Federated Manga, Manhwa & Manhua Hosting Platform
## Project Specification & Development Guide
### Version 3.0 — Final Pre-Implementation

---

> **Document Provenance**
> **Lead Architect:** Senior Systems Architect & Full-Stack Engineer
> **Round 1 Reviewer:** Senior Backend Engineer & Federation Specialist
> **Round 2 Reviewer (Addendum):** Infrastructure & UX Specialist
> **Round 3 Reviewer:** Production Operations & Performance Specialist (external submission)
> **Round 4 Reviewer:** Lead Architect (this pass — incorporating Round 3 + independent audit)
>
> **What changed from V2.0:** See Appendix C for the full change log. Summary of Round 3 + independent audit fixes: archive double-trip I/O eliminated (§10.4); UUIDv4 index fragmentation resolved with UUIDv7 (§5.2, §5.4); backup script updated to push offsite to S3 (§19.5); `bcrypt` async enforcement documented (§8.1); archive junk-file filtering specified (§10.4, §15.1); tombstone actor URI cache-invalidation added (§6.6). Independent audit also added: global error handler (§8.4); `blurhash` package in stack (§2.2, §2.5); `validateApiToken` expiry condition completed (§8.1); `createAdmin` setup script documented (§19.4); `archiveStorageKey` column added to schema (§5.2); `uuidv7` import added to schema (§5.2); PgBouncer + Postgres LISTEN/NOTIFY incompatibility resolved (§13.3); `PROCESSING_FAILED` retry/dead-letter strategy added (§13.4).
>
> *This document is the single authoritative reference. Begin implementation from here, not any prior version.*

---

## Table of Contents

1. [Project Overview & Philosophy](#1-project-overview--philosophy)
2. [Technology Stack](#2-technology-stack)
3. [Repository & Project Structure](#3-repository--project-structure)
4. [Environment Configuration](#4-environment-configuration)
5. [Database Schema](#5-database-schema)
6. [ActivityPub & Federation Layer](#6-activitypub--federation-layer)
7. [API Design & Endpoints](#7-api-design--endpoints)
8. [Authentication & Identity](#8-authentication--identity)
9. [Portable Identity & Data Recovery](#9-portable-identity--data-recovery)
10. [Image Storage & Processing](#10-image-storage--processing)
11. [Default Frontend](#11-default-frontend)
12. [The Reader](#12-the-reader)
13. [Background Workers & Queuing](#13-background-workers--queuing)
14. [Scaling Architecture](#14-scaling-architecture)
15. [Content Moderation](#15-content-moderation)
16. [Instance Administration](#16-instance-administration)
17. [Performance Considerations](#17-performance-considerations)
18. [Security Considerations](#18-security-considerations)
19. [Docker & Deployment](#19-docker--deployment)
20. [Testing Strategy](#20-testing-strategy)
21. [Implementation Order](#21-implementation-order)
22. [Known Limitations & Future Work](#22-known-limitations--future-work)
- [Appendix A — Error Codes](#appendix-a--error-codes)
- [Appendix B — ActivityPub Namespace](#appendix-b--activitypub-namespace)
- [Appendix C — Full Change Log](#appendix-c--full-change-log)

---

## 1. Project Overview & Philosophy

### 1.1 What This Is

MangaFedi is a **federated hosting platform** for manga (Japanese), manhwa (Korean), and manhua (Chinese) comics. It is simultaneously two things:

- A **media platform**: users browse series, read chapters, track progress, maintain libraries, and leave comments — analogous to MangaDex or Webtoons.
- A **fediverse citizen**: every series and user is an ActivityPub actor. Chapter releases federate as activities. Comments, follows, and interactions participate in the open social web. Any Mastodon user can follow a series and receive chapter notifications in their home feed.

### 1.2 Core Design Principles

These are non-negotiable and must be maintained throughout development:

**1. The backend is the product.** The default frontend is a proof-of-concept demonstrating the API. Third-party developers should be able to build entirely different frontends — mobile apps, alternative web UIs, CLI tools — using only the public API. Every platform feature must be accessible via the REST API before it appears in the UI.

**2. One Postgres, zero Redis.** The platform must run on a single VPS with a single PostgreSQL instance and no Redis dependency. Redis is supported as an optional upgrade via environment variable, never a requirement. This makes self-hosting accessible to small communities.

**3. Lightweight by default, scalable by config.** Every scaling operation — adding read replicas, switching to Redis, running separate worker processes, adding app instances — must be achievable by changing environment variables and adding containers. Zero code changes required to scale from 100 to 100,000 users.

**4. Portable user identity.** Users own their identity, not instances. A BIP-39 seed phrase proves ownership of an account and all content attributed to it. If an instance shuts down, users can recover their profile and attribution on any other instance using their seed phrase.

**5. No flashy UI.** The default frontend is functional, readable, and fast. It prioritises content over chrome. Think Lemmy, not Instagram. Server-side rendered HTML with a single small CSS file. JavaScript only where necessary (the reader).

**6. Federation as ecosystem health.** The platform is designed to discourage instance monopolies. Content (images) is always served from CDN, never from the origin instance — so a small instance hosting a popular series does not bear the bandwidth cost of its readers. Series-centric federation means users spread across instances naturally.

### 1.3 What This Is Not

- Not a scraper or aggregator. Only original uploads by rights holders or licensed translators (scanlation groups).
- Not a social network. Comments and follows serve content discovery, not social graph building.
- Not a streaming or video platform.
- Not a replacement for Mastodon. It federates *with* Mastodon, not instead of it.

---

## 2. Technology Stack

### 2.1 Runtime

- **Runtime**: Node.js 22 LTS (not Bun, not Deno — Node.js for maximum operational stability and ecosystem compatibility)
- **Language**: TypeScript 5.x, strict mode, no `any`
- **Package manager**: pnpm

### 2.2 Backend

| Concern | Package | Notes |
|---|---|---|
| Web framework | `hono` | Lightweight, Web Standards, multi-runtime |
| ActivityPub | `@fedify/fedify` | All AP complexity handled |
| AP ↔ Hono bridge | `@fedify/hono` | Official integration |
| ORM | `drizzle-orm` | Type-safe, close to SQL |
| DB driver | `postgres` (pg) | Node.js Postgres client |
| Validation | `zod` | Schema validation and type inference |
| OpenAPI | `@hono/zod-openapi` | Auto-generate API docs from Zod schemas |
| Auth | Custom thin layer | See §8.1 — replaces better-auth for schema control |
| Password hashing | `bcrypt` | Stable, audited — **always use async variant** |
| Image processing | `sharp` | Fastest Node.js image processing |
| Archive extraction | `unzipper` | CBZ/ZIP chapter archive support |
| Blurhash | `blurhash` | Low-quality image placeholders for reader |
| UUID generation | `uuidv7` | Time-sorted UUIDs — prevents B-tree fragmentation |
| Storage client | `@aws-sdk/client-s3` | S3-compatible, works with R2/MinIO/B2 |
| Crypto / BIP-39 | `@scure/bip39`, `@noble/ed25519` | Audited, zero-dependency crypto |
| Queue | `@fedify/postgres` | Postgres LISTEN/NOTIFY queue — **direct conn only** |
| Migrations | `drizzle-kit` | Schema migration management |
| Environment | `dotenv` + manual parsing | No magic, explicit config |

> **Auth:** `better-auth` was removed in favour of a thin custom auth layer (~120 lines) directly against the `users` and `sessions` tables. This eliminates schema conflicts with Fedify's own tables and gives full control over the session model.

> **Archive:** `unzipper` added for CBZ/ZIP chapter upload support. Scanlation groups nearly always distribute as archives; individual-file upload via presigned URLs remains available as a fallback.

> **V3 — PgBouncer + Queue incompatibility:** The `@fedify/postgres` queue uses `LISTEN/NOTIFY`, which requires a persistent, stateful connection. This is **incompatible with PgBouncer in `transaction` pool mode**. The federation queue MUST connect to Postgres directly (bypassing PgBouncer). See §13.3 for the two-connection-string architecture that resolves this.

### 2.3 Frontend (Default)

| Concern | Approach | Notes |
|---|---|---|
| Rendering | Hono JSX (server-side) | No React, no build step for HTML |
| Styling | Single flat CSS file | No Tailwind, no PostCSS, no build pipeline |
| Reader JS | Vanilla JS, single file | ~200 lines, no framework |
| Icons | Inline SVG only | No icon library |

### 2.4 Infrastructure

| Concern | Default | Upgrade path |
|---|---|---|
| Database | Self-hosted PostgreSQL 16 | Managed Postgres (Neon, Supabase) |
| Queue connection | Direct to Postgres (bypass PgBouncer) | Same — always direct |
| App DB connection | Via PgBouncer (transaction mode) | Same — always pooled |
| Image storage | Cloudflare R2 | Any S3-compatible via env var |
| CDN | Cloudflare (automatic with R2) | Configurable via `STORAGE_PUBLIC_URL` |
| Reverse proxy | Caddy | Automatic TLS, simple config |
| Process management | Docker Compose | Single Compose file covers all cases |
| Backups | `pg_dump` → S3 offsite (cron) | See §19.5 |

### 2.5 Version Pins

```
node: 22.x
typescript: 5.5.x
hono: 4.x
@fedify/fedify: 1.10.x     # Ensure >= 1.9.x for CVE-2025-54888 fix
@fedify/hono: 1.x
@fedify/postgres: 1.x
drizzle-orm: 0.32.x
drizzle-kit: 0.23.x
zod: 3.23.x
@hono/zod-openapi: 0.16.x
bcrypt: 5.x
@types/bcrypt: 5.x
sharp: 0.33.x
blurhash: 2.x
uuidv7: 1.x
unzipper: 0.12.x
postgres: 3.4.x
@aws-sdk/client-s3: 3.x
@scure/bip39: 1.3.x
@noble/ed25519: 2.1.x
@noble/hashes: 1.x
```

---

## 3. Repository & Project Structure

### 3.1 Monorepo Layout

```
mangafedi/
├── src/
│   ├── config.ts               # All env var parsing — single source of truth
│   ├── index.ts                # Entrypoint — startup orchestration
│   ├── webServer.ts            # Hono app assembly + global error handler
│   │
│   ├── db/
│   │   ├── schema.ts           # Complete Drizzle schema
│   │   ├── index.ts            # DB client instances (app + queue + testConnection)
│   │   └── queries/
│   │       ├── series.ts
│   │       ├── chapters.ts
│   │       ├── users.ts
│   │       ├── comments.ts
│   │       └── admin.ts
│   │
│   ├── federation/
│   │   ├── index.ts            # createFederation() — uses direct DB connection
│   │   ├── actors.ts           # Actor dispatchers (users, series, groups)
│   │   ├── inbox.ts            # Inbox listeners
│   │   ├── outbox.ts           # Outbox helpers + circuit breaker
│   │   └── keypairs.ts         # Key management for actors
│   │
│   ├── services/               # Business logic — no HTTP, no DB clients directly
│   │   ├── series.ts
│   │   ├── chapters.ts
│   │   ├── users.ts
│   │   ├── comments.ts
│   │   ├── library.ts
│   │   ├── progress.ts
│   │   ├── upload.ts
│   │   ├── identity.ts
│   │   └── admin.ts
│   │
│   ├── api/                    # JSON REST API (OpenAPIHono)
│   │   ├── index.ts
│   │   ├── middleware.ts       # Auth middleware, CORS, rate limiting
│   │   ├── series.ts
│   │   ├── chapters.ts
│   │   ├── users.ts
│   │   ├── comments.ts
│   │   ├── library.ts
│   │   ├── progress.ts
│   │   ├── upload.ts
│   │   ├── auth.ts
│   │   ├── search.ts
│   │   ├── nodeinfo.ts
│   │   └── admin/
│   │       ├── index.ts
│   │       ├── instance.ts
│   │       ├── users.ts
│   │       ├── federation.ts
│   │       └── reports.ts
│   │
│   ├── web/                    # Server-rendered HTML frontend
│   │   ├── index.ts
│   │   ├── layout.tsx
│   │   ├── middleware.ts
│   │   └── routes/
│   │       ├── browse.tsx
│   │       ├── series.tsx
│   │       ├── reader.tsx
│   │       ├── user.tsx
│   │       ├── library.tsx
│   │       ├── auth.tsx
│   │       ├── upload.tsx
│   │       └── admin.tsx
│   │
│   ├── storage/
│   │   ├── index.ts            # S3 client wrapper
│   │   └── keys.ts             # Storage path helpers + cache-busting
│   │
│   ├── worker/
│   │   ├── index.ts
│   │   └── jobs/
│   │       ├── imageProcess.ts # Sharp image processing (with OOM guard)
│   │       ├── archiveIngest.ts # CBZ/ZIP single-pass extraction + processing
│   │       └── cleanup.ts
│   │
│   └── lib/
│       ├── errors.ts           # Typed error classes
│       ├── pagination.ts       # Cursor pagination helpers
│       ├── crypto.ts           # Seed phrase / key derivation helpers
│       ├── auth.ts             # Thin auth layer (bcrypt async only)
│       └── cache.ts            # In-memory TTL cache
│
├── public/
│   ├── style.css
│   └── reader.js
│
├── migrations/                 # Drizzle migration files (generated)
├── scripts/
│   ├── setup.sh                # Generates secrets, runs migrations, creates admin
│   └── createAdmin.ts          # Admin user seeding script
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── pgbouncer.ini
│   └── backup.sh               # pg_dump → S3 cron script
├── drizzle.config.ts
├── tsconfig.json
├── package.json
└── .env.example
```

### 3.2 Key Architecture Rules

- **Services call queries. Routes call services.** Routes must never import from `db/queries` directly.
- **API routes and web routes call the same service functions.** No duplicated business logic.
- **The federation layer calls services. Services never import from federation.** Unidirectional dependency.
- **`config.ts` is the only file that reads `process.env`.** All other files import from config.
- **`lib/auth.ts` is the only file that performs password hashing or session creation.**
- **`db.queue` (direct connection) is used exclusively by federation.** All other code uses `db.primary` (pooled via PgBouncer). See §13.3.

---

## 4. Environment Configuration

### 4.1 Complete `.env.example`

```bash
# ─────────────────────────────────────────────────
# TIER 1 — STARTUP CONFIG (requires restart)
# ─────────────────────────────────────────────────

# Core
NODE_ENV=production
PORT=3000
BASE_URL=https://manga.example.com
RUN_MODE=all                    # "all" | "web" | "worker"

# Database — app traffic (via PgBouncer, transaction mode)
DATABASE_PRIMARY_URL=postgres://manga:password@pgbouncer:6432/manga
DATABASE_REPLICA_URL=           # Optional. Falls back to PRIMARY if unset.

# Database — federation queue (DIRECT to Postgres — bypasses PgBouncer)
# V3: LISTEN/NOTIFY requires a persistent connection; PgBouncer breaks it.
DATABASE_QUEUE_URL=postgres://manga:password@db:5432/manga

# Queue backend
QUEUE_BACKEND=postgres          # "postgres" | "redis"
REDIS_URL=                      # Required only if QUEUE_BACKEND=redis

# Object storage (S3-compatible)
STORAGE_ENDPOINT=https://s3.example.com
STORAGE_BUCKET=mangafedi-assets
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_REGION=auto
STORAGE_PUBLIC_URL=https://cdn.example.com
STORAGE_FORCE_PATH_STYLE=false               # true for MinIO

# Backup storage (separate private bucket or prefix)
BACKUP_STORAGE_BUCKET=mangafedi-backups
BACKUP_STORAGE_PREFIX=db/

# Security
SESSION_SECRET=                 # 64 random bytes, hex-encoded
PORTABLE_KEY_HMAC_SECRET=       # 32 random bytes — used in key derivation

# Image processing
IMAGE_MAX_UPLOAD_MB=50
IMAGE_PROCESSING_CONCURRENCY=2  # Simultaneous archiveIngest or imageProcess jobs
IMAGE_MAX_DIMENSION_PX=4000     # Hard cap on input image dimensions to prevent OOM

# Archive upload
ARCHIVE_MAX_UPLOAD_MB=200       # CBZ/ZIP max size
ARCHIVE_MAX_PAGES=500           # Max pages per archive upload

# Federation
FEDERATION_WORKER_CONCURRENCY=4
FEDERATION_MAX_OUTBOUND_PER_DOMAIN_PER_MINUTE=60

# Identity Registry (optional)
IDENTITY_REGISTRY_URL=
IDENTITY_REGISTRY_API_KEY=

# Feature flags
ENABLE_REGISTRATION=true
ENABLE_FEDERATION=true
ENABLE_UPLOAD=true
ENABLE_ARCHIVE_UPLOAD=true

# ─────────────────────────────────────────────────
# TIER 2 — RUNTIME CONFIG (set in DB via admin API)
# ─────────────────────────────────────────────────
# instance_name, instance_description, instance_terms_url,
# instance_contact_email, default_language, allow_nsfw,
# require_email_verification, max_series_per_user,
# allowed_content_types, custom_css, announcement
```

### 4.2 `config.ts`

```typescript
// src/config.ts
import { z } from 'zod'

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  baseUrl: z.string().url(),
  runMode: z.enum(['all', 'web', 'worker']).default('all'),

  db: z.object({
    primaryUrl: z.string(),
    replicaUrl: z.string().optional(),
    // V3: direct connection for federation queue — bypasses PgBouncer
    queueUrl: z.string(),
  }),

  queue: z.object({
    backend: z.enum(['postgres', 'redis']).default('postgres'),
    redisUrl: z.string().optional(),
  }),

  storage: z.object({
    endpoint: z.string().url(),
    bucket: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    region: z.string().default('auto'),
    publicUrl: z.string().url(),
    forcePathStyle: z.coerce.boolean().default(false),
    backupBucket: z.string(),
    backupPrefix: z.string().default('db/'),
  }),

  security: z.object({
    sessionSecret: z.string().min(32),
    portableKeyHmacSecret: z.string().min(32),
  }),

  images: z.object({
    maxUploadMb: z.coerce.number().default(50),
    processingConcurrency: z.coerce.number().default(2),
    maxDimensionPx: z.coerce.number().default(4000),
  }),

  archive: z.object({
    maxUploadMb: z.coerce.number().default(200),
    maxPages: z.coerce.number().default(500),
  }),

  federation: z.object({
    workerConcurrency: z.coerce.number().default(4),
    maxOutboundPerDomainPerMinute: z.coerce.number().default(60),
  }),

  features: z.object({
    registration: z.coerce.boolean().default(true),
    federation: z.coerce.boolean().default(true),
    upload: z.coerce.boolean().default(true),
    archiveUpload: z.coerce.boolean().default(true),
  }),
})

export const config = configSchema.parse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  baseUrl: process.env.BASE_URL,
  runMode: process.env.RUN_MODE,
  db: {
    primaryUrl: process.env.DATABASE_PRIMARY_URL,
    replicaUrl: process.env.DATABASE_REPLICA_URL || undefined,
    queueUrl: process.env.DATABASE_QUEUE_URL,
  },
  queue: {
    backend: process.env.QUEUE_BACKEND,
    redisUrl: process.env.REDIS_URL || undefined,
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT,
    bucket: process.env.STORAGE_BUCKET,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    region: process.env.STORAGE_REGION,
    publicUrl: process.env.STORAGE_PUBLIC_URL,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE,
    backupBucket: process.env.BACKUP_STORAGE_BUCKET,
    backupPrefix: process.env.BACKUP_STORAGE_PREFIX,
  },
  security: {
    sessionSecret: process.env.SESSION_SECRET!,
    portableKeyHmacSecret: process.env.PORTABLE_KEY_HMAC_SECRET!,
  },
  images: {
    maxUploadMb: process.env.IMAGE_MAX_UPLOAD_MB,
    processingConcurrency: process.env.IMAGE_PROCESSING_CONCURRENCY,
    maxDimensionPx: process.env.IMAGE_MAX_DIMENSION_PX,
  },
  archive: {
    maxUploadMb: process.env.ARCHIVE_MAX_UPLOAD_MB,
    maxPages: process.env.ARCHIVE_MAX_PAGES,
  },
  federation: {
    workerConcurrency: process.env.FEDERATION_WORKER_CONCURRENCY,
    maxOutboundPerDomainPerMinute: process.env.FEDERATION_MAX_OUTBOUND_PER_DOMAIN_PER_MINUTE,
  },
  features: {
    registration: process.env.ENABLE_REGISTRATION,
    federation: process.env.ENABLE_FEDERATION,
    upload: process.env.ENABLE_UPLOAD,
    archiveUpload: process.env.ENABLE_ARCHIVE_UPLOAD,
  },
})

export type Config = typeof config
```

---

## 5. Database Schema

### 5.1 `drizzle.config.ts`

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'
import { config } from './src/config'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use primary URL directly (not PgBouncer) for migrations
    url: process.env.DATABASE_QUEUE_URL ?? config.db.queueUrl,
  },
})
```

### 5.2 Complete Drizzle Schema

```typescript
// src/db/schema.ts
import {
  pgTable, text, integer, boolean, timestamp, jsonb,
  uuid, real, index, uniqueIndex, primaryKey
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

// V3: UUIDv7 is time-sorted (monotonically increasing), which eliminates the
// B-tree index fragmentation caused by random UUIDv4. Use $defaultFn(() => uuidv7())
// on all high-churn tables (pages, chapters, comments, upload_sessions).
// Low-churn tables (users, series, groups) may safely remain as .defaultRandom()
// for simplicity, but UUIDv7 is used everywhere for consistency.

// ─── INSTANCE CONFIG ────────────────────────────────────────────────────────

export const instanceConfig = pgTable('instance_config', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull().default('MangaFedi Instance'),
  description: text('description').notNull().default(''),
  termsUrl: text('terms_url'),
  contactEmail: text('contact_email'),
  defaultLanguage: text('default_language').notNull().default('en'),
  allowNsfw: boolean('allow_nsfw').notNull().default(false),
  requireEmailVerification: boolean('require_email_verification').notNull().default(false),
  maxSeriesPerUser: integer('max_series_per_user').notNull().default(50),
  allowedContentTypes: jsonb('allowed_content_types').$type<string[]>().notNull().default(['manga','manhwa','manhua']),
  customCss: text('custom_css').notNull().default(''),
  announcement: text('announcement').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── USERS ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  username: text('username').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarStorageKey: text('avatar_storage_key'),
  bannerStorageKey: text('banner_storage_key'),

  role: text('role').notNull().default('user'),

  // ActivityPub
  actorUri: text('actor_uri').notNull(),
  inboxUri: text('inbox_uri').notNull(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),       // AES-256 encrypted at rest

  // Portable identity
  portablePublicKey: text('portable_public_key').notNull(),
  portableKeyFingerprint: text('portable_key_fingerprint').notNull(),
  knownActorUris: jsonb('known_actor_uris').$type<string[]>().notNull().default([]),

  isActive: boolean('is_active').notNull().default(true),
  isBanned: boolean('is_banned').notNull().default(false),
  banReason: text('ban_reason'),
  emailVerified: boolean('email_verified').notNull().default(false),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  usernameIdx: uniqueIndex('users_username_idx').on(t.username),
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
  actorUriIdx: uniqueIndex('users_actor_uri_idx').on(t.actorUri),
  fingerprintIdx: uniqueIndex('users_fingerprint_idx').on(t.portableKeyFingerprint),
}))

// ─── SESSIONS ───────────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}))

// ─── API TOKENS ─────────────────────────────────────────────────────────────

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tokenHashIdx: uniqueIndex('api_tokens_hash_idx').on(t.tokenHash),
  userIdx: index('api_tokens_user_idx').on(t.userId),
}))

// ─── SCANLATION GROUPS ───────────────────────────────────────────────────────

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description').notNull().default(''),
  website: text('website'),
  avatarStorageKey: text('avatar_storage_key'),

  actorUri: text('actor_uri').notNull(),
  inboxUri: text('inbox_uri').notNull(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),

  portablePublicKey: text('portable_public_key').notNull(),
  portableKeyFingerprint: text('portable_key_fingerprint').notNull(),
  knownActorUris: jsonb('known_actor_uris').$type<string[]>().notNull().default([]),

  ownerId: uuid('owner_id').notNull().references(() => users.id),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('groups_slug_idx').on(t.slug),
  actorUriIdx: uniqueIndex('groups_actor_uri_idx').on(t.actorUri),
}))

export const groupMembers = pgTable('group_members', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.groupId, t.userId] }),
}))

// ─── SERIES ─────────────────────────────────────────────────────────────────

export const series = pgTable('series', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  alternativeTitles: jsonb('alternative_titles').$type<string[]>().notNull().default([]),
  description: text('description').notNull().default(''),
  coverStorageKey: text('cover_storage_key'),
  coverVersion: integer('cover_version').notNull().default(1),

  contentType: text('content_type').notNull(),
  readingDirection: text('reading_direction').notNull(),
  status: text('status').notNull().default('ongoing'),
  originalLanguage: text('original_language').notNull(),
  isNsfw: boolean('is_nsfw').notNull().default(false),

  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  genres: jsonb('genres').$type<string[]>().notNull().default([]),
  authors: jsonb('authors').$type<string[]>().notNull().default([]),
  artists: jsonb('artists').$type<string[]>().notNull().default([]),
  year: integer('year'),

  actorUri: text('actor_uri').notNull(),
  inboxUri: text('inbox_uri').notNull(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),

  portablePublicKey: text('portable_public_key').notNull(),
  portableKeyFingerprint: text('portable_key_fingerprint').notNull(),
  knownActorUris: jsonb('known_actor_uris').$type<string[]>().notNull().default([]),

  uploaderId: uuid('uploader_id').notNull().references(() => users.id),

  followerCount: integer('follower_count').notNull().default(0),
  chapterCount: integer('chapter_count').notNull().default(0),

  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),

  searchVector: text('search_vector'),  // tsvector — maintained by trigger
}, (t) => ({
  slugIdx: uniqueIndex('series_slug_idx').on(t.slug),
  actorUriIdx: uniqueIndex('series_actor_uri_idx').on(t.actorUri),
  fingerprintIdx: uniqueIndex('series_fingerprint_idx').on(t.portableKeyFingerprint),
}))

// ─── CHAPTERS ────────────────────────────────────────────────────────────────

export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  seriesId: uuid('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),

  chapterNumber: text('chapter_number').notNull(),
  sortOrder: real('sort_order').notNull(),
  volumeNumber: text('volume_number'),
  title: text('title'),
  language: text('language').notNull().default('en'),

  pageCount: integer('page_count').notNull().default(0),

  activityPubObjectUri: text('activity_pub_object_uri'),

  uploaderId: uuid('uploader_id').notNull().references(() => users.id),

  isDeleted: boolean('is_deleted').notNull().default(false),
  publishedAt: timestamp('published_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  seriesOrderIdx: index('chapters_series_order_idx').on(t.seriesId, t.sortOrder),
  seriesLangIdx: index('chapters_series_lang_idx').on(t.seriesId, t.language),
}))

// ─── PAGES ───────────────────────────────────────────────────────────────────

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull(),

  originalStorageKey: text('original_storage_key').notNull(),
  webpStorageKey: text('webp_storage_key'),
  mobileStorageKey: text('mobile_storage_key'),

  width: integer('width').notNull().default(0),
  height: integer('height').notNull().default(0),
  blurhash: text('blurhash'),

  processingStatus: text('processing_status').notNull().default('pending'),
  // 'pending' | 'processing' | 'complete' | 'failed'

  version: integer('version').notNull().default(1),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  chapterOrderIdx: index('pages_chapter_order_idx').on(t.chapterId, t.pageNumber),
}))

// ─── FOLLOWS ─────────────────────────────────────────────────────────────────

export const seriesFollows = pgTable('series_follows', {
  seriesId: uuid('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  followerActorUri: text('follower_actor_uri').notNull(),
  followerUserId: uuid('follower_user_id').references(() => users.id, { onDelete: 'cascade' }),
  isLocal: boolean('is_local').notNull().default(true),
  followedAt: timestamp('followed_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.seriesId, t.followerActorUri] }),
  seriesIdx: index('series_follows_series_idx').on(t.seriesId),
}))

export const userFollows = pgTable('user_follows', {
  followingActorUri: text('following_actor_uri').notNull(),
  followerActorUri: text('follower_actor_uri').notNull(),
  followedAt: timestamp('followed_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.followingActorUri, t.followerActorUri] }),
}))

// ─── LIBRARY ──────────────────────────────────────────────────────────────────

export const library = pgTable('library', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('reading'),
  addedAt: timestamp('added_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.seriesId] }),
  userIdx: index('library_user_idx').on(t.userId),
}))

// ─── READING PROGRESS ────────────────────────────────────────────────────────

export const readingProgress = pgTable('reading_progress', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull().default(1),
  completed: boolean('completed').notNull().default(false),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.chapterId] }),
  userIdx: index('progress_user_idx').on(t.userId),
}))

// ─── COMMENTS ────────────────────────────────────────────────────────────────

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),

  content: text('content').notNull(),
  actorUri: text('actor_uri').notNull(),
  authorDisplayName: text('author_display_name').notNull(),
  authorAvatarUrl: text('author_avatar_url'),

  // null for remote actors without portable identity (Mastodon users, etc.)
  portableKeyFingerprint: text('portable_key_fingerprint'),

  activityPubObjectUri: text('activity_pub_object_uri'),
  isLocal: boolean('is_local').notNull().default(true),

  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  chapterIdx: index('comments_chapter_idx').on(t.chapterId, t.createdAt),
  fingerprintIdx: index('comments_fingerprint_idx').on(t.portableKeyFingerprint),
  actorIdx: index('comments_actor_idx').on(t.actorUri),
}))

// ─── REMOTE INSTANCE HEALTH ──────────────────────────────────────────────────

export const remoteInstanceHealth = pgTable('remote_instance_health', {
  domain: text('domain').primaryKey(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  backoffUntil: timestamp('backoff_until'),
  lastAttemptAt: timestamp('last_attempt_at'),
  lastSuccessAt: timestamp('last_success_at'),
})

// ─── MODERATION ──────────────────────────────────────────────────────────────

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  reporterUserId: uuid('reporter_user_id').references(() => users.id),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('open'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const instanceBlocks = pgTable('instance_blocks', {
  domain: text('domain').primaryKey(),
  reason: text('reason'),
  blockedAt: timestamp('blocked_at').notNull().defaultNow(),
  blockedBy: uuid('blocked_by').references(() => users.id),
})

export const takedowns = pgTable('takedowns', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  claimantName: text('claimant_name').notNull(),
  claimantEmail: text('claimant_email').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  actionedBy: uuid('actioned_by').references(() => users.id),
  actionedAt: timestamp('actioned_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── UPLOAD SESSIONS ─────────────────────────────────────────────────────────

export const uploadSessions = pgTable('upload_sessions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  userId: uuid('user_id').notNull().references(() => users.id),
  chapterId: uuid('chapter_id').references(() => chapters.id),
  status: text('status').notNull().default('pending'),
  // 'pending' | 'uploading' | 'processing' | 'complete' | 'failed'
  uploadType: text('upload_type').notNull().default('individual'), // 'individual' | 'archive'
  totalPages: integer('total_pages').notNull().default(0),
  processedPages: integer('processed_pages').notNull().default(0),

  // V3: storage key for the uploaded archive file (archive uploads only)
  archiveStorageKey: text('archive_storage_key'),

  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

### 5.3 Required SQL Migrations

```sql
-- Full-text search on series
ALTER TABLE series ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS series_search_idx ON series USING GIN(search_vector);

-- Partial index for active series
CREATE INDEX IF NOT EXISTS series_active_idx ON series(created_at DESC)
  WHERE is_deleted = false;

-- Partial index for active chapters
CREATE INDEX IF NOT EXISTS chapters_active_idx ON chapters(series_id, sort_order)
  WHERE is_deleted = false;

-- GIN indexes for JSONB array filtering
CREATE INDEX IF NOT EXISTS series_tags_gin_idx    ON series USING GIN(tags);
CREATE INDEX IF NOT EXISTS series_genres_gin_idx  ON series USING GIN(genres);
CREATE INDEX IF NOT EXISTS series_authors_gin_idx ON series USING GIN(authors);
CREATE INDEX IF NOT EXISTS series_artists_gin_idx ON series USING GIN(artists);

-- Denormalization triggers

CREATE OR REPLACE FUNCTION update_series_follower_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE series SET follower_count = follower_count + 1 WHERE id = NEW.series_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series SET follower_count = GREATEST(0, follower_count - 1) WHERE id = OLD.series_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER series_follower_count_trigger
  AFTER INSERT OR DELETE ON series_follows
  FOR EACH ROW EXECUTE FUNCTION update_series_follower_count();

CREATE OR REPLACE FUNCTION update_series_chapter_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE series SET chapter_count = chapter_count + 1 WHERE id = NEW.series_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_deleted = true AND OLD.is_deleted = false THEN
    UPDATE series SET chapter_count = GREATEST(0, chapter_count - 1) WHERE id = NEW.series_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series SET chapter_count = GREATEST(0, chapter_count - 1) WHERE id = OLD.series_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER series_chapter_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON chapters
  FOR EACH ROW EXECUTE FUNCTION update_series_chapter_count();

-- Autovacuum tuning for high-churn tables
ALTER TABLE reading_progress SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE sessions SET (autovacuum_vacuum_scale_factor = 0.01);
ALTER TABLE pages SET (autovacuum_vacuum_scale_factor = 0.01);
```

### 5.4 UUID Strategy Note

**V3:** All tables use `$defaultFn(() => uuidv7())` via the application layer. UUIDv7 is a time-sorted, monotonically increasing UUID format (RFC 9562). Unlike UUIDv4 (fully random), UUIDv7 inserts at the end of B-tree indexes, producing sequential pages and dramatically reducing index fragmentation and write amplification over time on high-churn tables like `pages`, `comments`, and `reading_progress`.

Postgres 17 adds native `gen_uuidv7()` support, but since this project targets Postgres 16, the `uuidv7` npm package generates compliant values in the application layer. This is equivalent in practice.

---

## 6. ActivityPub & Federation Layer

### 6.1 Fedify Setup and Hono Integration Order

> **CRITICAL:** Fedify middleware MUST be mounted BEFORE all application routes. If mounted after, ActivityPub requests to `/users/:username` will be caught by your user profile routes and return HTML instead of JSON-LD — silently breaking all federation.

```typescript
// src/webServer.ts — CORRECT MOUNT ORDER
import { Hono } from 'hono'
import { federation } from './federation'
import { createFederationMiddleware } from '@fedify/hono'
import { apiRouter } from './api'
import { webRouter } from './web'
import { AppError } from './lib/errors'

export function buildApp() {
  const app = new Hono()

  // 1. Fedify FIRST
  app.use(createFederationMiddleware(federation))

  // 2. Global error handler — converts AppError to structured JSON
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: err.message, code: err.code },
        err.status as 400 | 401 | 403 | 404 | 410 | 413 | 422 | 429 | 500 | 503
      )
    }
    console.error('Unhandled error:', err)
    return c.json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }, 500)
  })

  app.notFound((c) => {
    if (c.req.header('Accept')?.includes('text/html')) {
      return c.html('<h1>404 — Not Found</h1>', 404)
    }
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  })

  // 3. API routes
  app.route('/api/v1', apiRouter)

  // 4. Web routes last
  app.route('/', webRouter)

  return app
}
```

```typescript
// src/federation/index.ts
// V3: createFederation uses db.queue (direct connection) — NOT db.primary (PgBouncer)
// LISTEN/NOTIFY requires a persistent stateful connection incompatible with transaction pooling.
import { createFederation } from '@fedify/fedify'
import { PostgresKvStore, PostgresMessageQueue } from '@fedify/postgres'
import { db } from '../db'
import { config } from '../config'

export const federation = createFederation<{ userId?: string; seriesId?: string }>({
  kv: new PostgresKvStore(db.queue),
  queue: config.queue.backend === 'redis'
    ? createRedisQueue()
    : new PostgresMessageQueue(db.queue),
  allowPrivateAddress: config.nodeEnv === 'development',
})
```

### 6.2 Actor Types

**User actors** (`Person`): `{BASE_URL}/users/{username}`
**Series actors** (`Application`): `{BASE_URL}/series/{slug}`
**Group actors** (`Group`): `{BASE_URL}/groups/{slug}`

### 6.3 Reading Direction Defaults

```typescript
// src/services/series.ts
export function inferReadingDirection(contentType: string): 'rtl' | 'ltr' {
  return contentType === 'manga' ? 'rtl' : 'ltr'
}
```

### 6.4 Federation Events

**Outgoing:**

| Trigger | Activity |
|---|---|
| Chapter published | `Create(MangaChapter)` from series actor to all followers |
| Series metadata updated | `Update(Application)` |
| User profile updated | `Update(Person)` |
| User account recovered | `Update(Person)` with `alsoKnownAs` |
| User posts comment | `Create(Note)` from user actor, `inReplyTo` chapter object |
| Comment deleted | `Delete(Note)` tombstone |
| Series soft-deleted | `Delete(Application)` tombstone |
| User follows series | `Follow` to series actor |
| Instance migration | `Move` with `movedTo` + `alsoKnownAs` |

**Incoming:**

| Activity | Handler |
|---|---|
| `Follow` to series actor | Accept, store follower |
| `Follow` to user actor | Accept or queue for manual approval |
| `Undo(Follow)` | Remove follow |
| `Create(Note)` | Store as federated comment |
| `Delete(Note)` | Soft-delete cached comment |
| `Like` on chapter | Store, increment count |
| `Announce` on chapter | Store boost |
| `Move` | Update cached actor, re-map `knownActorUris` |

### 6.5 Chapter Object Format

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://instance.example.com/ns"
  ],
  "type": ["MangaChapter", "Article"],
  "id": "https://instance.com/chapters/{id}/activity",
  "attributedTo": "https://instance.com/series/{slug}",
  "name": "One Piece — Chapter 127: The New World",
  "summary": "One Piece released Chapter 127",
  "content": "One Piece Chapter 127 is now available to read.",
  "url": "https://instance.com/series/{slug}/chapters/127",
  "chapterNumber": "127",
  "volumeNumber": "14",
  "pageCount": 22,
  "readingDirection": "rtl",
  "language": "en",
  "seriesActor": "https://instance.com/series/{slug}",
  "image": {
    "type": "Image",
    "mediaType": "image/webp",
    "url": "https://cdn.example.com/series/{slug}/covers/thumb.webp"
  },
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://instance.com/series/{slug}/followers"],
  "sensitive": false,
  "published": "2024-01-15T10:00:00Z"
}
```

> **Lemmy/Kbin compatibility:** The dual `type: ["MangaChapter", "Article"]` ensures federated discussion platforms treat chapter announcements as articles. Replies arriving from Lemmy/Kbin arrive as `Create(Note)` with `inReplyTo` — store these as normal federated comments against that chapter.

### 6.6 Tombstoning on Soft-Delete

When a series is soft-deleted, the local `knownActorUris` cache for that actor must also be cleared so an account recovery attempt cannot re-bind to a tombstoned actor URI:

```typescript
// src/services/series.ts
async function deleteSeries(seriesId: string) {
  await db.primary.transaction(async (tx) => {
    // 1. Mark deleted + clear knownActorUris to prevent recovery re-binding
    await tx.update(series)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        knownActorUris: [],  // V3: prevents re-binding to tombstoned actor
      })
      .where(eq(series.id, seriesId))
    // 2. Federation outbox sends Delete(Application) tombstone
  })
}

// src/federation/inbox.ts — reject incoming activities for tombstoned series
async function validateSeriesNotTombstoned(seriesActorUri: string): Promise<void> {
  const row = await db.replica
    .select({ isDeleted: series.isDeleted })
    .from(series)
    .where(eq(series.actorUri, seriesActorUri))
    .limit(1)

  if (row[0]?.isDeleted) {
    throw new AppError('GONE', 'Series has been removed', 410)
  }
}
```

### 6.7 Shared Inbox Optimisation

Fedify's fanout automatically groups per-domain deliveries and uses shared inbox URLs where available. Do **not** implement custom batching logic — it will conflict with Fedify's internal queue.

### 6.8 Circuit Breaker for Outbound Federation

```typescript
// src/federation/outbox.ts
async function shouldAttemptDelivery(domain: string): Promise<boolean> {
  const health = await db.replica
    .select()
    .from(remoteInstanceHealth)
    .where(eq(remoteInstanceHealth.domain, domain))
    .limit(1)

  if (!health[0]?.backoffUntil) return true
  return health[0].backoffUntil < new Date()
}

async function recordDeliveryResult(domain: string, success: boolean) {
  if (success) {
    await db.primary.insert(remoteInstanceHealth)
      .values({ domain, consecutiveFailures: 0, lastSuccessAt: new Date() })
      .onConflictDoUpdate({
        target: remoteInstanceHealth.domain,
        set: { consecutiveFailures: 0, lastSuccessAt: new Date(), backoffUntil: null }
      })
  } else {
    const current = await getHealth(domain)
    const failures = (current?.consecutiveFailures ?? 0) + 1
    const backoffMinutes = [1, 5, 30, 120, 1440][Math.min(failures - 1, 4)]
    const backoffUntil = new Date(Date.now() + backoffMinutes * 60_000)
    await db.primary.insert(remoteInstanceHealth)
      .values({ domain, consecutiveFailures: failures, backoffUntil })
      .onConflictDoUpdate({
        target: remoteInstanceHealth.domain,
        set: { consecutiveFailures: failures, backoffUntil, lastAttemptAt: new Date() }
      })
  }
}
```

---

## 7. API Design & Endpoints

### 7.1 Conventions

- All routes prefixed `/api/v1/`
- All responses JSON
- Success: data object or `{ items, nextCursor, hasMore }` for lists
- Error: `{ error: string, code: string, details?: unknown }`
- Pagination: cursor-based, never offset
- Auth: Bearer token or session cookie (both work transparently)
- `X-Api-Version: 1.0.0` header on every response
- OpenAPI spec: `GET /api/v1/openapi.json`
- API docs UI: `GET /api/v1/docs`

### 7.2 Complete Endpoint List

```
# ── DISCOVERY / SYSTEM ──────────────────────────────────────────
GET  /nodeinfo/2.0
GET  /.well-known/webfinger     (handled by Fedify)
GET  /api/v1/instance
GET  /api/v1/openapi.json
GET  /api/v1/docs

# ── AUTH ────────────────────────────────────────────────────────
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/recover
POST /api/v1/auth/tokens
DELETE /api/v1/auth/tokens/:id

# ── SERIES ──────────────────────────────────────────────────────
GET  /api/v1/series
GET  /api/v1/series/:slug
POST /api/v1/series              [uploader]
PATCH /api/v1/series/:slug       [uploader/mod]
DELETE /api/v1/series/:slug      [uploader/admin]

# ── CHAPTERS ────────────────────────────────────────────────────
GET  /api/v1/series/:slug/chapters
GET  /api/v1/chapters/:id
GET  /api/v1/chapters/:id/pages
POST /api/v1/series/:slug/chapters     [uploader]
PATCH /api/v1/chapters/:id             [uploader]
DELETE /api/v1/chapters/:id            [uploader/admin]

# ── UPLOAD (individual pages) ────────────────────────────────────
POST /api/v1/upload/chapter-init
POST /api/v1/upload/chapter-confirm
GET  /api/v1/upload/status/:sessionId

# ── UPLOAD (archive) ─────────────────────────────────────────────
POST /api/v1/upload/archive-init
POST /api/v1/upload/archive-confirm
GET  /api/v1/upload/status/:sessionId  (same endpoint for both types)

# ── COMMENTS ────────────────────────────────────────────────────
GET  /api/v1/chapters/:id/comments
POST /api/v1/chapters/:id/comments     [auth]
DELETE /api/v1/comments/:id            [auth/mod]
POST /api/v1/comments/:id/report       [auth]

# ── LIBRARY ─────────────────────────────────────────────────────
GET  /api/v1/library                   [auth]
POST /api/v1/library                   [auth]
PATCH /api/v1/library/:seriesId        [auth]
DELETE /api/v1/library/:seriesId       [auth]

# ── READING PROGRESS ────────────────────────────────────────────
GET  /api/v1/progress/:chapterId       [auth]
POST /api/v1/progress                  [auth]
GET  /api/v1/progress/series/:slug     [auth]

# ── USERS ───────────────────────────────────────────────────────
GET  /api/v1/users/:username
GET  /api/v1/users/:username/comments
PATCH /api/v1/users/me                 [auth]

# ── SEARCH ──────────────────────────────────────────────────────
GET  /api/v1/search?q=&type=

# ── SERIES CLAIM ─────────────────────────────────────────────────
POST /api/v1/series/claim              [uploader]

# ── FEDERATION (handled by Fedify) ───────────────────────────────
GET  /users/:username
POST /users/:username/inbox
GET  /users/:username/outbox
GET  /users/:username/followers
GET  /users/:username/following
GET  /series/:slug
POST /series/:slug/inbox
GET  /series/:slug/outbox
GET  /series/:slug/followers
GET  /ns

# ── ADMIN ───────────────────────────────────────────────────────
GET  /api/v1/admin/instance
PATCH /api/v1/admin/instance
GET  /api/v1/admin/users
PATCH /api/v1/admin/users/:id
GET  /api/v1/admin/reports
POST /api/v1/admin/reports/:id/resolve
GET  /api/v1/admin/takedowns
PATCH /api/v1/admin/takedowns/:id
GET  /api/v1/admin/federation/blocks
POST /api/v1/admin/federation/blocks
DELETE /api/v1/admin/federation/blocks/:domain
GET  /api/v1/admin/federation/health
```

### 7.3 Pagination Contract

```typescript
{ items: T[], nextCursor: string | null, hasMore: boolean }
// Request: ?limit=20&cursor=<opaque_base64_string>
// Cursor encodes: { createdAt: string, id: string }
```

---

## 8. Authentication & Identity

### 8.1 Custom Thin Auth Layer

> `better-auth` replaced by ~120-line custom implementation to avoid schema conflicts with Fedify's internal tables.

> **V3 — bcrypt async enforcement:** `bcrypt.hash()` and `bcrypt.compare()` must always be called as `await`ed async operations. Never use `bcrypt.hashSync()` or `bcrypt.compareSync()`. The synchronous variants run on the main event loop thread. Under concurrent login requests — or a brute force attack — they will block the Node.js thread entirely, freezing the ActivityPub inbox queue and taking the instance offline to the fediverse until the backlog clears.

```typescript
// src/lib/auth.ts
import bcrypt from 'bcrypt'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db'
import { users, sessions, apiTokens } from '../db/schema'
import { eq, and, gt, or, isNull } from 'drizzle-orm'
import { AppError } from './errors'

const BCRYPT_ROUNDS = 12
const SESSION_EXPIRY_DAYS = 30
const SESSION_COOKIE_NAME = 'mangafedi_session'

// V3: ONLY use async bcrypt variants. Sync variants block the event loop.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)   // async ✓
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)           // async ✓
}

export function generateSessionId(): string {
  return randomBytes(32).toString('hex')
}

export async function createSession(userId: string): Promise<string> {
  const id = generateSessionId()
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 86_400_000)
  await db.primary.insert(sessions).values({ id, userId, expiresAt })
  return id
}

export async function validateSession(sessionId: string) {
  const rows = await db.replica
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.id, sessionId),
      gt(sessions.expiresAt, new Date())
    ))
    .limit(1)
  return rows[0] ?? null
}

export async function validateApiToken(rawToken: string) {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const rows = await db.replica
    .select({ user: users })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(and(
      eq(apiTokens.tokenHash, tokenHash),
      // V3: expiry check — null means token never expires
      or(
        isNull(apiTokens.expiresAt),
        gt(apiTokens.expiresAt, new Date())
      )
    ))
    .limit(1)

  if (rows[0]) {
    // Non-blocking background update of last_used_at
    db.primary.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.tokenHash, tokenHash))
      .catch(() => {})
  }

  return rows[0]?.user ?? null
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.primary.delete(sessions).where(eq(sessions.id, sessionId))
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  maxAge: SESSION_EXPIRY_DAYS * 86_400,
  path: '/',
}
```

### 8.2 Auth Middleware

```typescript
// src/api/middleware.ts
import { cors } from 'hono/cors'
import { config } from '../config'
import { validateSession, validateApiToken } from '../lib/auth'

export const apiCors = cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['X-Api-Version'],
})

export const authCors = cors({
  origin: config.baseUrl,
  credentials: true,
})

export async function resolveUser(c: Context) {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return validateApiToken(authHeader.slice(7))
  }
  const sessionId = getCookie(c, 'mangafedi_session')
  if (sessionId) {
    const row = await validateSession(sessionId)
    return row?.user ?? null
  }
  return null
}

export async function requireAuth(c: Context, next: Next) {
  const user = await resolveUser(c)
  if (!user) return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401)
  c.set('user', user)
  return next()
}

export function requireRole(role: 'uploader' | 'moderator' | 'admin') {
  const hierarchy = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    if (!user || hierarchy[user.role as keyof typeof hierarchy] < hierarchy[role]) {
      return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403)
    }
    return next()
  }
}
```

### 8.3 Role Hierarchy

```
admin > moderator > uploader > user > anonymous
```

- `anonymous`: browse and read only
- `user`: comment, library, reading progress, follow series
- `uploader`: all user + create/upload series and chapters
- `moderator`: all user + delete comments, action reports
- `admin`: full access including instance config and user management

### 8.4 Typed Error Classes

```typescript
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400
  ) { super(message) }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404)
  }
}

export class ForbiddenError extends AppError {
  constructor() { super('FORBIDDEN', 'Insufficient permissions', 403) }
}
```

Service functions throw these freely. The `app.onError()` handler in §6.1 catches and converts everything.

---

## 9. Portable Identity & Data Recovery

### 9.1 Seed Phrase Generation

```typescript
// src/lib/crypto.ts
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export function generateUserMnemonic(): string {
  return generateMnemonic(wordlist, 128) // 12 words
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist)
}

export async function derivePortableKeypair(mnemonic: string): Promise<{
  publicKey: string
  fingerprint: string
}> {
  const seed = await mnemonicToSeed(mnemonic)
  const privateKeyBytes = seed.slice(0, 32)
  const publicKeyBytes = await ed.getPublicKey(privateKeyBytes)
  const fingerprint = bytesToHex(sha256(publicKeyBytes).slice(0, 16))
  return {
    publicKey: bytesToHex(publicKeyBytes),
    fingerprint,
  }
}

export async function signWithPortableKey(mnemonic: string, message: Uint8Array): Promise<string> {
  const seed = await mnemonicToSeed(mnemonic)
  const privateKeyBytes = seed.slice(0, 32)
  return bytesToHex(await ed.sign(message, privateKeyBytes))
}

export async function verifyPortableSignature(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string
): Promise<boolean> {
  return ed.verify(signatureHex, message, publicKeyHex)
}
```

### 9.2 Account Recovery Flow

```
POST /api/v1/auth/recover
Body: { mnemonic, newUsername, newEmail, newPassword }

1. Validate mnemonic (BIP-39)
2. Derive portablePublicKey + portableKeyFingerprint
3. Query users WHERE portable_key_fingerprint = $fingerprint
4. Create new user record with derived keys + new credentials
5. Set knownActorUris = [old actor URI, ...previous known URIs]
6. Send Update(Person) with alsoKnownAs: all knownActorUris
7. Return new session token
```

### 9.3 Remote User Comments

All comment history queries use `portableKeyFingerprint`, never `actorUri`. Remote actors (Mastodon users, etc.) have `portableKeyFingerprint = null` — correct behaviour; they appear in chapter comment threads but not in cross-instance comment history views.

### 9.4 Series Recovery Flow

```
POST /api/v1/series/claim
Body: { mnemonic }
Auth: uploader role required

1. Derive fingerprint from mnemonic
2. Find series WHERE portable_key_fingerprint = $fingerprint AND is_deleted = false
   (tombstoned series cannot be re-claimed — knownActorUris was cleared on delete)
3. Create new series actor on this instance
4. Set knownActorUris = [old URI, ...]
5. Send Update(Application) with alsoKnownAs to all known followers
6. CDN image URLs unchanged — no re-upload needed
```

---

## 10. Image Storage & Processing

### 10.1 Storage Path Structure

```
series/{seriesId}/covers/original.{ext}
series/{seriesId}/covers/full.webp
series/{seriesId}/covers/thumb.webp

chapters/{chapterId}/pages/{pageNumber:03d}/original.{ext}
chapters/{chapterId}/pages/{pageNumber:03d}/full.webp
chapters/{chapterId}/pages/{pageNumber:03d}/mobile.webp

uploads/sessions/{sessionId}/archive.{ext}   ← archive staging
```

### 10.2 CDN URL Construction with Cache-Busting

```typescript
// src/storage/keys.ts
export function pagePublicUrl(publicBase: string, storageKey: string, version = 1): string {
  const vParam = version > 1 ? `?v=${version}` : ''
  return `${publicBase}/${storageKey}${vParam}`
}

export function coverPublicUrl(publicBase: string, storageKey: string, version = 1): string {
  const vParam = version > 1 ? `?v=${version}` : ''
  return `${publicBase}/${storageKey}${vParam}`
}
```

### 10.3 Individual Page Upload Flow

```
1. POST /api/v1/upload/chapter-init
   Body: { seriesSlug, chapterNumber, pageCount, filenames }

2. Server creates chapter record (pageCount=0) + upload session
3. Server creates pages records (processingStatus='pending')
   [Page records MUST exist before presigned URLs are returned]
4. Returns: { sessionId, presignedUrls: { pageNumber, url }[] }

5. Client uploads files directly to S3
6. POST /api/v1/upload/chapter-confirm { sessionId }
7. Server enqueues imageProcess job per page
8. Client polls status until all pages 'complete'
   [pageCount + federation announce fire ONLY after all pages complete]
```

### 10.4 Archive (CBZ/ZIP) Upload Flow — Single-Pass Processing

> **V3 — eliminated double-trip:** The previous design had `archiveIngest` upload raw extracted images to S3, then enqueue a separate `imageProcess` job per page that would download them again. This paid for S3 egress + ingress twice per page with no benefit. The corrected flow pipes each extracted file buffer directly through Sharp in the same job, generating all variants in one pass. No `imageProcess` jobs are enqueued for archive uploads.

```
1. POST /api/v1/upload/archive-init
   Body: { seriesSlug, chapterNumber, filename, fileSizeBytes }

2. Server validates fileSizeBytes <= ARCHIVE_MAX_UPLOAD_MB
3. Server creates chapter record + upload session (uploadType='archive')
4. Returns: { sessionId, presignedUrl }

5. Client uploads archive to S3 at uploads/sessions/{sessionId}/archive.zip
6. Server stores archiveStorageKey on upload session record

7. POST /api/v1/upload/archive-confirm { sessionId }
8. Server enqueues archiveIngest job

9. archiveIngest worker (single pass):
   a. Download archive buffer from S3
   b. Open with unzipper
   c. Filter entries:
      - Skip directories, __MACOSX/, .DS_Store, Thumbs.db, ComicInfo.xml,
        hidden files (SKIP_PATTERNS) — silently skip, no error thrown
      - Keep entries matching IMAGE_EXTENSIONS
   d. Sort remaining entries by filename (natural sort for page order)
   e. Validate page count <= ARCHIVE_MAX_PAGES
   f. For each image entry — SEQUENTIALLY (no concurrency within job):
      i.   Load entry buffer
      ii.  Validate magic bytes — if invalid, log warn and skip
      iii. Check dimensions via sharp metadata — reject if > IMAGE_MAX_DIMENSION_PX
      iv.  Generate full.webp + mobile.webp via Sharp
      v.   Generate blurhash
      vi.  Upload original + full.webp + mobile.webp to S3 in parallel
      vii. Insert pages record (processingStatus='complete')
   g. Set chapter.pageCount, session.status='complete'
   h. Trigger Create(MangaChapter) federation announce

10. Client polls /api/v1/upload/status/:sessionId
```

```typescript
// src/worker/jobs/archiveIngest.ts
import unzipper from 'unzipper'
import { encode } from 'blurhash'
import sharp from 'sharp'
import path from 'node:path'
import { config } from '../../config'
import { AppError } from '../../lib/errors'

const SKIP_PATTERNS = [
  /^__MACOSX\//i,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
  /ComicInfo\.xml$/i,
  /^\./,  // hidden files
]

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i

function safePath(entryName: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, entryName)
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new AppError('VALIDATION_ERROR', `Zip-slip attempt: ${entryName}`, 400)
  }
  return resolved
}

async function processArchive(sessionId: string): Promise<void> {
  const session = await getUploadSession(sessionId)
  const archiveBuffer = await downloadFromStorage(session.archiveStorageKey!)
  const directory = await unzipper.Open.buffer(archiveBuffer)

  const imageEntries = directory.files
    .filter(entry => {
      if (entry.type !== 'File') return false
      if (SKIP_PATTERNS.some(p => p.test(entry.path))) return false
      return IMAGE_EXTENSIONS.test(entry.path)
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  if (imageEntries.length > config.archive.maxPages) {
    throw new AppError('ARCHIVE_TOO_MANY_PAGES',
      `Archive has ${imageEntries.length} images, max is ${config.archive.maxPages}`, 422)
  }

  for (let i = 0; i < imageEntries.length; i++) {
    const buffer = await imageEntries[i].buffer()

    if (!isValidImageMagicBytes(buffer)) {
      console.warn(`Non-image magic bytes in entry: ${imageEntries[i].path} — skipping`)
      continue
    }

    await processAndStorePageBuffer({
      buffer,
      chapterId: session.chapterId!,
      pageNumber: i + 1,
    })
  }

  await finaliseChapter(session.chapterId!)
}
```

> **Memory note:** Sequential processing within a job (step f above) is intentional — it bounds peak memory to one image at a time regardless of archive size. `IMAGE_PROCESSING_CONCURRENCY` controls how many concurrent `archiveIngest` jobs run across the worker pool; it does not change per-job behaviour.

### 10.5 Image Processing Job (Individual Pages, with OOM Guard)

```typescript
// src/worker/jobs/imageProcess.ts
import sharp from 'sharp'
import { encode } from 'blurhash'  // V3: correct export name (not encodeBase83)
import { config } from '../../config'

async function processPage(pageId: string): Promise<void> {
  const page = await getPage(pageId)
  const originalBuffer = await downloadFromStorage(page.originalStorageKey)

  const metadata = await sharp(originalBuffer).metadata()
  const inputWidth = metadata.width ?? 0
  const inputHeight = metadata.height ?? 0

  if (inputWidth > config.images.maxDimensionPx || inputHeight > config.images.maxDimensionPx) {
    await updatePage(pageId, { processingStatus: 'failed' })
    throw new AppError(
      'PROCESSING_FAILED',
      `Image (${inputWidth}x${inputHeight}) exceeds ${config.images.maxDimensionPx}px limit`,
      400
    )
  }

  const image = sharp(originalBuffer, {
    limitInputPixels: config.images.maxDimensionPx * config.images.maxDimensionPx,
  })

  const [fullWebp, mobileWebp] = await Promise.all([
    image.clone()
      .resize({ width: Math.min(inputWidth, 2000), withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer(),
    image.clone()
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
  ])

  const tiny = await image.clone()
    .resize(64, 64, { fit: 'inside' })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true })

  const blurhash = encode(
    new Uint8ClampedArray(tiny.data),
    tiny.info.width,
    tiny.info.height,
    4, 4
  )

  const fullKey  = page.originalStorageKey.replace('/original.', '/full.')   + '.webp'
  const mobileKey = page.originalStorageKey.replace('/original.', '/mobile.') + '.webp'

  await Promise.all([
    uploadToStorage(fullKey, fullWebp, 'image/webp'),
    uploadToStorage(mobileKey, mobileWebp, 'image/webp'),
  ])

  await updatePage(pageId, {
    webpStorageKey: fullKey,
    mobileStorageKey: mobileKey,
    width: inputWidth,
    height: inputHeight,
    blurhash,
    processingStatus: 'complete',
  })
}
```

### 10.6 Chapter Sort Order

```typescript
// src/services/chapters.ts
export function computeSortOrder(chapterNumber: string): number {
  const asFloat = parseFloat(chapterNumber)
  if (!isNaN(asFloat)) return asFloat

  const lower = chapterNumber.toLowerCase()
  if (lower.startsWith('ex'))      return 10000 + (parseInt(lower.slice(2)) || 0)
  if (lower.includes('side'))      return 15000
  if (lower.includes('omake'))     return 20000
  if (lower.includes('special'))   return 25000
  return 99999
}
```

---

## 11. Default Frontend

### 11.1 Rendering Approach

All pages are server-rendered Hono JSX. No hydration, no client-side routing, no build step.

```typescript
// src/web/layout.tsx
export const Layout = ({ children, title, instanceCfg }: LayoutProps) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — {instanceCfg.name}</title>
      <link rel="stylesheet" href="/style.css" />
      {instanceCfg.customCss && <style dangerouslySetInnerHTML={{ __html: instanceCfg.customCss }} />}
    </head>
    <body>
      <header class="site-header">
        <nav>
          <a href="/" class="site-title">{instanceCfg.name}</a>
          <a href="/browse">Browse</a>
          <a href="/search">Search</a>
        </nav>
        {instanceCfg.announcement && (
          <div class="announcement">{instanceCfg.announcement}</div>
        )}
      </header>
      <main>{children}</main>
      <footer>
        <p>Powered by MangaFedi · <a href="/api/v1/docs">API</a></p>
      </footer>
    </body>
  </html>
)
```

### 11.2 CSS Architecture

```css
/* public/style.css */

:root {
  --color-bg: #ffffff;
  --color-surface: #f5f5f5;
  --color-border: #dddddd;
  --color-text: #1a1a1a;
  --color-text-muted: #666666;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-danger: #dc2626;
  --font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', monospace;
  --radius: 4px;
  --max-width: 1200px;
  --spacing: 1rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f0f0f;
    --color-surface: #1a1a1a;
    --color-border: #333333;
    --color-text: #e5e5e5;
    --color-text-muted: #999999;
    --color-primary: #3b82f6;
    --color-primary-hover: #60a5fa;
    --color-danger: #f87171;
  }
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); line-height: 1.6; }
a { color: var(--color-primary); text-decoration: none; }
a:hover { color: var(--color-primary-hover); text-decoration: underline; }
img { max-width: 100%; display: block; }

.container { max-width: var(--max-width); margin: 0 auto; padding: 0 var(--spacing); }
.site-header { border-bottom: 1px solid var(--color-border); padding: var(--spacing); }
.site-header nav { display: flex; gap: 1.5rem; align-items: center; }
.site-title { font-weight: 700; font-size: 1.1rem; color: var(--color-text); }
main { padding: var(--spacing); max-width: var(--max-width); margin: 0 auto; }

.series-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--spacing); }
@media (min-width: 768px) { .series-grid { grid-template-columns: repeat(4, 1fr); } }
.series-card { border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
.series-card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; background: var(--color-surface); }
.series-card-body { padding: 0.5rem; }
.series-card-title { font-size: 0.9rem; font-weight: 600; line-height: 1.3; }
.series-card-meta { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.25rem; }

.chapter-list { border-collapse: collapse; width: 100%; }
.chapter-list th, .chapter-list td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--color-border); }
.chapter-list th { font-size: 0.8rem; color: var(--color-text-muted); }

.form-group { margin-bottom: var(--spacing); }
label { display: block; font-size: 0.9rem; font-weight: 500; margin-bottom: 0.25rem; }
input, select, textarea { width: 100%; padding: 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); font-size: 1rem; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.btn { display: inline-block; padding: 0.5rem 1rem; border-radius: var(--radius); border: none; cursor: pointer; font-size: 1rem; }
.btn-primary { background: var(--color-primary); color: #fff; }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-danger { background: var(--color-danger); color: #fff; }

.announcement { background: var(--color-surface); border-left: 3px solid var(--color-primary); padding: 0.5rem var(--spacing); font-size: 0.9rem; }

#reader { display: flex; flex-direction: column; align-items: center; gap: 0; }
#reader img { max-width: 100%; }
.reader-controls { position: fixed; bottom: 1rem; right: 1rem; display: flex; gap: 0.5rem; }
```

---

## 12. The Reader

### 12.1 Server-Side Data Embedding

```typescript
const readerData = {
  chapterId: chapter.id,
  pages: pages.map(p => ({
    pageNumber: p.pageNumber,
    fullUrl: pagePublicUrl(config.storage.publicUrl, p.webpStorageKey!, p.version),
    mobileUrl: pagePublicUrl(config.storage.publicUrl, p.mobileStorageKey!, p.version),
    width: p.width,
    height: p.height,
    blurhash: p.blurhash,
  })),
  readingDirection: series.readingDirection,
  nextChapterId: nextChapter?.id ?? null,
  prevChapterId: prevChapter?.id ?? null,
  progressUrl: '/api/v1/progress',
  chapterTitle: `${series.title} Ch. ${chapter.chapterNumber}`,
}
// Injected as window.READER_DATA in a <script> tag
```

### 12.2 `reader.js` Feature Set

- Paginated and long-strip modes, toggleable
- Reading direction aware (RTL/LTR)
- Keyboard: ArrowLeft/Right
- Prefetch N+1 and N+2 via `new Image()`
- Touch/swipe gestures (mobile)
- Progress save: debounced 3s `POST /api/v1/progress`
- Responsive: `mobileUrl` on viewport < 768px, `fullUrl` otherwise
- Blurhash placeholder while image loads
- No external dependencies; reads `window.READER_DATA`

---

## 13. Background Workers & Queuing

### 13.1 Startup Orchestration

```typescript
// src/index.ts
async function main() {
  await testConnection()

  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  await migrate(db.primary, { migrationsFolder: './migrations' })

  await ensureInstanceConfigExists()

  if (config.runMode === 'web' || config.runMode === 'all') {
    const { buildApp, startWebServer } = await import('./webServer')
    await startWebServer(buildApp())
    console.log(`✓ Web server listening on :${config.port}`)
  }

  if (config.runMode === 'worker' || config.runMode === 'all') {
    const { startWorker } = await import('./worker')
    await startWorker()
    console.log(`✓ Federation worker started`)
  }
}

main().catch((err) => { console.error('Fatal startup error:', err); process.exit(1) })
```

```typescript
// src/db/index.ts
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { config } from '../config'

// App DB — routed through PgBouncer (transaction mode)
const primaryClient = postgres(config.db.primaryUrl, { max: 10 })
const replicaClient = postgres(config.db.replicaUrl ?? config.db.primaryUrl, { max: 10 })

// Queue DB — DIRECT connection to Postgres (bypasses PgBouncer)
// Required for LISTEN/NOTIFY (used by @fedify/postgres queue)
const queueClient = postgres(config.db.queueUrl, {
  max: 2,            // Only needs a small pool — just for KV store + queue listener
  idle_timeout: 0,   // Keep connections alive for LISTEN
})

export const db = {
  primary: drizzle(primaryClient),
  replica: drizzle(replicaClient),
  queue: drizzle(queueClient),    // V3: used exclusively by federation/index.ts
}

export async function testConnection(): Promise<void> {
  try {
    await db.primary.execute(sql`SELECT 1`)
    console.log('✓ Database connection established')
  } catch (e) {
    console.error('✗ Database connection failed:', e)
    process.exit(1)
  }
}
```

### 13.2 Jobs Summary

**`imageProcess`:** Triggered by individual-page upload confirmation. Processes with OOM guard, generates WebP variants + blurhash. On all pages complete: sets chapter `page_count`, triggers federation `Create(MangaChapter)`.

**`archiveIngest`:** Triggered by archive upload confirmation. Single-pass extraction, filtering, validation, Sharp processing, S3 upload. No secondary `imageProcess` jobs.

**`cleanup`** (hourly `setInterval`):
- Delete expired sessions
- Delete expired upload sessions and orphaned pending page records
- Delete archive staging files from S3 for expired sessions
- Reset circuit breaker backoffs where `backoff_until < now()`

### 13.3 PgBouncer + LISTEN/NOTIFY Incompatibility

> **V3 — critical architecture note.** `@fedify/postgres` uses Postgres `LISTEN/NOTIFY` for its message queue. This mechanism requires a long-lived, stateful TCP connection to Postgres. PgBouncer in `transaction` pool mode (which this project uses) tears down the server-side connection after each transaction, destroying any active `LISTEN` subscriptions. The federation queue would silently stop receiving messages.
>
> **Resolution:** Two separate connection pools. `db.primary` and `db.replica` route through PgBouncer for all normal application queries. `db.queue` connects directly to Postgres at port 5432, bypassing PgBouncer entirely. Only `federation/index.ts` uses `db.queue`. This is the `DATABASE_QUEUE_URL` env var.
>
> If you use Redis as your queue backend (`QUEUE_BACKEND=redis`), this issue does not apply and `DATABASE_QUEUE_URL` is only used for Fedify's KV store (which does not use LISTEN/NOTIFY).

### 13.4 Worker Retry and Dead-Letter Strategy

> **V3 — addition.** The spec previously specified `processingStatus: 'failed'` on page processing errors but did not specify what happens next. Without a retry strategy, a transient S3 timeout causes permanent page failures requiring manual intervention.

```typescript
// In imageProcess and archiveIngest jobs:
// - Transient failures (network, S3 timeout): retry up to 3 times with exponential backoff
//   (1s, 4s, 16s). Fedify handles retry scheduling for queued jobs.
// - Permanent failures (dimension exceeded, invalid magic bytes, archive too large):
//   set processingStatus='failed' immediately, do NOT retry, log with error context.
// - After 3 failed retries: set processingStatus='failed', update upload session
//   status='failed', notify uploader via upload status endpoint.

// Distinguish transient vs permanent in job code:
try {
  await processPage(pageId)
} catch (err) {
  if (err instanceof AppError && err.status < 500) {
    // 4xx = permanent failure (validation) — mark failed, don't retry
    await updatePage(pageId, { processingStatus: 'failed' })
    return
  }
  // 5xx or unknown = transient — re-throw so Fedify retries
  throw err
}
```

---

## 14. Scaling Architecture

### 14.1 The Scaling Ladder

**Stage 1 (0–5K MAU):** `RUN_MODE=all`, single Compose, single Postgres + PgBouncer. ~$10–20/month.

**Stage 2 (5K–20K MAU):** Split: `RUN_MODE=web` + `RUN_MODE=worker`. Same DB. ~$30–50/month.

**Stage 3 (20K–100K MAU):** Add `DATABASE_REPLICA_URL`. Second web container. ~$80–150/month.

**Stage 4 (100K+ MAU):** `QUEUE_BACKEND=redis`. More containers. Managed Postgres. ~$300+/month.

Zero code changes at any stage.

### 14.2 PgBouncer Config

```ini
[databases]
manga = host=db port=5432 dbname=manga

[pgbouncer]
listen_port = 6432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
default_pool_size = 25
max_client_conn = 1000
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
```

### 14.3 Connection Summary

| Client | Connects to | Pool mode | Purpose |
|---|---|---|---|
| `db.primary` | PgBouncer :6432 | transaction | All app reads/writes |
| `db.replica` | PgBouncer :6432 (or replica) | transaction | Read-heavy queries |
| `db.queue` | Postgres :5432 directly | persistent | Federation LISTEN/NOTIFY |

---

## 15. Content Moderation

### 15.1 Automated Safeguards

- Uploads not publicly accessible until `processingStatus = 'complete'`
- Rate limit: 10 comments/minute/user
- Rate limit: 5 series/day/uploader
- File extension allowlist: `[jpg, jpeg, png, webp, gif]`
- Magic bytes verified server-side
- Max size enforced at presigned URL generation
- Archive page count capped at `ARCHIVE_MAX_PAGES`
- **Archive junk-file filtering:** Non-image files in archives (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, `ComicInfo.xml`, hidden files) are silently skipped. Only files that pass the extension filter but fail magic byte validation are logged as warnings. The upload never fails due to incidental archive metadata — only due to explicit validation failures.

### 15.2 DMCA / Takedown Process

```
POST /api/v1/dmca (public, no auth)
→ Creates takedown record (status='pending')
→ Admin reviews via panel
→ PATCH to 'actioned': sets is_deleted=true, sends Delete activity, purges CDN
```

### 15.3 Federation Moderation

- Blocked domains rejected at HTTP layer before Fedify processes the request
- All incoming `POST` to any inbox checked against `instance_blocks`
- Tombstoned series reject incoming activities with 410

---

## 16. Instance Administration

### 16.1 NodeInfo

```json
{
  "version": "2.0",
  "software": { "name": "mangafedi", "version": "1.0.0" },
  "protocols": ["activitypub"],
  "usage": {
    "users": { "total": 0, "activeMonth": 0, "activeHalfyear": 0 },
    "localPosts": 0
  },
  "openRegistrations": true,
  "metadata": {
    "nodeName": "...",
    "nodeDescription": "...",
    "contentTypes": ["manga", "manhwa", "manhua"],
    "allowsNsfw": false
  }
}
```

### 16.2 Admin Config Caching

Instance config cached in-memory (30s TTL). Invalidated immediately on `PATCH /api/v1/admin/instance`.

---

## 17. Performance Considerations

### 17.1 In-Memory TTL Cache

```typescript
// src/lib/cache.ts
class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>()

  set(key: string, value: T, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) { this.store.delete(key); return undefined }
    return entry.value
  }
  invalidate(key: string) { this.store.delete(key) }
}

export const instanceConfigCache = new TtlCache<InstanceConfig>()
export const seriesCache = new TtlCache<Series>()
```

Cache TTLs: `instance_config` → 30s, series metadata → 60s, chapter page lists → 5min, WebFinger → 5min.

### 17.2 Batch Progress Writes

```typescript
const progressBuffer = new Map<string, ProgressUpdate>()

export function bufferProgressUpdate(userId: string, chapterId: string, pageNumber: number) {
  progressBuffer.set(`${userId}:${chapterId}`, { userId, chapterId, pageNumber })
}

setInterval(async () => {
  if (progressBuffer.size === 0) return
  const updates = Array.from(progressBuffer.values())
  progressBuffer.clear()
  await db.primary.insert(readingProgress).values(updates)
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.chapterId],
      set: { pageNumber: sql`excluded.page_number`, updatedAt: new Date() }
    })
}, 5000)
```

---

## 18. Security Considerations

### 18.1 Checklist

- [ ] All DB queries parameterized (Drizzle handles this)
- [ ] File magic bytes verified for all uploads
- [ ] Archive zip-slip prevention via path resolution check
- [ ] `Content-Security-Policy` on all HTML responses
- [ ] CORS configured (§8.2)
- [ ] Rate limiting on auth: 10 req/min/IP
- [ ] Rate limiting on comments: 10/min/user
- [ ] HTTP Signature verification on incoming AP activities (Fedify)
- [ ] `@fedify/fedify >= 1.9.x` for CVE-2025-54888 patch
- [ ] Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`
- [ ] Presigned URLs expire in 1 hour
- [ ] Private keys AES-256 encrypted at rest
- [ ] Admin endpoints check role per-request (not just middleware)
- [ ] `allowPrivateAddress: false` in production (SSRF protection)
- [ ] Circuit breaker limits outbound federation blast radius
- [ ] bcrypt async-only — sync variants banned (§8.1)
- [ ] `DATABASE_QUEUE_URL` bypasses PgBouncer (§13.3)

### 18.2 Private Key Encryption

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function encryptPrivateKey(pem: string, secret: string): string {
  const iv = randomBytes(16)
  const key = Buffer.from(secret, 'hex').slice(0, 32)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptPrivateKey(encrypted: string, secret: string): string {
  const [ivHex, dataHex] = encrypted.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const key = Buffer.from(secret, 'hex').slice(0, 32)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]).toString('utf8')
}
```

---

## 19. Docker & Deployment

### 19.1 Dockerfile

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm build

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

### 19.2 Docker Compose

```yaml
version: "3.8"

services:
  app:
    image: mangafedi:latest
    build: ..
    env_file: ../.env
    environment:
      DATABASE_PRIMARY_URL: postgres://manga:${DB_PASSWORD}@pgbouncer:6432/manga
      DATABASE_QUEUE_URL: postgres://manga:${DB_PASSWORD}@db:5432/manga
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
      pgbouncer:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/instance"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: manga
      POSTGRES_USER: manga
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U manga"]
      interval: 10s
      timeout: 5s
      retries: 5

  pgbouncer:
    image: bitnami/pgbouncer:latest
    environment:
      POSTGRESQL_HOST: db
      POSTGRESQL_PORT: 5432
      POSTGRESQL_DATABASE: manga
      POSTGRESQL_USERNAME: manga
      POSTGRESQL_PASSWORD: ${DB_PASSWORD}
      PGBOUNCER_DATABASE: manga
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_DEFAULT_POOL_SIZE: 25
      PGBOUNCER_MAX_CLIENT_CONN: 1000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  backup:
    image: amazon/aws-cli:latest
    environment:
      PGPASSWORD: ${DB_PASSWORD}
      DB_HOST: db
      DB_NAME: manga
      DB_USER: manga
      AWS_ACCESS_KEY_ID: ${STORAGE_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${STORAGE_SECRET_ACCESS_KEY}
      AWS_DEFAULT_REGION: ${STORAGE_REGION}
      BACKUP_ENDPOINT: ${STORAGE_ENDPOINT}
      BACKUP_BUCKET: ${BACKUP_STORAGE_BUCKET}
      BACKUP_PREFIX: ${BACKUP_STORAGE_PREFIX}
    volumes:
      - ./backup.sh:/backup.sh:ro
      - /tmp/backups:/tmp/backups
    entrypoint: ["sh", "-c", "apk add --no-cache postgresql-client && crond -f -d 6"]
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

> **V3 change:** Backup sidecar now uses `amazon/aws-cli` image. The `backup.sh` script uploads the dump directly to S3 offsite, eliminating the single-point-of-failure of keeping backups on the same host as the database.

### 19.3 Caddyfile

```caddyfile
{env.BASE_DOMAIN} {
  reverse_proxy app:3000

  @static path /style.css /reader.js /favicon.ico
  handle @static {
    root * /app/public
    file_server
    header Cache-Control "public, max-age=86400"
  }
}
```

### 19.4 First-Time Setup

```bash
#!/bin/bash
# scripts/setup.sh
set -e

SESSION_SECRET=$(openssl rand -hex 64)
PORTABLE_KEY_HMAC_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 32)

echo "SESSION_SECRET=$SESSION_SECRET"                     >> .env
echo "PORTABLE_KEY_HMAC_SECRET=$PORTABLE_KEY_HMAC_SECRET" >> .env
echo "DB_PASSWORD=$DB_PASSWORD"                           >> .env

echo "Running migrations..."
docker compose run --rm app node dist/index.js migrate-only

echo "Creating admin user..."
docker compose run --rm app node dist/scripts/createAdmin.js

echo "Setup complete. Run: docker compose up -d"
```

```typescript
// scripts/createAdmin.ts — V3: documented behaviour
// Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD from env or prompts interactively.
// Creates a user record with role='admin'.
// Prints the generated seed phrase once to stdout — the admin must record it.
// Exits with code 1 if an admin already exists (idempotent-safe).

import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../src/lib/auth'
import { generateUserMnemonic, derivePortableKeypair } from '../src/lib/crypto'
import { db } from '../src/db'
import { users } from '../src/db/schema'

async function createAdmin() {
  const existing = await db.primary.select().from(users)
    .where(eq(users.role, 'admin')).limit(1)
  if (existing.length > 0) {
    console.error('An admin user already exists. Exiting.')
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const username = process.env.ADMIN_USERNAME ?? await rl.question('Admin username: ')
  const email    = process.env.ADMIN_EMAIL    ?? await rl.question('Admin email: ')
  const password = process.env.ADMIN_PASSWORD ?? await rl.question('Admin password: ')
  rl.close()

  const mnemonic = generateUserMnemonic()
  const { publicKey: portablePublicKey, fingerprint } = await derivePortableKeypair(mnemonic)

  await db.primary.insert(users).values({
    username, email,
    passwordHash: await hashPassword(password),
    displayName: username,
    role: 'admin',
    portablePublicKey,
    portableKeyFingerprint: fingerprint,
    // ActivityPub keys generated in user creation service
    actorUri: `${process.env.BASE_URL}/users/${username}`,
    inboxUri: `${process.env.BASE_URL}/users/${username}/inbox`,
    publicKey: '',   // Populated by user creation service
    privateKey: '',
  })

  console.log('\n⚠️  SAVE THIS SEED PHRASE — it will not be shown again:')
  console.log(`\n  ${mnemonic}\n`)
}

createAdmin().catch(console.error)
```

### 19.5 Backup Script — Offsite to S3

> **V3 change:** Backup now uploads directly to S3. Backups stored only on the host volume die with the host.

```bash
#!/bin/sh
# docker/backup.sh — runs inside backup sidecar
# Crontab: 0 2 * * * /backup.sh >> /var/log/backup.log 2>&1

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOCAL_FILE="/tmp/backups/manga_${TIMESTAMP}.sql.gz"
S3_KEY="${BACKUP_PREFIX}manga_${TIMESTAMP}.sql.gz"

# 1. Dump database
pg_dump -h "${DB_HOST}" -U "${DB_USER}" "${DB_NAME}" | gzip > "${LOCAL_FILE}"

if [ $? -ne 0 ]; then
  echo "${TIMESTAMP}: pg_dump FAILED"
  rm -f "${LOCAL_FILE}"
  exit 1
fi

# 2. Upload to S3 offsite — this is the real backup
aws s3 cp "${LOCAL_FILE}" "s3://${BACKUP_BUCKET}/${S3_KEY}" \
  --endpoint-url "${BACKUP_ENDPOINT}"

if [ $? -ne 0 ]; then
  echo "${TIMESTAMP}: S3 upload FAILED — local copy retained at ${LOCAL_FILE}"
  exit 1
fi

echo "${TIMESTAMP}: Backup succeeded → s3://${BACKUP_BUCKET}/${S3_KEY}"

# 3. Clean up local file after confirmed S3 upload
rm -f "${LOCAL_FILE}"

# 4. Prune S3 backups older than 14 days
aws s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}" \
  --endpoint-url "${BACKUP_ENDPOINT}" \
  | awk '{print $4}' \
  | while read key; do
      # Parse timestamp from filename and delete if > 14 days old
      # Implementation left to operator — aws s3 lifecycle policies preferred
      true
    done
```

> **Recommended:** Configure an S3 lifecycle rule on `BACKUP_BUCKET` to expire objects older than 14 days. This is more reliable than script-based pruning.

**Restore procedure:**
```bash
aws s3 cp "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}manga_YYYYMMDD_HHMMSS.sql.gz" - \
  --endpoint-url "${STORAGE_ENDPOINT}" | \
  gunzip | psql -h db -U manga manga
```

---

## 20. Testing Strategy

### 20.1 Unit Tests (Vitest)

- All service functions with mocked DB queries
- `src/lib/crypto.ts` — seed phrase derivation, signing, verification
- `src/lib/pagination.ts` — cursor encoding/decoding
- `src/services/chapters.ts` — `computeSortOrder` edge cases
- `archiveIngest` — `SKIP_PATTERNS` filter, path sorting, zip-slip detection
- ActivityPub object construction

### 20.2 Integration Tests

- API endpoints against ephemeral Postgres (no PgBouncer)
- Federation inbox via Fedify test utilities
- Upload flow with localstack mock S3
- Archive ingest with sample CBZ files including junk files

### 20.3 Federation Compatibility Matrix

- [ ] Follow series from Mastodon — chapter appears in timeline
- [ ] Comment from Mastodon appears on chapter page
- [ ] Chapter announcement creates threaded discussion on Lemmy/Kbin
- [ ] Lemmy reply maps to chapter comment
- [ ] Account `Move` received and processed correctly
- [ ] Instance block prevents inbox delivery
- [ ] Tombstoned series rejects incoming activities with 410
- [ ] Verify LISTEN/NOTIFY queue survives PgBouncer restart (direct connection)

---

## 21. Implementation Order

### Phase 1 — Foundation (Week 1–2)
1. Project scaffold, TypeScript, pnpm
2. `config.ts` with full env var parsing including `DATABASE_QUEUE_URL`
3. `drizzle.config.ts`
4. Database schema + migration (GIN indexes, triggers, autovacuum tuning)
5. Docker Compose: Postgres, PgBouncer, Caddy, backup sidecar
6. `src/db/index.ts` — three connections: `primary`, `replica`, `queue`
7. `testConnection()` on all three
8. Startup orchestration `src/index.ts`
9. Health check: `GET /api/v1/instance`
10. NodeInfo endpoint

### Phase 2 — Auth & Users (Week 2–3)
1. `lib/errors.ts`, `lib/auth.ts` (bcrypt async only)
2. Register, login, logout, me endpoints
3. Seed phrase generation on registration
4. User actor creation (Fedify)
5. WebFinger for user actors
6. API token create/revoke

### Phase 3 — Series & Chapters (Week 3–4)
1. Series CRUD + `generateSlug` + `ensureUniqueSlug`
2. `inferReadingDirection` from content type
3. Series actor (Fedify)
4. Chapter creation (metadata only) + `computeSortOrder`
5. Browse + search API + FTS

### Phase 4 — Image Upload & Processing (Week 4–5)
1. S3 client + `storage/keys.ts` with cache-busting
2. Presigned URLs + page record pre-creation
3. `imageProcess` job with OOM guard
4. `archiveIngest` job — single-pass, zip-slip protection, junk filtering
5. Both upload endpoints

### Phase 5 — Federation (Week 5–6)
1. `webServer.ts` with correct mount order (Fedify → error handler → API → web)
2. `federation/index.ts` using `db.queue` direct connection
3. Follow/Unfollow series
4. `Create(MangaChapter)` announce
5. Incoming `Create(Note)` → federated comments
6. Tombstoning + actor URI cache clear
7. `Update(Person)` + `Move` handling
8. Circuit breaker

### Phase 6 — User Features (Week 6–7)
1. Library CRUD
2. Reading progress (debounced batch writes)
3. Comments (local + federated)
4. Profile pages via fingerprint

### Phase 7 — Default Frontend (Week 7–8)
1. Layout + CSS
2. Browse, series detail, reader pages
3. `reader.js`
4. Auth pages
5. Upload forms (individual + archive)

### Phase 8 — Admin & Moderation (Week 8–9)
1. Admin role middleware
2. Instance config API + UI
3. User management, report queue, DMCA
4. Federation block management + health dashboard

### Phase 9 — Identity Recovery (Week 9–10)
1. Account recovery endpoint
2. Series claim endpoint (tombstone guard)
3. `Update(Person)` with `alsoKnownAs`

### Phase 10 — Hardening (Week 10–12)
1. Rate limiting
2. Magic byte + zip-slip verification audit
3. CSP + security headers
4. Integration + compatibility test suite
5. Load testing
6. README, API docs, self-hosting guide

---

## 22. Known Limitations & Future Work

### 22.1 Accepted Limitations at Launch

- **Remote re-attribution:** After recovery, Mastodon instances update actor display but don't re-link `attributedTo` on cached comments. Protocol limitation.
- **Follow portability:** Follows are not portable across instance death.
- **Comment federation scope:** Comments only federate to instances with series followers.
- **Search fuzzy matching:** Postgres FTS doesn't support typo tolerance; Meilisearch is a future upgrade path.
- **Archive memory usage:** Very large archives (many pages at high resolution) are processed sequentially per-job but still load the full archive buffer. Operators should tune `ARCHIVE_MAX_PAGES` and `IMAGE_MAX_DIMENSION_PX` relative to available VPS RAM.

### 22.2 Future Work

- OAuth 2.0 / Mastodon-compatible API
- Meilisearch integration for fuzzy search
- WebPush notifications for chapter releases
- Reading list sharing as AP Collections
- Series collaboration (multiple uploaders, ownership transfer)
- FEP-ef61 portable objects (when stabilised)
- Email notifications (SMTP env vars pre-allocated)
- Per-token API rate limits
- Kubernetes deployment guide
- S3 lifecycle policy automation script

---

## Appendix A — Error Codes

```
AUTH_REQUIRED            401
FORBIDDEN                403
NOT_FOUND                404
GONE                     410  — tombstoned series / expired session
VALIDATION_ERROR         422
RATE_LIMITED             429
INTERNAL_ERROR           500
REGISTRATION_CLOSED      403
UPLOAD_DISABLED          403
FEDERATION_DISABLED      503
INVALID_MNEMONIC         400
FINGERPRINT_NOT_FOUND    404
SERIES_NOT_FOUND         404
CHAPTER_NOT_FOUND        404
UPLOAD_SESSION_EXPIRED   410
PROCESSING_FAILED        400  — permanent validation failure (not retried)
ARCHIVE_TOO_LARGE        413
ARCHIVE_TOO_MANY_PAGES   422
```

---

## Appendix B — ActivityPub Namespace

Serve at `{BASE_URL}/ns` with `Content-Type: application/ld+json`:

```json
{
  "@context": {
    "manga": "https://mangafedi.org/ns#",
    "MangaChapter": "manga:MangaChapter",
    "MangaSeries": "manga:MangaSeries",
    "ScanlationGroup": "manga:ScanlationGroup",
    "chapterNumber": "manga:chapterNumber",
    "volumeNumber": "manga:volumeNumber",
    "pageCount": "manga:pageCount",
    "readingDirection": "manga:readingDirection",
    "contentType": "manga:contentType",
    "seriesActor": "manga:seriesActor",
    "portableKeyFingerprint": "manga:portableKeyFingerprint"
  }
}
```

---

## Appendix C — Full Change Log

### V1 → V2 (14 reviewer notes)

| # | Change |
|---|---|
| R1 | Added `drizzle.config.ts` |
| R2 | Added `testConnection()` |
| R3 | Explicit startup order in `index.ts` |
| R4 | Fedify + Hono mount order documented |
| R5 | `inferReadingDirection()` added |
| R6 | Null `portableKeyFingerprint` on remote comments documented |
| R7 | Page record pre-creation before presigned URLs |
| R8 | `computeSortOrder()` specified |
| R9 | `better-auth` replaced by thin custom auth |
| R10 | CORS config specified |
| R11 | Shared inbox note |
| R12 | `generateSlug` + `ensureUniqueSlug` |
| R13 | `AppError`, `NotFoundError`, `ForbiddenError` |
| R14 | CSS architecture with custom properties |

### V2 → V2 (addendum, 8 items)

| # | Change |
|---|---|
| A1 | CBZ/ZIP archive upload path + `archiveIngest` job |
| A2 | OOM guard + `IMAGE_MAX_DIMENSION_PX` |
| A3 | Lemmy/Kbin compatibility note |
| A4 | Tombstoning on soft-delete + `deletedAt` column |
| A5 | GIN indexes on JSONB arrays |
| A6 | Denormalization triggers |
| A7 | Backup sidecar in Docker Compose |
| A8 | Cache-busting `?v=` + `version` columns |

### V2 → V3 (Round 3 external review + independent audit)

| # | Source | Change |
|---|---|---|
| B1 | External review | Archive double-trip eliminated — single-pass Sharp in `archiveIngest` |
| B2 | External review | UUIDv7 replaces UUIDv4 on all tables — prevents B-tree fragmentation |
| B3 | External review | Backup script uploads to S3 offsite — local-only backups are not backups |
| B4 | External review | bcrypt async-only enforcement documented + rationale (event loop blocking) |
| B5 | External review | Archive junk-file filtering specified (`SKIP_PATTERNS`) |
| B6 | External review | Tombstone actor URI cache cleared on series delete |
| B7 | Independent | `blurhash` package added to stack + version pinned |
| B8 | Independent | `validateApiToken` expiry condition completed (was a comment placeholder) |
| B9 | Independent | Global Hono error handler (`app.onError`) documented |
| B10 | Independent | `createAdmin.ts` script documented with full implementation sketch |
| B11 | Independent | `archiveStorageKey` column added to `upload_sessions` table |
| B12 | Independent | `uuidv7` import added to schema |
| B13 | Independent | PgBouncer + LISTEN/NOTIFY incompatibility identified and resolved (`DATABASE_QUEUE_URL`, `db.queue` connection) |
| B14 | Independent | Worker retry / dead-letter strategy specified (transient vs permanent failures) |

---

**Document Status: READY FOR IMPLEMENTATION**
**Version: 3.0**
**Next Action: Begin Phase 1 scaffolding**
