FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 5000

ENV NODE_ENV=production

CMD ["npm","run", "dev"]