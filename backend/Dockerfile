FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .
RUN npx prisma generate --ignore-engines

EXPOSE 3000

CMD ["node", "src/server.js"]