FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node sms-server.mjs collector.mjs ./
COPY --chown=node:node sms ./sms
COPY --chown=node:node dist/core.mjs dist/conversation.mjs ./dist/
RUN mkdir -p /app/.state && chown node:node /app/.state && chmod 700 /app/.state
USER node
ENV SMS_BIND_HOST=0.0.0.0 SMS_PORT=8080 SMS_STATE_DIR=/app/.state NODE_ENV=production
EXPOSE 8080
VOLUME ["/app/.state"]
CMD ["node", "sms-server.mjs"]
