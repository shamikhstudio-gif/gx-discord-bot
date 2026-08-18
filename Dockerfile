FROM node:22-alpine

# Install audio & media tools (ffmpeg, build tools)
RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
