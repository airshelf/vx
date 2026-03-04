#!/usr/bin/env bash
# bench_latency.sh — Measure read latency across interfaces
# Usage: ./bench_latency.sh <mountpoint>
# Prerequisites: mcpfs mounted at <mountpoint>, vx in PATH
set -euo pipefail

MOUNT="${1:-/tmp/mnt/vercel}"
RUNS=10

median() {
  sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}'
}

bench() {
  local label="$1" cmd="$2"
  local times=()
  for i in $(seq 1 $RUNS); do
    t=$( { time eval "$cmd" > /dev/null 2>&1; } 2>&1 | grep real | awk '{print $2}')
    # Convert to ms
    ms=$(echo "$t" | sed 's/[ms]/ /g' | awk '{printf "%.0f", $1*60000+$2*1000+$3}')
    times+=("$ms")
  done
  med=$(printf '%s\n' "${times[@]}" | median)
  echo "$label: ${med}ms (median of $RUNS runs)"
}

echo "=== Latency Benchmark ==="
echo "Runs: $RUNS each"
echo ""

echo "--- Filesystem (mcpfs) ---"
bench "fs:deployments.json" "cat $MOUNT/deployments.json"
bench "fs:projects.json"    "cat $MOUNT/projects.json"
bench "fs:domains.json"     "cat $MOUNT/domains.json"

echo ""
echo "--- CLI (vx) ---"
bench "cli:ls"       "vx ls --json"
bench "cli:projects" "vx projects --json"
bench "cli:domains"  "vx domains --json"

echo ""
echo "--- MCP (JSON-RPC via stdin) ---"
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bench","version":"0.1"}}}'
NOTIF='{"jsonrpc":"2.0","method":"notifications/initialized"}'

bench "mcp:deployments" "printf '%s\n%s\n%s\n' '$INIT' '$NOTIF' '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"resources/read\",\"params\":{\"uri\":\"vercel://deployments\"}}' | timeout 10 vx mcp 2>/dev/null"
bench "mcp:projects"    "printf '%s\n%s\n%s\n' '$INIT' '$NOTIF' '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"resources/read\",\"params\":{\"uri\":\"vercel://projects\"}}' | timeout 10 vx mcp 2>/dev/null"
