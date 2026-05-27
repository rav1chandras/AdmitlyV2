# Admitly — AI College Admissions Planner

## Deploy to Vercel (Production)

### 1. Database — Neon Postgres (free tier)
1. Go to [neon.tech](https://neon.tech) → create a new project
2. Copy your **Connection string** (looks like `postgresql://user:pass@host/db?sslmode=require`)
3. Run the schema SQL from `docker/init.sql` in the Neon SQL editor to create all tables and seed data

### 2. Deploy to Vercel
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Set these **Environment Variables** in Vercel dashboard:

| Variable | Value |
|---|---|
| `POSTGRES_URL` | Your Neon connection string |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` to generate |
| `OPENAI_API_KEY` | From [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `ADMIN_EMAILS` | Comma-separated admin email addresses |

4. Click **Deploy**

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.local.example .env.local

# 3. Run dev server
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000)

Demo accounts: `student1@example.com` / `password123`

---

## Docker (Self-hosted)

```bash
# Edit OPENAI_API_KEY in docker-compose.yml first
docker compose up --build
```

App runs at [http://localhost:3000](http://localhost:3000)

---

## Features
- **Profile Integrity** — Academic scoring with admissions probability tracker
- **Explore Colleges** — Search 100 colleges, drag to Reach/Target/Safety buckets
- **Essays & Writing** — AI essay generation grounded in student journey
- **Fit & Readiness Report** — Counselor-ready PDF export
- **Key Dates & News** — Test calendars, deadlines, AI admissions news
- **Admin Console** — Student management, LLM usage, date editor
