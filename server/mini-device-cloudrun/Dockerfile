# Build context MUST be the project root; reuses the reviewed JS business core.
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app/server/mini-device-cloudrun
COPY server/mini-device-cloudrun/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node server/mini-device-cloudrun/*.js ./
COPY --chown=node:node cloudfunctions/miniDeviceGateway/lib/ /app/cloudfunctions/miniDeviceGateway/lib/
COPY --chown=node:node cloudfunctions/miniDeviceGateway/providers/ /app/cloudfunctions/miniDeviceGateway/providers/
COPY --chown=node:node tools/mini-location-tcp/protocol.js /app/tools/mini-location-tcp/protocol.js
USER node
EXPOSE 8080
CMD ["node", "server.js"]
