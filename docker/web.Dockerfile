FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm install --workspace=apps/web --include-workspace-root
COPY apps/web apps/web

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=apps/web", "--", "--host", "0.0.0.0"]
