FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# On expose le port de Vite
EXPOSE 5173
# On lance le serveur de développement
CMD ["npm", "run", "dev", "--", "--host"]
