FROM node:20-alpine

# Security: Create non-root user
RUN addgroup -g 1000 -S node && \
    adduser -u 1000 -S node -G node

WORKDIR /app

# Install dependencies for file processing
RUN apk add --no-cache curl ffmpeg poppler-utils

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production && \
    # Clean up npm cache
    npm cache clean --force

# Copy application code
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p /app/uploads && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3210

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3210/health || exit 1

# Start application
CMD ["node", "src/index.js"]
