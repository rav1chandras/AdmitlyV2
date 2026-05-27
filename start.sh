#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  College Planner — One-command launcher for Mac
#  Usage:  ./start.sh
# ─────────────────────────────────────────────────────────────

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        College Planner — Docker          ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Check Docker is running ───────────────────────────────
if ! docker info &>/dev/null; then
  echo -e "${RED}✗  Docker is not running.${RESET}"
  echo -e "   Open ${BOLD}Docker Desktop${RESET} from your Applications folder and wait"
  echo -e "   for the 🐳 whale icon to appear in the menu bar, then try again."
  echo ""
  exit 1
fi
echo -e "${GREEN}✓  Docker is running${RESET}"

# ── 2. Build + start containers ──────────────────────────────
echo ""
echo -e "${CYAN}▶  Building and starting containers...${RESET}"
echo -e "   (First build takes 2–4 minutes; subsequent starts are instant)"
echo ""

docker compose up --build -d

# ── 3. Wait for app to be ready ──────────────────────────────
echo ""
echo -e "${CYAN}⏳  Waiting for app to be ready...${RESET}"
ATTEMPTS=0
MAX=30
until curl -sf http://localhost:3000 &>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -ge $MAX ]; then
    echo -e "${RED}✗  App didn't respond after ${MAX} seconds.${RESET}"
    echo -e "   Check logs with:  docker compose logs app"
    exit 1
  fi
  printf "."
  sleep 2
done

echo ""
echo ""
echo -e "${GREEN}${BOLD}✓  App is live!${RESET}"
echo ""
echo -e "   🌐  Open in browser:  ${BOLD}http://localhost:3000${RESET}"
echo ""
echo -e "   Demo accounts:"
echo -e "   ${BOLD}student1@example.com${RESET}  /  password123  (Alex Johnson)"
echo -e "   ${BOLD}student2@example.com${RESET}  /  password123  (Sarah Chen)"
echo ""
echo -e "   Useful commands:"
echo -e "   ${YELLOW}docker compose logs -f app${RESET}    — watch live logs"
echo -e "   ${YELLOW}docker compose stop${RESET}           — stop without losing data"
echo -e "   ${YELLOW}docker compose down${RESET}           — stop and remove containers"
echo -e "   ${YELLOW}docker compose down -v${RESET}        — stop + wipe database"
echo ""
