# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Dependencies installer (shared base)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install OS-level dependencies needed for native modules (bcrypt, etc.)
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Development (hot-reload via ts-node-dev)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS development

WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Builder — compile TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Production runner — lean image, no dev deps
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

# Only copy production dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --frozen-lockfile --only=production && npx prisma generate

# Copy compiled output
COPY --from=builder /app/dist ./dist

EXPOSE 3000

USER node

CMD ["node", "dist/server.js"]
