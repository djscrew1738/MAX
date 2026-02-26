FROM node:20-alpine

# Note: node:20-alpine already has a 'node' user (uid=1000)
# We just need to ensure proper permissions

WORKDIR /app

# Install dependencies for file processing
RUN apk add --no-cache curl ffmpeg poppler-utils

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production && \
    npm cache clean --force

# Copy application code
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p /app/uploads && \
    chown -R node:node /app

# Switch to non-root user (node user already exists)
USER node

# Expose port
EXPOSE 3210

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3210/health || exit 1

# Start application
CMD ["node", "src/index.js"]
