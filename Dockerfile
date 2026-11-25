# syntax=docker/dockerfile:1
# Corporate Sustainability Intelligence: one image for the web app, the
# extraction worker and the scheduler (see compose.yaml and docs/DEPLOYMENT.md).

FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
# Compilers only in the build stage, in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prebuild validates the curated data and seeds data/benchmark.db; pages are pre-built from it.
RUN npm run build

FROM node:22.20.0-bookworm-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CSI_DATA_DIR=/data
WORKDIR /app
# tsx (a dev dependency) runs the worker and scripts, so dependencies are not pruned.
COPY --from=build --chown=node:node /app /app
# The curated data in the image seeds the data volume on first start only.
RUN mkdir -p /app/seed-data /data \
 && cp -R /app/data/companies /app/data/peer-groups.json /app/data/discovery.json /app/seed-data/ \
 && rm -rf /app/data \
 && chown -R node:node /app/seed-data /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/deploy/entrypoint.sh"]
CMD ["web"]
