#!/usr/bin/env bash
# bench_compose.sh — Composability tests: same questions, three interfaces
# Usage: ./bench_compose.sh <mountpoint>
set -euo pipefail

MOUNT="${1:-/tmp/mnt/vercel}"
PASS=0
FAIL=0

check() {
  local label="$1" result="$2"
  if [ -n "$result" ] && [ "$result" != "null" ]; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label (empty result)"
    ((FAIL++))
  fi
}

echo "=== Composability Benchmark ==="
echo ""

echo "--- Task 1: Latest deployment URL ---"
r=$(cat "$MOUNT/deployments.json" | jq -r '.[0].url' 2>/dev/null)
check "fs" "$r"
r=$(vx ls --json | jq -r '.[0].url' 2>/dev/null)
check "cli" "$r"

echo ""
echo "--- Task 2: Which projects use Next.js? ---"
r=$(cat "$MOUNT/projects.json" | jq -r '.[] | select(.framework == "nextjs") | .name' 2>/dev/null | head -3)
check "fs" "$r"
r=$(vx projects --json | jq -r '.[] | select(.framework == "nextjs") | .name' 2>/dev/null | head -3)
check "cli" "$r"

echo ""
echo "--- Task 3: Find ERROR deployments ---"
r=$(cat "$MOUNT/deployments.json" | jq -r '.[] | select(.state == "ERROR") | .url' 2>/dev/null | head -3)
check "fs" "$r"
r=$(vx ls --json | jq -r '.[] | select(.state == "ERROR") | .url' 2>/dev/null | head -3)
check "cli" "$r"

echo ""
echo "--- Task 4: Get env var keys for a project ---"
r=$(cat "$MOUNT/projects/airshelf/env" | jq -r '.[].key' 2>/dev/null | head -3)
check "fs" "$r"
r=$(vx env --json --project airshelf | jq -r '.[].key' 2>/dev/null | head -3)
check "cli" "$r"

echo ""
echo "--- Task 5: Diff env vars between two projects ---"
r=$(diff <(cat "$MOUNT/projects/airshelf/env" | jq -r '.[].key' 2>/dev/null | sort -u) \
         <(cat "$MOUNT/projects/bime-telegram/env" | jq -r '.[].key' 2>/dev/null | sort -u) 2>/dev/null | head -5)
check "fs (diff)" "$r"
r=$(diff <(vx env --json --project airshelf | jq -r '.[].key' 2>/dev/null | sort -u) \
         <(vx env --json --project bime-telegram | jq -r '.[].key' 2>/dev/null | sort -u) 2>/dev/null | head -5)
check "cli (diff)" "$r"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
