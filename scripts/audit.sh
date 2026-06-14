#!/bin/bash
set -e
echo "=== npm audit ==="
npm audit --production || true
echo "=== cargo audit (signal-server) ==="
cd signal-server && cargo audit || true
