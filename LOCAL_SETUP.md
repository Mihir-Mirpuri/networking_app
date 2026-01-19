# Local Setup Guide

This guide will walk you through setting up AlumniReach on your local machine for testing.

## Prerequisites

- **Node.js 18+** installed ([Download](https://nodejs.org/))
- **Docker Desktop** installed (for PostgreSQL and Redis) ([Download](https://www.docker.com/products/docker-desktop))
- **Git** (if cloning from repository)
- **Google Cloud Account** (for OAuth and APIs)
- **Supabase Account** (optional - can use local PostgreSQL instead)

## Step 1: Install Dependencies

```bash
cd /Users/kavithanair/Documents/networking_app
npm install
```

## Step 2: Set Up Local Database & Redis (Docker)

The project includes a `docker-compose.yml` file for local development.

```bash
# Start PostgreSQL and Redis containers
docker-compose up -d

# Verify containers are running
docker ps
```

You should see:
- `alumnireach-postgres` on port 5432
- `alumnireach-redis` on port 6379

**Database credentials:**
- Host: `localhost`
- Port: `5432`
- Database: `alumnireach`
- User: `alumnireach`
- Password: `alumnireach`

## Step 3: Set Up Database Schema

You have two options:

### Option A: Use Local PostgreSQL (Recommended for Testing)

```bash
# Set DATABASE_URL to local PostgreSQL
# (We'll do this in Step 4)

# Generate Prisma Client
npm run db:generate

# Push schema to database
npm run db:push
```

### Option B: Use Supabase (Production-like)

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → **New Query**
3. Copy contents of `supabase_schema.sql` and run it
4. Get connection string from **Settings** → **Database** → **Connection String** (URI format)

## Step 4: Configure Environment Variables

Create a `.env` file in the project root:

```bash
touch .env
```

Add the following variables:

```env
# Database (use local PostgreSQL or Supabase)
# For local Docker:
DATABASE_URL="postgresql://alumnireach:alumnireach@localhost:5432/alumnireach"
# For Supabase (replace with your actual connection string):
# DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres?sslmode=require"

# Redis (local Docker)
REDIS_URL="redis://localhost:6379"
# For Upstash/Cloud Redis:
# REDIS_URL="redis://default:[PASSWORD]@[HOST]:6379"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
# Generate a secret: openssl rand -base64 32
NEXTAUTH_SECRET="your-generated-secret-here"

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Google Custom Search Engine
GOOGLE_CSE_API_KEY="your-google-cse-api-key"
GOOGLE_CSE_CX="bf53ffdb484f145c5"

# Apollo API (optional - for email enrichment)
APOLLO_API_KEY="your-apollo-api-key"

# Groq AI (for email generation)
GROQ_API_KEY="your-groq-api-key"

# Test Mode (set to "true" to log emails instead of sending)
TEST_MODE="true"
```

### Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

Copy the output and paste it as `NEXTAUTH_SECRET` in your `.env` file.

## Step 5: Set Up Google Cloud Project

### 5.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - **Google Custom Search API**
   - **Gmail API**

### 5.2 Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URIs:
   ```
   http://localhost:3000/api/auth/callback/google
   ```
5. Copy the **Client ID** and **Client Secret** to your `.env` file

### 5.3 Set Up Custom Search Engine

1. Go to [Google Custom Search](https://programmablesearchengine.google.com/)
2. Click **Add** to create a new search engine
3. Sites to search: `linkedin.com` (or leave blank for entire web)
4. Click **Create**
5. Go to **Setup** → **Basics**
6. Copy the **Search engine ID** (CX) - default is `bf53ffdb484f145c5`
7. Go to **Setup** → **Advanced** → **Get your API key**
8. Copy the **API Key** to your `.env` file as `GOOGLE_CSE_API_KEY`

### 5.4 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **External** (for testing)
3. Fill in required fields:
   - App name: `AlumniReach`
   - User support email: Your email
   - Developer contact: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.send`
5. Add test users (your Google account email)
6. Save and continue

## Step 6: Get API Keys (Optional Services)

### Apollo API (Email Enrichment)

1. Sign up at [apollo.io](https://www.apollo.io/)
2. Get your API key from the dashboard
3. Add to `.env` as `APOLLO_API_KEY`
4. **Note**: This is optional - the app will work without it (emails will be marked as MISSING)

### Groq AI (Email Generation)

1. Sign up at [groq.com](https://groq.com/)
2. Get your API key from the dashboard
3. Add to `.env` as `GROQ_API_KEY`
4. **Note**: Without this, email generation will fail, but placeholder drafts will still work

## Step 7: Initialize Database

```bash
# Generate Prisma Client
npm run db:generate

# If using local PostgreSQL, push schema
npm run db:push

# (Optional) Seed demo data
npm run db:seed
```

## Step 8: Start the Application

### Terminal 1: Start Next.js Dev Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Terminal 2: Start the Worker (for AI email generation)

```bash
npm run worker
```

**Important**: The worker is required for AI email generation. Without it, emails will remain as placeholder drafts.

## Step 9: Test the Application

1. **Open browser**: Navigate to `http://localhost:3000`
2. **Sign in**: Click "Sign in" and authenticate with Google
   - Make sure to grant Gmail send permissions
3. **Search for people**:
   - University: e.g., "Harvard University"
   - Company: e.g., "Goldman Sachs"
   - Role: e.g., "Analyst"
   - Limit: e.g., 5
   - Template: Select a template
4. **Review results**: You should see discovered people with placeholder emails
5. **Wait for AI generation**: If Groq API is configured, emails will be generated in the background
6. **Review and send**: Click "Review" to edit emails, then "Send"

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check connection
psql postgresql://alumnireach:alumnireach@localhost:5432/alumnireach

# If connection fails, restart container
docker-compose restart postgres
```

### Redis Connection Issues

```bash
# Check if Redis is running
docker ps | grep redis

# Test Redis connection
redis-cli -h localhost -p 6379 ping
# Should return: PONG

# If connection fails, restart container
docker-compose restart redis
```

### Prisma Issues

```bash
# Reset Prisma Client
rm -rf node_modules/.prisma
npm run db:generate
```

### NextAuth Issues

- Make sure `NEXTAUTH_URL` matches exactly: `http://localhost:3000`
- Verify `NEXTAUTH_SECRET` is set and is a valid base64 string
- Check that Google OAuth redirect URI matches exactly

### Worker Not Processing Jobs

- Verify Redis is running: `docker ps | grep redis`
- Check worker logs for errors
- Verify `REDIS_URL` is correct in `.env`
- Make sure `GROQ_API_KEY` is set if using AI generation

### Google CSE Not Finding People

- Verify `GOOGLE_CSE_API_KEY` is correct
- Check API quota in Google Cloud Console
- Try different search terms (university, company, role)

### Emails Not Sending

- Check `TEST_MODE` - if `true`, emails are only logged
- Verify Gmail API is enabled in Google Cloud
- Check OAuth scopes include `gmail.send`
- Review browser console and server logs for errors

## Quick Start Checklist

- [ ] Node.js 18+ installed
- [ ] Docker Desktop installed and running
- [ ] Dependencies installed (`npm install`)
- [ ] Docker containers running (`docker-compose up -d`)
- [ ] `.env` file created with all required variables
- [ ] Google Cloud project set up with OAuth credentials
- [ ] Google Custom Search Engine configured
- [ ] Database schema initialized (`npm run db:generate` and `npm run db:push`)
- [ ] Next.js dev server running (`npm run dev`)
- [ ] Worker running (`npm run worker`)
- [ ] Can access `http://localhost:3000`
- [ ] Can sign in with Google
- [ ] Can search for people

## Testing Without External APIs

If you want to test without setting up all APIs:

1. **Set `TEST_MODE=true`** - Emails won't actually send
2. **Skip Apollo API** - Emails will be marked as MISSING (you can manually add them)
3. **Skip Groq API** - Emails will use placeholder templates (still functional)
4. **Skip Google CSE** - You can manually add people via database

## Next Steps

Once everything is running:

1. Try searching for alumni
2. Review the discovered people
3. Edit email drafts
4. Send test emails (with `TEST_MODE=true`)
5. Check the send log in the sidebar
6. Explore the database with Prisma Studio: `npx prisma studio`

## Need Help?

- Check the main [README.md](./README.md) for more details
- Review [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for database setup
- Check server logs in terminal for error messages
- Review browser console for frontend errors
