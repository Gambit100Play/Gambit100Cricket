FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY .env ./

EXPOSE 5051

CMD ["node", "src/signer.js"]
