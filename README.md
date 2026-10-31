# Campaign Analytics

An ad platform for a streaming service. Advertisers plan campaigns, the platform decides which ad plays in each ad break, every view and click is measured, and a live dashboard shows how each campaign is performing.

Built with Node.js, TypeScript, Express, Prisma and PostgreSQL, with a React dashboard. All brands, shows and traffic in the demo are fictional.

## Run it

You need Node.js 22 or newer. Nothing else: no Docker and no database install.

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and choose **Advertiser demo**. Press `Ctrl+C` to stop.

The first run creates a local PostgreSQL in `.data/`, sets up the tables, and adds 30 days of demo data. Your data stays between runs. To start fresh, stop the app and delete `.data/`.

| Account | Email | Password | Sees |
|---|---|---|---|
| Advertiser | `advertiser@example.com` | `advert1234` | Their own campaigns |
| Admin | `admin@example.com` | `admin1234` | Every campaign and its owner |

## What it does

Streaming services with an ad tier show short ads before, during and after episodes. Three parties meet here:

- **The advertiser** wants their ad seen by the right people for a set budget.
- **The platform** has to choose an ad for every ad break and keep each campaign on schedule.
- **The viewer** watches, and the player reports what happened.

This app is the part in the middle:

```
 Advertiser ──── dashboard ───▶ Campaigns: budget, dates, targeting
                                    │
 Player: "ad break in this show" ──▶ GET /ad-decision ── picks the best campaign
                                    │
 Player: "it played, was clicked" ─▶ POST /events ────── adds up hourly totals
                                    │
 Advertiser ◀─── live charts ────── Analytics
```

`npm run dev` also starts a simulator that plays the part of the viewers, so the numbers move while you watch. Run with `SIMULATE=0` to turn it off.

**Things to try:** create a campaign targeting one country and watch it start delivering within seconds. Pause it and see the numbers stop. Compare Connected TV with Mobile on a campaign's page.

### The terms on the dashboard

| Term | Meaning |
|---|---|
| **Impression** | One ad played once to one viewer. |
| **Click-through rate (CTR)** | The share of impressions that were clicked. TV is low because viewers rarely can. |
| **Ads watched to the end** | The share of ads that played to completion. Mid-roll is highest: viewers want the show back. |
| **CPM** | The price per 1,000 impressions. |
| **Ad slot** | Pre-roll (before the episode), mid-roll (during) or post-roll (after). |
| **Flight** | The dates a campaign runs. |
| **Impression goal** | The number of impressions the advertiser bought. |
| **Pacing** | Delivery so far compared with an even schedule. Behind means the campaign may miss its goal. |

### How an ad gets chosen

For each ad break, `/ad-decision` keeps campaigns that are active, inside their dates, under their goal and budget, and matching the country, device, slot and show genre. It then picks the one furthest behind schedule, with the higher CPM winning ties. A campaign is marked completed when it reaches its goal or budget, or passes its end date.

## How it stays fast

- **Hourly rollups.** Events are added into one row per campaign, hour, show, slot, country and device, not stored one by one. The table grows with variety, not with traffic.
- **Batched writes.** A batch of up to 1,000 events becomes a single upsert.
- **One query per view.** Analytics run as a single SQL statement, so more campaigns never means more database round trips.

## API

Dashboard routes need `Authorization: Bearer <token>` from login. Ad server routes need an `x-ingest-key` header.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service and database status |
| `POST` | `/auth/login` | Sign in; limited to 20 attempts per 15 minutes |
| `GET` | `/campaigns` | List campaigns, with `status`, `page` and `limit` |
| `POST` | `/campaigns` | Create a campaign |
| `GET` | `/campaigns/:id` | Read a campaign |
| `PATCH` | `/campaigns/:id` | Change a campaign, including pausing and resuming |
| `DELETE` | `/campaigns/:id` | Delete a campaign and its metrics |
| `GET` | `/campaigns/analytics` | Totals, pacing and spend per campaign, with `from` and `to` |
| `GET` | `/campaigns/analytics/timeseries` | Performance over time across campaigns |
| `GET` | `/campaigns/:id/analytics` | One campaign with its trend and breakdowns |
| `GET` | `/shows` | The show catalogue |
| `GET` | `/ad-decision` | Choose an ad: `showId`, `slot`, `country`, `device` |
| `POST` | `/events` | Record `IMPRESSION`, `CLICK` and `COMPLETION` events |

## Project layout

```
prisma/          Database schema, migrations and demo data
scripts/         Local database, dev startup and traffic simulator
src/modules/     auth, campaigns, delivery (ad decisions and events), shows
src/middleware/  Login guard, API key guard, error handling
tests/           Integration tests against a real PostgreSQL
web/             The React dashboard
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start everything |
| `npm test` | Run the integration tests |
| `npm run test:coverage` | Tests with a coverage report |
| `npm run lint` | Lint the API |
| `npm run format` | Format the code |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Compile the API |
| `npm run db:seed` | Replace all data with fresh demo data |
| `npm run db:studio` | Browse the database in Prisma Studio |

## Docker

With Docker installed, this runs the database and the app at **http://localhost:3000**:

```bash
docker compose up --build
```

For a real deployment, build the `production` image target and set `DATABASE_URL`, `JWT_SECRET` and `INGEST_API_KEY`. The app refuses to start in production with the placeholder secrets.

## Known limits

This is a working demonstration, not a system that has run under real load. [ROADMAP.md](./ROADMAP.md) shows where it's heading.

- Sending the same event batch twice counts it twice, because events have no IDs.
- Budgets and goals are checked as events arrive, so a campaign can slightly overshoot under heavy traffic.
- Each ad decision adds up the campaign's delivery. Real ad traffic would need a cache in front of this.
- `/ad-decision` and `/events` share one API key, which suits a trusted ad server, not code running on viewers' devices.
- Advertisers can't sign up in the app; accounts come from the seed data.
