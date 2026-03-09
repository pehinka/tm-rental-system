FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

# Vygeneruj ikony
RUN node generate-icons.js

# Setup databáze při prvním spuštění se dělá automaticky v server.js

EXPOSE 3000

CMD ["node", "server.js"]
