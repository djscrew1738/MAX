# Production Deployment Guide

This guide covers deploying the Max API in a production environment with all security hardening measures.

## Prerequisites

- Docker 24.0+ and Docker Compose 2.20+
- Tailscale installed and configured (for secure remote access)
- Ollama installed on host with required models

## Environment Setup

### 1. Clone and Configure

```bash
git clone <repository>
cd max
cp .env.example .env
```

### 2. Generate Secure API Key

```bash
# Generate a secure random key (32+ characters)
openssl rand -base64 48
```

Add this to your `.env` file:
```bash
MAX_API_KEY=<your-generated-key>
```

### 3. Configure Database Credentials

```bash
# Generate secure database password
openssl rand -base64 32
```

Add to `.env`:
```bash
POSTGRES_DB=max
POSTGRES_USER=max
POSTGRES_PASSWORD=<generated-password>
```

### 4. Configure Email (Optional but Recommended)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=burro@ctlplumbing.com
```

### 5. Configure CORS Origins

```bash
ALLOWED_ORIGINS=http://localhost:3210,http://100.83.120.32:4000
TAILSCALE_IP=100.83.120.32
```

## Deployment Modes

### Development Mode

```bash
docker compose up -d
```

### Production Mode (with Nginx SSL)

```bash
# Set up SSL certificates first
mkdir -p data/ssl
cp your-cert.pem data/ssl/cert.pem
cp your-key.pem data/ssl/key.pem

# Deploy with nginx
docker compose --profile production up -d
```

### Full Security Mode (with ClamAV virus scanning)

```bash
# Enable ClamAV in .env
CLAMAV_ENABLED=true

# Deploy with all profiles
docker compose --profile production --profile full up -d
```

### With Automated Backups

```bash
docker compose --profile backup up -d
```

## Security Checklist

Before deploying to production, verify:

- [ ] `MAX_API_KEY` is set to a secure random value (no default)
- [ ] `POSTGRES_PASSWORD` is set to a secure random value (no default)
- [ ] `NODE_ENV` is set to `production`
- [ ] ClamAV is enabled for virus scanning (`CLAMAV_ENABLED=true`)
- [ ] Containers run as non-root user
- [ ] Resource limits are configured
- [ ] Nginx is used for SSL termination
- [ ] Automated backups are configured
- [ ] Rate limiting is enabled
- [ ] CORS origins are explicitly whitelisted
- [ ] WebSocket authentication is enabled (via token parameter)

## Health Monitoring

### Health Endpoint

```bash
# Deep health check including dependencies
curl http://localhost:3210/health

# Response:
# {
#   "status": "healthy",
#   "timestamp": "2024-02-26T17:00:00Z",
#   "services": {
#     "db": { "status": "ok", "latency": 5 },
#     "whisper": { "status": "ok" },
#     "ollama": { "status": "ok" }
#   }
# }
```

### Status Endpoint

```bash
# Database stats (no auth required)
curl http://localhost:3210/status
```

## WebSocket Connection

WebSocket connections require authentication via token parameter:

```javascript
const ws = new WebSocket('ws://100.83.120.32:4000/ws?token=YOUR_API_KEY');

ws.onopen = () => {
  console.log('Connected');
  // Subscribe to specific job updates
  ws.send(JSON.stringify({ type: 'subscribe', jobIds: [1, 2, 3] }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## Backup and Recovery

### Automated Backups

When using the backup profile, daily backups are created in `./data/backups/`:

- Daily backups kept for 7 days
- Weekly backups kept for 4 weeks  
- Monthly backups kept for 6 months

### Manual Backup

```bash
# Create manual backup
docker exec max-postgres pg_dump -U max max > backup_$(date +%Y%m%d).sql
```

### Restore from Backup

```bash
# Stop the application
docker compose down

# Restore database
docker exec -i max-postgres psql -U max max < backup_20240226.sql

# Restart
docker compose up -d
```

## Troubleshooting

### Database Connection Issues

```bash
# Check database health
docker compose logs postgres

# Verify connection string
env | grep DATABASE_URL
```

### API Key Authentication Failures

```bash
# Check API key is set
docker compose exec api env | grep MAX_API_KEY

# Test with curl
curl -H "x-api-key: YOUR_KEY" http://localhost:3210/api/jobs
```

### WebSocket Connection Issues

```bash
# Verify WebSocket endpoint
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  "http://localhost:3210/ws?token=YOUR_KEY"
```

### Virus Scanning Issues

```bash
# Check ClamAV status
docker compose logs clamav

# Update virus definitions
docker compose exec clamav freshclam
```

## Security Updates

### Updating Dependencies

```bash
# Rebuild with latest dependencies
docker compose build --no-cache api

# Restart services
docker compose up -d
```

### Rotating API Keys

1. Generate new key
2. Update `.env` file
3. Restart API service
4. Update Android app configuration
5. Revoke old key

## Monitoring

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api

# Structured JSON logs (production)
docker compose logs -f api | jq
```

### Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df
```

## SSL Certificate Renewal

If using Let's Encrypt or similar:

```bash
# Renew certificates
sudo certbot renew

# Copy to SSL directory
sudo cp /etc/letsencrypt/live/yourdomain/fullchain.pem data/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain/privkey.pem data/ssl/key.pem

# Reload nginx
docker compose exec nginx nginx -s reload
```
