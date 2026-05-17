FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled source
COPY dist/ ./dist/

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
