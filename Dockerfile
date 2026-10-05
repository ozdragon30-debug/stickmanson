# Stick Arena: Reborn — multiplayer server image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app.js ./
COPY server ./server
COPY docs ./docs
USER node
EXPOSE 1138
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:1138/healthz || exit 1
CMD ["node", "app.js"]
