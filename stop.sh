#!/usr/bin/env bash
# Stop containers (keeps your database data intact)
echo ""
echo "Stopping College Planner..."
docker compose stop
echo ""
echo "✓  Stopped. Your data is saved."
echo "   Run ./start.sh to start again."
echo ""
