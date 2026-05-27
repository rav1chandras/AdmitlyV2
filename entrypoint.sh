#!/bin/sh
# entrypoint.sh — Runs seed scripts before starting the Next.js server
echo "[entrypoint] Seeding colleges_master from CSV..."
node /app/scripts/seed-colleges.js
echo "[entrypoint] Starting Next.js server..."
exec node server.js
