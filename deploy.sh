#!/bin/bash
# ============================================
# Max - AI Field Assistant Deployment Script
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TAILSCALE_IP="100.83.120.32"
EXTERNAL_PORT="4000"

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🔨 MAX — AI Field Assistant Deployment                ║"
echo "║   Tailscale: ${TAILSCALE_IP}:${EXTERNAL_PORT}                            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root for port binding
if [ "$EUID" -ne 0 ] && [ "${EXTERNAL_PORT}" -lt 1024 ]; then
    echo -e "${RED}⚠️  Port ${EXTERNAL_PORT} requires root privileges${NC}"
    echo "Run with: sudo $0"
    exit 1
fi

# Check Docker
echo -e "${BLUE}🔍 Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}⚠️  docker-compose not found, trying 'docker compose'...${NC}"
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Check .env file
echo -e "${BLUE}🔍 Checking environment configuration...${NC}"
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}⚠️  .env not found, copying from .env.example${NC}"
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Please edit .env with your configuration before continuing${NC}"
        exit 1
    else
        echo -e "${RED}❌ No .env or .env.example found${NC}"
        exit 1
    fi
fi

# Check Tailscale IP connectivity
echo -e "${BLUE}🔍 Checking Tailscale connectivity...${NC}"
if command -v tailscale &> /dev/null; then
    if tailscale status &> /dev/null; then
        TS_IP=$(tailscale ip -4 2>/dev/null || echo "")
        echo -e "${GREEN}✅ Tailscale is running (IP: ${TS_IP:-unknown})${NC}"
    else
        echo -e "${YELLOW}⚠️  Tailscale daemon not running${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Tailscale not installed${NC}"
fi

# Create necessary directories
echo -e "${BLUE}📁 Creating directories...${NC}"
mkdir -p data/postgres
mkdir -p data/whisper-models
mkdir -p uploads
mkdir -p nginx/ssl

# Set permissions
chmod 755 data uploads 2>/dev/null || true

# Pull latest images
echo -e "${BLUE}📥 Pulling Docker images...${NC}"
$DOCKER_COMPOSE pull

# Build API image
echo -e "${BLUE}🔨 Building API image...${NC}"
$DOCKER_COMPOSE build api

# Stop existing containers
echo -e "${BLUE}🛑 Stopping existing containers...${NC}"
$DOCKER_COMPOSE down --remove-orphans

# Start services
echo -e "${BLUE}🚀 Starting services...${NC}"
$DOCKER_COMPOSE up -d

# Wait for services
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
sleep 5

# Health checks
echo -e "${BLUE}🏥 Running health checks...${NC}"

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:${EXTERNAL_PORT}/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API is healthy${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -ne "${YELLOW}⏳ Waiting for API... (${RETRY_COUNT}/${MAX_RETRIES})\r${NC}"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ API failed to start${NC}"
    echo -e "${YELLOW}📋 Checking logs...${NC}"
    $DOCKER_COMPOSE logs --tail=50 api
    exit 1
fi

# Get status
echo -e "${BLUE}📊 Getting server status...${NC}"
STATUS=$(curl -sf http://localhost:${EXTERNAL_PORT}/status 2>/dev/null || echo '{"status":"unknown"}')
echo $STATUS | python3 -m json.tool 2>/dev/null || echo $STATUS

# Show final info
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅ Deployment Complete!                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║   Access URLs:                                           ║"
echo "║   • Local:      http://localhost:${EXTERNAL_PORT}                    ║"
echo "║   • Tailscale:  http://${TAILSCALE_IP}:${EXTERNAL_PORT}            ║"
echo "║                                                          ║"
echo "║   Commands:                                              ║"
echo "║   • Logs:       docker compose logs -f api              ║"
echo "║   • Stop:       docker compose down                     ║"
echo "║   • Restart:    docker compose restart api              ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Show running containers
echo -e "${BLUE}📋 Running containers:${NC}"
$DOCKER_COMPOSE ps
