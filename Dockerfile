# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Only runtime deps (sdk + zod); the bundled dist imports them externally.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Bind to all interfaces inside the container; expose the HTTP transport.
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
USER node

# Provide credentials + MCP_AUTH_TOKEN at runtime, e.g.:
#   docker run -e UMAMI_API_KEY=... -e MCP_AUTH_TOKEN=... -p 8787:8787 umami-mcp
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "dist/http.js"]
