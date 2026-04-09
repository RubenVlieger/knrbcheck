FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .
RUN mkdir -p /app/db

EXPOSE 3000

CMD ["node", "--max-old-space-size=256", "server.js"]