FROM node:20-alpine

WORKDIR /app

# Install dependencies for file processing
RUN apk add --no-cache curl ffmpeg poppler-utils

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 3210

CMD ["node", "src/index.js"]
