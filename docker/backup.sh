#!/bin/sh
# docker/backup.sh – runs inside backup sidecar
# Crontab: 0 2 * * * /backup.sh >> /var/log/backup.log 2>&1

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOCAL_FILE="/tmp/backups/manga_${TIMESTAMP}.sql.gz"
S3_KEY="${BACKUP_PREFIX:-db/}manga_${TIMESTAMP}.sql.gz"

# 1. Dump database
pg_dump -h "${DB_HOST}" -U "${DB_USER}" "${DB_NAME}" | gzip > "${LOCAL_FILE}"

if [ $? -ne 0 ]; then
  echo "${TIMESTAMP}: pg_dump FAILED"
  rm -f "${LOCAL_FILE}"
  exit 1
fi

echo "${TIMESTAMP}: pg_dump complete ($(du -sh $LOCAL_FILE | cut -f1))"

# 2. Upload to S3 offsite
aws s3 cp "${LOCAL_FILE}" "s3://${BACKUP_BUCKET}/${S3_KEY}" \
  --endpoint-url "${BACKUP_ENDPOINT}"

if [ $? -ne 0 ]; then
  echo "${TIMESTAMP}: S3 upload FAILED – local copy retained at ${LOCAL_FILE}"
  exit 1
fi

echo "${TIMESTAMP}: Backup succeeded → s3://${BACKUP_BUCKET}/${S3_KEY}"

# 3. Clean up local file after confirmed S3 upload
rm -f "${LOCAL_FILE}"
