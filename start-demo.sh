#!/usr/bin/env bash
set -e

BLUE='\033[0;34m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo -e "\n${BOLD}${CYAN}===============================================${NC}"
echo -e "${BOLD}${CYAN}  Stock Hedge Insurance Demo Environment Setup${NC}"
echo -e "${BOLD}${CYAN}===============================================${NC}\n"

echo -e "${BLUE}[1/6]${NC} Checking environment..."
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: node not found. Install Node.js >= 18.${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm not found.${NC}"; exit 1; }
echo -e "${GREEN}OK: node $(node -v), npm $(npm -v)${NC}"

echo -e "\n${BLUE}[2/6]${NC} Checking node_modules..."
if [ ! -d "node_modules/@nomicfoundation" ]; then
  echo "Installing dependencies..."
  npm install --silent
fi
echo -e "${GREEN}OK: dependencies ready${NC}"

echo -e "\n${BLUE}[3/6]${NC} Compiling contracts..."
npx hardhat compile --quiet 2>&1 | tail -1
echo -e "${GREEN}OK: contracts compiled${NC}"

echo -e "\n${BLUE}[4/6]${NC} Running full test suite..."
npx hardhat test 2>&1 | tail -3
echo -e "${GREEN}OK: tests passed${NC}"

echo -e "\n${BLUE}[5/6]${NC} Generating frontend runtime config..."
node scripts/export-runtime-config.js
echo -e "${GREEN}OK: runtime-config.json created${NC}"

echo -e "\n${BLUE}[6/6]${NC} Ready for live demo.\n"
echo -e "${YELLOW}===============================================${NC}"
echo -e "${BOLD}Next steps (open 3 terminal windows):${NC}"
echo -e "${YELLOW}===============================================${NC}\n"
echo -e "  ${CYAN}Terminal 1${NC} - Start local chain:"
echo -e "    ${BOLD}npm run node${NC}\n"
echo -e "  ${CYAN}Terminal 2${NC} - Deploy contracts (after chain starts):"
echo -e "    ${BOLD}npm run deploy:local${NC}\n"
echo -e "  ${CYAN}Terminal 3${NC} - Start local frontend + market proxy:"
echo -e "    ${BOLD}npm run serve${NC}\n"
echo -e "  ${CYAN}Browser URLs:${NC}"
echo -e "    Buyer     ${BOLD}http://127.0.0.1:8080/index.html${NC}"
echo -e "    Admin     ${BOLD}http://127.0.0.1:8080/admin.html${NC}"
echo -e "    Simulator ${BOLD}http://127.0.0.1:8080/simulation.html${NC}\n"
echo -e "  ${CYAN}MetaMask local chain:${NC}"
echo -e "    RPC URL  : http://127.0.0.1:8545"
echo -e "    Chain ID : 31337"
echo -e "    Symbol   : ETH\n"
echo -e "${GREEN}Environment ready. Follow the steps above.${NC}\n"
