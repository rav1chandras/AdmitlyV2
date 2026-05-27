#!/usr/bin/env bash
# ⚠ DESTRUCTIVE: wipes the database and rebuilds from scratch
echo ""
echo "⚠  This will DELETE all your data and rebuild from scratch."
read -p "   Are you sure? (type YES to confirm): " confirm
if [ "$confirm" != "YES" ]; then
  echo "   Cancelled."
  exit 0
fi
echo ""
echo "Resetting College Planner..."
docker compose down -v
docker compose up --build -d
echo ""
echo "✓  Reset complete. Demo data has been restored."
echo "   Open: http://localhost:3000"
echo ""
