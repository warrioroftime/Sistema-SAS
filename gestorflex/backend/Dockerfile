# Backend GestorFlex (API)
FROM node:20-alpine

WORKDIR /app

# Dependências (driver tedious; msnodesqlv8 é opcional e não é usado no Linux)
COPY package*.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY . .
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
