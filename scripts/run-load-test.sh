#!/bin/bash
cd /Users/abhi/projects/repath

python3 scripts/load-test.py \
  --gateway "https://repath-gateway.fly.dev" \
  --tenant  "ten_794cb1ec" \
  --token   "3f6fb762c63146ad52cb80a09b262dbbf52b88ddb33633ada05426b16128365b" \
  --openai  "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" \
  --gemini  "AQ.Ab8RN6KC9HVmg_5Z-LI5dxPFAhUSzqVOPHTjXfSdxrUqMUO5nw" \
  --db      "postgresql://neondb_owner:npg_HN9eV1TsErPO@ep-sweet-bread-aociktc3.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  --duration 1800
