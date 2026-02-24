FROM node:20-alpine AS base

# Install dependencies for file processing
RUN apk add --no-cache curl ffmpeg poppler-utils postgresql-client

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production && npm cache clean --force

# Production stage
FROM base AS production

WORKDIR /app

# Copy dependencies from base
COPY --from=base /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads /app/backups /app/data

# Expose port
EXPOSE 3210

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3210/health || exit 1

# Run migrations and start
CMD ["sh", "-c", "node src/db/migrate.js up && node src/index.js"]

# Development stage
FROM base AS development

WORKDIR /app

# Install all dependencies (including dev)
RUN npm ci

COPY . .

RUN mkdir -p /app/uploads /app/backups /app/data

EXPOSE 3210

CMD ["npm", "run", "dev"]
