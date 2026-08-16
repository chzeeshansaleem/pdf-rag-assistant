# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci --workspace=apps/backend --include-workspace-root
COPY apps/backend/ apps/backend/
RUN npm run build --workspace=apps/backend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci --workspace=apps/backend --omit=dev --include-workspace-root
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
EXPOSE 3001
CMD ["node", "apps/backend/dist/main.js"]
