# 🚀 Media Campaign Analytics Microservice

> A production-ready REST API microservice for managing and analysing advertising campaigns. Built with Node.js, TypeScript (strict mode), Express, Prisma, and PostgreSQL.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Architecture Overview

```
src/
├── config/         # Environment validation (Zod)
├── lib/            # Shared infrastructure (Prisma singleton)
├── middleware/     # JWT auth guard, global error handler
├── modules/
│   ├── auth/       # Login → JWT
│   └── campaigns/  # CRUD + Analytics
├── types/          # Express.Request augmentation
├── app.ts          # Express factory (testable — no listen())
└── server.ts       # Entry point + graceful shutdown
```

## Quick Start (Docker)

```bash
# 1. Clone & configure environment
cp .env.example .env
# Edit .env and set a strong JWT_SECRET

# 2. Spin up Postgres + API with hot reload
docker-compose up

# 3. Seed demo data
docker-compose exec api npm run db:seed
```

The API will be available at **http://localhost:3000**

## Quick Start (Local Development)

```bash
# Prerequisites: Node 20+, PostgreSQL 16 running locally

npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

## API Reference

### Health Check
```
GET /health
```

### Authentication
```
POST /auth/login
Content-Type: application/json

{ "email": "advertiser@example.com", "password": "advert1234" }
```
Returns: `{ "data": { "token": "<jwt>", "expiresIn": "1h" } }`

### Campaigns (all require Authorization: Bearer <token>)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/campaigns` | List user's campaigns (paginated) |
| `POST` | `/campaigns` | Create a new campaign |
| `GET` | `/campaigns/analytics` | Aggregated views + clicks per campaign |

#### List Campaigns — Query Params
| Param | Type | Description |
|-------|------|-------------|
| `status` | `ACTIVE` \| `PAUSED` | Filter by status |
| `page` | `number` | Page number (default: 1) |
| `limit` | `number` | Items per page (default: 20, max: 100) |

#### Analytics Response Shape
```json
{
  "status": "success",
  "data": [
    {
      "id": "cuid...",
      "title": "Summer Sale 2024",
      "status": "ACTIVE",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "totalViews": 5300,
      "totalClicks": 285
    }
  ]
}
```

## The N+1 Solution

The analytics endpoint uses a **single SQL query** with a `LEFT JOIN` and `GROUP BY`, avoiding the classic N+1 problem:

```sql
SELECT
  c.id,
  c.title,
  c.status,
  c.created_at,
  COALESCE(SUM(m.views),  0) AS "totalViews",
  COALESCE(SUM(m.clicks), 0) AS "totalClicks"
FROM campaigns c
LEFT JOIN metrics m ON m.campaign_id = c.id
WHERE c.user_id = $1
GROUP BY c.id, c.title, c.status, c.created_at
ORDER BY c.created_at DESC;
```

`LEFT JOIN` ensures campaigns with zero metrics still appear. `COALESCE` converts `NULL` → `0`.

## Running Tests

```bash
# Ensure the test DB is available (Docker or local Postgres)
# Set TEST_DATABASE_URL in .env

npm test

# With coverage report
npm run test:coverage
```

## Database Schema

```
User ──┐
       ├── Campaign ──┐
                      └── Metric
```

- **User**: `id (cuid)`, `email (unique)`, `password_hash`, `role (ADMIN|ADVERTISER)`
- **Campaign**: `id`, `user_id (FK)`, `title`, `status (ACTIVE|PAUSED)`, `created_at`
- **Metric**: `id`, `campaign_id (FK)`, `views`, `clicks`, `recorded_at`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload (ts-node-dev) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production build |
| `npm test` | Run integration tests |
| `npm run test:coverage` | Tests with coverage report |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

## Demo Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@example.com` | `admin1234` |
| Advertiser | `advertiser@example.com` | `advert1234` |
