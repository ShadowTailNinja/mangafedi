import {
  pgTable, text, integer, boolean, timestamp, jsonb,
  uuid, real, index, uniqueIndex, primaryKey
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

// ─── INSTANCE CONFIG ──────────────────────────────────────────────────────────

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
  allowedContentTypes: jsonb('allowed_content_types').$type<string[]>().notNull().default(['manga', 'manhwa', 'manhua']),
  customCss: text('custom_css').notNull().default(''),
  announcement: text('announcement').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── USERS ───────────────────────────────────────────────────────────────────

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
  privateKey: text('private_key').notNull(),

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

// ─── SESSIONS ────────────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}))

// ─── API TOKENS ───────────────────────────────────────────────────────────────

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

// ─── SERIES ───────────────────────────────────────────────────────────────────

export const series = pgTable('series', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  contentType: text('content_type').notNull().default('manga'),
  status: text('status').notNull().default('ongoing'),
  readingDirection: text('reading_direction').notNull().default('rtl'),
  language: text('language').notNull().default('en'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  isNsfw: boolean('is_nsfw').notNull().default(false),
  coverStorageKey: text('cover_storage_key'),
  coverVersion: integer('cover_version').notNull().default(1),

  // Uploader
  uploaderId: uuid('uploader_id').notNull().references(() => users.id),

  // ActivityPub
  actorUri: text('actor_uri').notNull(),
  knownActorUris: jsonb('known_actor_uris').$type<string[]>().notNull().default([]),

  // Portable identity
  portablePublicKey: text('portable_public_key'),
  portableKeyFingerprint: text('portable_key_fingerprint'),

  // Denormalized counts
  chapterCount: integer('chapter_count').notNull().default(0),
  followerCount: integer('follower_count').notNull().default(0),

  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at'),

  // FTS
  searchVector: text('search_vector'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('series_slug_idx').on(t.slug),
  actorUriIdx: uniqueIndex('series_actor_uri_idx').on(t.actorUri),
  uploaderIdx: index('series_uploader_idx').on(t.uploaderId),
  fingerprintIdx: index('series_fingerprint_idx').on(t.portableKeyFingerprint),
}))

// ─── CHAPTERS ─────────────────────────────────────────────────────────────────

export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  seriesId: uuid('series_id').notNull().references(() => series.id),
  chapterNumber: text('chapter_number').notNull(),
  volumeNumber: text('volume_number'),
  title: text('title'),
  language: text('language').notNull().default('en'),
  sortOrder: real('sort_order').notNull().default(0),
  pageCount: integer('page_count').notNull().default(0),
  uploaderId: uuid('uploader_id').notNull().references(() => users.id),

  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at'),

  publishedAt: timestamp('published_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  seriesIdx: index('chapters_series_idx').on(t.seriesId),
  sortIdx: index('chapters_sort_idx').on(t.seriesId, t.sortOrder),
}))

// ─── PAGES ────────────────────────────────────────────────────────────────────

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull(),
  originalStorageKey: text('original_storage_key').notNull(),
  webpStorageKey: text('webp_storage_key'),
  mobileStorageKey: text('mobile_storage_key'),
  width: integer('width'),
  height: integer('height'),
  blurhash: text('blurhash'),
  processingStatus: text('processing_status').notNull().default('pending'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  chapterIdx: index('pages_chapter_idx').on(t.chapterId),
  chapterPageIdx: uniqueIndex('pages_chapter_page_idx').on(t.chapterId, t.pageNumber),
}))

// ─── UPLOAD SESSIONS ──────────────────────────────────────────────────────────

export const uploadSessions = pgTable('upload_sessions', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  userId: uuid('user_id').notNull().references(() => users.id),
  chapterId: uuid('chapter_id').references(() => chapters.id),
  uploadType: text('upload_type').notNull().default('individual'),
  status: text('status').notNull().default('pending'),
  archiveStorageKey: text('archive_storage_key'),
  errorMessage: text('error_message'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('upload_sessions_user_idx').on(t.userId),
  expiresIdx: index('upload_sessions_expires_idx').on(t.expiresAt),
}))

// ─── SERIES FOLLOWS ───────────────────────────────────────────────────────────

export const seriesFollows = pgTable('series_follows', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  seriesId: uuid('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  followerActorUri: text('follower_actor_uri').notNull(),
  followerInboxUri: text('follower_inbox_uri').notNull(),
  isLocal: boolean('is_local').notNull().default(false),
  localUserId: uuid('local_user_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueFollow: uniqueIndex('series_follows_unique_idx').on(t.seriesId, t.followerActorUri),
  seriesIdx: index('series_follows_series_idx').on(t.seriesId),
}))

// ─── COMMENTS ─────────────────────────────────────────────────────────────────

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id),
  authorId: uuid('author_id').references(() => users.id),
  authorActorUri: text('author_actor_uri').notNull(),
  authorUsername: text('author_username').notNull(),
  authorDisplayName: text('author_display_name').notNull(),
  portableKeyFingerprint: text('portable_key_fingerprint'),
  content: text('content').notNull(),
  activityUri: text('activity_uri'),
  isLocal: boolean('is_local').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  chapterIdx: index('comments_chapter_idx').on(t.chapterId),
  authorIdx: index('comments_author_idx').on(t.authorId),
  fingerprintIdx: index('comments_fingerprint_idx').on(t.portableKeyFingerprint),
}))

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  reporterId: uuid('reporter_id').references(() => users.id),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  details: text('details').notNull().default(''),
  status: text('status').notNull().default('pending'),
  resolvedById: uuid('resolved_by_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  resolution: text('resolution'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('reports_status_idx').on(t.status),
}))

// ─── DMCA TAKEDOWNS ───────────────────────────────────────────────────────────

export const dmcaTakedowns = pgTable('dmca_takedowns', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  complainantName: text('complainant_name').notNull(),
  complainantEmail: text('complainant_email').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetUrl: text('target_url').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  actionedById: uuid('actioned_by_id').references(() => users.id),
  actionedAt: timestamp('actioned_at'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('dmca_status_idx').on(t.status),
}))

// ─── INSTANCE BLOCKS ──────────────────────────────────────────────────────────

export const instanceBlocks = pgTable('instance_blocks', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  domain: text('domain').notNull(),
  reason: text('reason').notNull().default(''),
  blockedById: uuid('blocked_by_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  domainIdx: uniqueIndex('instance_blocks_domain_idx').on(t.domain),
}))

// ─── REMOTE INSTANCE HEALTH ───────────────────────────────────────────────────

export const remoteInstanceHealth = pgTable('remote_instance_health', {
  domain: text('domain').primaryKey(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastSuccessAt: timestamp('last_success_at'),
  lastAttemptAt: timestamp('last_attempt_at'),
  backoffUntil: timestamp('backoff_until'),
})

// ─── LIBRARY ──────────────────────────────────────────────────────────────────

export const library = pgTable('library', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seriesId: uuid('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('reading'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueEntry: uniqueIndex('library_unique_idx').on(t.userId, t.seriesId),
  userIdx: index('library_user_idx').on(t.userId),
}))

// ─── READING PROGRESS ─────────────────────────────────────────────────────────

export const readingProgress = pgTable('reading_progress', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull().default(1),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.chapterId] }),
  userIdx: index('progress_user_idx').on(t.userId),
}))

// ─── TYPE EXPORTS ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Series = typeof series.$inferSelect
export type NewSeries = typeof series.$inferInsert
export type Chapter = typeof chapters.$inferSelect
export type NewChapter = typeof chapters.$inferInsert
export type Page = typeof pages.$inferSelect
export type Comment = typeof comments.$inferSelect
export type InstanceConfig = typeof instanceConfig.$inferSelect
export type Report = typeof reports.$inferSelect
export type DmcaTakedown = typeof dmcaTakedowns.$inferSelect
export type InstanceBlock = typeof instanceBlocks.$inferSelect
export type LibraryEntry = typeof library.$inferSelect
export type ReadingProgress = typeof readingProgress.$inferSelect
export type UploadSession = typeof uploadSessions.$inferSelect
