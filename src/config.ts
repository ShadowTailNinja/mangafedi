import { z } from 'zod'
import 'dotenv/config'

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  baseUrl: z.string().url(),
  runMode: z.enum(['all', 'web', 'worker']).default('all'),

  db: z.object({
    primaryUrl: z.string(),
    replicaUrl: z.string().optional(),
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
    backupBucket: z.string().default('mangafedi-backups'),
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
  nodeEnv: process.env['NODE_ENV'],
  port: process.env['PORT'],
  baseUrl: process.env['BASE_URL'],
  runMode: process.env['RUN_MODE'],
  db: {
    primaryUrl: process.env['DATABASE_PRIMARY_URL'],
    replicaUrl: process.env['DATABASE_REPLICA_URL'] || undefined,
    queueUrl: process.env['DATABASE_QUEUE_URL'],
  },
  queue: {
    backend: process.env['QUEUE_BACKEND'],
    redisUrl: process.env['REDIS_URL'] || undefined,
  },
  storage: {
    endpoint: process.env['STORAGE_ENDPOINT'],
    bucket: process.env['STORAGE_BUCKET'],
    accessKeyId: process.env['STORAGE_ACCESS_KEY_ID'],
    secretAccessKey: process.env['STORAGE_SECRET_ACCESS_KEY'],
    region: process.env['STORAGE_REGION'],
    publicUrl: process.env['STORAGE_PUBLIC_URL'],
    forcePathStyle: process.env['STORAGE_FORCE_PATH_STYLE'],
    backupBucket: process.env['BACKUP_STORAGE_BUCKET'],
    backupPrefix: process.env['BACKUP_STORAGE_PREFIX'],
  },
  security: {
    sessionSecret: process.env['SESSION_SECRET']!,
    portableKeyHmacSecret: process.env['PORTABLE_KEY_HMAC_SECRET']!,
  },
  images: {
    maxUploadMb: process.env['IMAGE_MAX_UPLOAD_MB'],
    processingConcurrency: process.env['IMAGE_PROCESSING_CONCURRENCY'],
    maxDimensionPx: process.env['IMAGE_MAX_DIMENSION_PX'],
  },
  archive: {
    maxUploadMb: process.env['ARCHIVE_MAX_UPLOAD_MB'],
    maxPages: process.env['ARCHIVE_MAX_PAGES'],
  },
  federation: {
    workerConcurrency: process.env['FEDERATION_WORKER_CONCURRENCY'],
    maxOutboundPerDomainPerMinute: process.env['FEDERATION_MAX_OUTBOUND_PER_DOMAIN_PER_MINUTE'],
  },
  features: {
    registration: process.env['ENABLE_REGISTRATION'],
    federation: process.env['ENABLE_FEDERATION'],
    upload: process.env['ENABLE_UPLOAD'],
    archiveUpload: process.env['ENABLE_ARCHIVE_UPLOAD'],
  },
})

export type Config = typeof config
