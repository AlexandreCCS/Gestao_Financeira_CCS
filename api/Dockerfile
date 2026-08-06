# [05/05/2026 - Alexandre Carvalho] API Fastify para gestor-financeiro
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000
CMD ["node","src/server.js"]
