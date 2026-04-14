#!/usr/bin/env bash
#
# ClaudeDeck Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ATERCATES/claude-deck/main/scripts/install.sh | bash
#
# Options:
#   bash install.sh --port 3011 --ssh-host myserver.com --ssh-port 22 -y
#
# Update:
#   bash install.sh --update
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_warn()    { echo -e "${YELLOW}==>${NC} $1"; }
log_error()   { echo -e "${RED}==>${NC} $1"; }

INSTALL_DIR="$HOME/.claude-deck"
PKG_NAME="@atercates/claude-deck"
NODE_MIN_VERSION=24

# ─── Parse CLI flags ──────────────────────────────────────────────────────────

FLAG_PORT=""
FLAG_SSH_HOST=""
FLAG_SSH_PORT=""
FLAG_NONINTERACTIVE=false
FLAG_UPDATE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)        FLAG_PORT="$2";        shift 2 ;;
    --ssh-host)    FLAG_SSH_HOST="$2";    shift 2 ;;
    --ssh-port)    FLAG_SSH_PORT="$2";    shift 2 ;;
    --yes|-y)      FLAG_NONINTERACTIVE=true; shift ;;
    --update|-u)   FLAG_UPDATE=true;      shift ;;
    *)             shift ;;
  esac
done

# ─── Interactive prompts ──────────────────────────────────────────────────────

ask() {
  local prompt="$1" default="$2" var="$3"
  if [[ -t 0 ]] && [[ "$FLAG_NONINTERACTIVE" == false ]]; then
    if [[ -n "$default" ]]; then
      read -rp "$(echo -e "${BOLD}$prompt${NC} ${DIM}[$default]${NC}: ")" value
      eval "$var=\"${value:-$default}\""
    else
      read -rp "$(echo -e "${BOLD}$prompt${NC}: ")" value
      eval "$var=\"$value\""
    fi
  else
    eval "$var=\"$default\""
  fi
}

# ─── Update mode ──────────────────────────────────────────────────────────────

if [[ "$FLAG_UPDATE" == true ]]; then
  echo ""
  echo -e "${BOLD}  ClaudeDeck Update${NC}"
  echo ""

  if [[ ! -d "$INSTALL_DIR" ]]; then
    log_error "ClaudeDeck is not installed. Run without --update first."
    exit 1
  fi

  # Ensure node/pnpm in PATH
  [[ -x "$HOME/.n/bin/node" ]] && export PATH="$HOME/.n/bin:$PATH"

  cd "$INSTALL_DIR"
  CURRENT=$(node -e "console.log(require('./node_modules/$PKG_NAME/package.json').version)" 2>/dev/null || echo "unknown")
  log_info "Current version: $CURRENT"

  log_info "Updating $PKG_NAME..."
  pnpm update "$PKG_NAME" --latest 2>&1 | tail -3

  NEW=$(node -e "console.log(require('./node_modules/$PKG_NAME/package.json').version)" 2>/dev/null || echo "unknown")

  if [[ "$CURRENT" == "$NEW" ]]; then
    log_success "Already on latest version ($NEW)"
  else
    log_success "Updated: $CURRENT -> $NEW"
  fi

  # Copy source and rebuild
  log_info "Copying source..."
  rsync -a --delete \
    --exclude='node_modules' --exclude='.next' --exclude='.env' --exclude='*.db' --exclude='*.db-journal' \
    "$INSTALL_DIR/node_modules/$PKG_NAME/" "$INSTALL_DIR/app/"

  cd "$INSTALL_DIR/app"
  log_info "Installing dependencies..."
  pnpm install > /dev/null 2>&1

  log_info "Building..."
  pnpm build 2>&1 | tail -5

  # Restart service if running
  if systemctl is-active --quiet claudedeck 2>/dev/null; then
    log_info "Restarting service..."
    sudo systemctl restart claudedeck
    sleep 2
    if systemctl is-active --quiet claudedeck; then
      log_success "ClaudeDeck $NEW running"
    else
      log_error "Service failed to start. Check: sudo journalctl -u claudedeck -f"
    fi
  else
    log_success "ClaudeDeck $NEW ready. Start with: sudo systemctl start claudedeck"
  fi

  echo ""
  exit 0
fi

# ─── Header ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  ClaudeDeck Installer${NC}"
echo -e "${DIM}  Self-hosted web UI for Claude Code sessions${NC}"
echo ""

# ─── Check prerequisites ─────────────────────────────────────────────────────

log_info "Checking prerequisites..."

if ! command -v tmux &> /dev/null; then
  log_warn "tmux is not installed (required for session management)"
  ask "Install tmux now? (y/n)" "y" INSTALL_TMUX
  if [[ "$INSTALL_TMUX" == "y" ]]; then
    sudo apt install -y tmux
    log_success "tmux installed"
  else
    log_error "tmux is required. Install it manually and re-run."
    exit 1
  fi
fi

# ─── Node.js ──────────────────────────────────────────────────────────────────

install_node() {
  log_info "Installing Node.js $NODE_MIN_VERSION..."
  local N_PREFIX="$HOME/.n"
  mkdir -p "$N_PREFIX"
  curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n -o /tmp/n
  chmod +x /tmp/n
  N_PREFIX="$N_PREFIX" /tmp/n "$NODE_MIN_VERSION"
  rm -f /tmp/n
  export PATH="$N_PREFIX/bin:$PATH"
  log_success "Node.js $(node --version) installed"
}

NODE_OK=false
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -ge "$NODE_MIN_VERSION" ]]; then
    NODE_OK=true
    log_success "Node.js $(node --version) found"
  fi
fi

if [[ "$NODE_OK" == false ]] && [[ -x "$HOME/.n/bin/node" ]]; then
  export PATH="$HOME/.n/bin:$PATH"
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -ge "$NODE_MIN_VERSION" ]]; then
    NODE_OK=true
    log_success "Node.js $(node --version) found in ~/.n"
  fi
fi

if [[ "$NODE_OK" == false ]]; then
  install_node
fi

# pnpm
if ! command -v pnpm &> /dev/null; then
  log_info "Installing pnpm..."
  npm install -g pnpm > /dev/null 2>&1
  log_success "pnpm $(pnpm --version) installed"
else
  log_success "pnpm $(pnpm --version) found"
fi

# ─── Configuration ────────────────────────────────────────────────────────────

echo ""
log_info "Configuration"
echo ""

PORT="${FLAG_PORT}"
SSH_HOST="${FLAG_SSH_HOST}"
SSH_PORT="${FLAG_SSH_PORT}"

ask "Port" "3011" PORT
ask "SSH host for VS Code remote button (leave empty to skip)" "" SSH_HOST

if [[ -n "$SSH_HOST" ]]; then
  ask "SSH port" "22" SSH_PORT
fi

echo ""

# ─── Install from npm ────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Initialize pnpm project if first install
if [[ ! -f "package.json" ]]; then
  echo '{"name":"claude-deck-instance","private":true}' > package.json
fi

log_info "Installing $PKG_NAME from npm..."
pnpm add "$PKG_NAME" 2>&1 | tail -3

# Copy source to app directory (so we can build and run independently)
log_info "Setting up application..."
rsync -a --delete \
  --exclude='node_modules' --exclude='.next' --exclude='.env' --exclude='*.db' --exclude='*.db-journal' \
  "$INSTALL_DIR/node_modules/$PKG_NAME/" "$INSTALL_DIR/app/"

cd "$INSTALL_DIR/app"

# Dependencies
log_info "Installing dependencies..."
pnpm install > /dev/null 2>&1

# Approve native builds if needed
if ! grep -q "onlyBuiltDependencies" package.json 2>/dev/null; then
  node -e "
    const pkg = require('./package.json');
    pkg.pnpm = pkg.pnpm || {};
    pkg.pnpm.onlyBuiltDependencies = ['better-sqlite3', 'esbuild', 'node-pty', 'sharp'];
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  pnpm install > /dev/null 2>&1
fi

# Write .env
log_info "Writing .env..."
cat > "$INSTALL_DIR/app/.env" << EOF
PORT=$PORT
EOF

if [[ -n "$SSH_HOST" ]]; then
  echo "SSH_HOST=$SSH_HOST" >> "$INSTALL_DIR/app/.env"
fi
if [[ -n "$SSH_PORT" ]] && [[ "$SSH_PORT" != "22" ]]; then
  echo "SSH_PORT=$SSH_PORT" >> "$INSTALL_DIR/app/.env"
fi

# Build
log_info "Building for production (this may take a minute)..."
pnpm build

# tmux config
if [[ ! -f "$HOME/.tmux.conf" ]] || ! grep -q "mouse on" "$HOME/.tmux.conf" 2>/dev/null; then
  log_info "Enabling tmux mouse support..."
  echo "set -g mouse on" >> "$HOME/.tmux.conf"
fi

# ─── Systemd service ─────────────────────────────────────────────────────────

NODE_BIN=$(which node)
TSX_BIN="$INSTALL_DIR/app/node_modules/.bin/tsx"
APP_DIR="$INSTALL_DIR/app"

SERVICE_FILE="[Unit]
Description=ClaudeDeck
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PATH=$(dirname "$NODE_BIN"):$APP_DIR/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$TSX_BIN --env-file=.env server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"

INSTALL_SERVICE=false
if [[ -t 0 ]] && [[ "$FLAG_NONINTERACTIVE" == false ]]; then
  echo ""
  ask "Install as systemd service? (y/n)" "y" INSTALL_SVC_ANSWER
  [[ "$INSTALL_SVC_ANSWER" == "y" ]] && INSTALL_SERVICE=true
else
  INSTALL_SERVICE=true
fi

if [[ "$INSTALL_SERVICE" == true ]]; then
  log_info "Installing systemd service..."
  echo "$SERVICE_FILE" | sudo tee /etc/systemd/system/claudedeck.service > /dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable claudedeck > /dev/null 2>&1
  sudo systemctl restart claudedeck
  sleep 2

  if systemctl is-active --quiet claudedeck; then
    log_success "Service running on port $PORT"
  else
    log_error "Service failed to start. Check: sudo journalctl -u claudedeck -f"
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "")

echo ""
echo -e "${GREEN}${BOLD}  ClaudeDeck${VERSION:+ v$VERSION} installed!${NC}"
echo ""
echo -e "  ${BOLD}Local:${NC}    http://localhost:$PORT"
if [[ -n "$SSH_HOST" ]]; then
  echo -e "  ${BOLD}Remote:${NC}   Configure your reverse proxy to point to port $PORT"
fi
echo ""
echo -e "  ${DIM}First visit will prompt you to create an account.${NC}"
echo -e "  ${DIM}Manage:  sudo systemctl {start|stop|restart|status} claudedeck${NC}"
echo -e "  ${DIM}Update:  bash install.sh --update${NC}"
echo ""
