#!/bin/bash
# ============================================
# MAX - Quick Test Script
# Run after docker compose up to verify the pipeline
# ============================================

API_URL="http://localhost:3210"
API_KEY="${MAX_API_KEY:-max-secret-key-change-me}"

echo "🔨 Max — Testing Pipeline"
echo "========================="
echo ""

# 1. Health check
echo "1. Health check..."
curl -s "$API_URL/health" | python3 -m json.tool 2>/dev/null || echo "❌ API not responding"
echo ""

# 2. Status
echo "2. Status..."
curl -s "$API_URL/status" | python3 -m json.tool 2>/dev/null || echo "❌ Status failed"
echo ""

# 3. Test audio upload (you'll need a real audio file)
if [ -f "$1" ]; then
  echo "3. Uploading audio file: $1"
  curl -s -X POST "$API_URL/api/upload/audio" \
    -H "x-api-key: $API_KEY" \
    -F "audio=@$1" \
    -F "title=Test Walk" \
    -F "phase=Rough-In" | python3 -m json.tool
  echo ""
  echo "⏳ Check logs with: docker logs -f max-api"
else
  echo "3. Skipping audio upload (no file provided)"
  echo "   Usage: ./test.sh /path/to/recording.ogg"
fi

echo ""

# 4. Test chat
echo "4. Testing chat..."
curl -s -X POST "$API_URL/api/chat" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What jobs do you have on record?"}' | python3 -m json.tool
echo ""

# 5. List jobs
echo "5. Listing jobs..."
curl -s "$API_URL/api/jobs" \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
echo ""

echo "✅ Done! Check docker logs -f max-api for pipeline activity."
