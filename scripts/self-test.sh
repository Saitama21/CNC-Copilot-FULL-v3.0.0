#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/server.mjs
node --check src/calc-engine.mjs
node --check public/app.js
npm test
printf '\nSELF-TEST OK\n'
