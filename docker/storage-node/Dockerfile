FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

# Storage directory
RUN mkdir -p /data/chunks
VOLUME ["/data/chunks"]

EXPOSE 3002

ENV NODE_ENV=production
ENV STORAGE_PATH=/data/chunks

CMD ["node", "dist/storage-node-server.js"]
