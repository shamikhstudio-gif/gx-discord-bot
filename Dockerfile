FROM node:20-alpine

# Install audio & media tools (ffmpeg)
RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
