FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --production=false || \
    (rm -f package-lock.json* && npm install --production=false)

COPY src ./src
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/server.js"]
