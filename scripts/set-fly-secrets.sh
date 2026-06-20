#!/usr/bin/env bash
# Run this after: flyctl apps create repath-gateway
flyctl secrets set \
  REPATH_API_TOKEN="3f6fb762c63146ad52cb80a09b262dbbf52b88ddb33633ada05426b16128365b" \
  JWT_SECRET="825c16c5607497562fb54cd63e2f8033368ae9fe3303423822caab59706bed62" \
  OPENAI_API_KEY="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" \
  REPATH_DATABASE_URL="postgresql://neondb_owner:npg_HN9eV1TsErPO@ep-sweet-bread-aociktc3.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  REPATH_REDIS_URL="rediss://default:gQAAAAAAAfLpAAIgcDFiMjRjZTk0ZWIwMmM0YTQxODAwZjAwMzkxODczMDExYw@cute-sculpin-127721.upstash.io:6379" \
  --app repath-gateway
