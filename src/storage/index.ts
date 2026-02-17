import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'

const s3 = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  forcePathStyle: config.storage.forcePathStyle,
})

export async function uploadToStorage(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
}

export async function downloadFromStorage(key: string): Promise<Buffer> {
  const response = await s3.send(new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
  }))

  const chunks: Uint8Array[] = []
  const stream = response.Body as AsyncIterable<Uint8Array>
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function deleteFromStorage(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
  }))
}

export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  maxSizeBytes: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: maxSizeBytes,
  })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}
