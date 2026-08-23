FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspace=apps/server --include-workspace-root
COPY apps/server apps/server
COPY .env.example .env.example

EXPOSE 3001
CMD ["npm", "run", "start", "--workspace=apps/server"]
