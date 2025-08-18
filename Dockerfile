FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Ensure uploads directory exists and is writable
RUN mkdir -p uploads && \
    chown -R node:node /usr/src/app

# Set environment
ENV NODE_ENV=production \
    PORT=3000

USER node

EXPOSE 3000

# Optional basic healthcheck against config endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "http=require('http');http.get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]


