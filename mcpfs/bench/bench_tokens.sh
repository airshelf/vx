#!/usr/bin/env bash
# bench_tokens.sh — Measure context tokens for discovery across interfaces
# Usage: ./bench_tokens.sh <mountpoint>
# Approximates tokens as words * 1.3 (close enough for comparison)
set -euo pipefail

MOUNT="${1:-/tmp/mnt/vercel}"

count_tokens() {
  local label="$1" content="$2"
  local chars words approx_tokens
  chars=$(echo "$content" | wc -c | tr -d ' ')
  words=$(echo "$content" | wc -w | tr -d ' ')
  # Rough approximation: 1 token ≈ 4 chars for English/JSON
  approx_tokens=$((chars / 4))
  echo "$label: ~${approx_tokens} tokens (${chars} chars, ${words} words)"
}

echo "=== Context Token Benchmark (Discovery) ==="
echo ""

# Filesystem: ls output
fs_discovery=$(ls -la "$MOUNT/" 2>/dev/null; ls "$MOUNT/deployments/" 2>/dev/null; ls "$MOUNT/projects/" 2>/dev/null)
count_tokens "Filesystem (ls)" "$fs_discovery"

# Filesystem: find all files
fs_find=$(find "$MOUNT" -maxdepth 1 -type f -o -type d 2>/dev/null)
count_tokens "Filesystem (find)" "$fs_find"

# CLI: help text
cli_help=$(vx --help 2>/dev/null)
count_tokens "CLI (vx --help)" "$cli_help"

# MCP resources: resources/list
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bench","version":"0.1"}}}'
NOTIF='{"jsonrpc":"2.0","method":"notifications/initialized"}'
mcp_list=$(printf '%s\n%s\n%s\n' "$INIT" "$NOTIF" '{"jsonrpc":"2.0","id":2,"method":"resources/list","params":{}}' | timeout 10 vx mcp 2>/dev/null | tail -1)
count_tokens "MCP resources (resources/list)" "$mcp_list"

# MCP templates
mcp_templates=$(printf '%s\n%s\n%s\n' "$INIT" "$NOTIF" '{"jsonrpc":"2.0","id":2,"method":"resources/templates/list","params":{}}' | timeout 10 vx mcp 2>/dev/null | tail -1)
count_tokens "MCP templates (templates/list)" "$mcp_templates"

echo ""
echo "Note: MCP tool schemas would be ~20,000 tokens for a full Vercel integration"
echo "(not measured — vx mcp uses resources, not tools)"
