# AlumniReach

A finance/consulting recruiting outreach tool that helps you discover alumni connections and send personalized outreach emails.

## Features

- **People Discovery**: Auto-discovers people for a given university, company, and role using Google Custom Search
- **Email Enrichment**: Enriches work emails using Apollo (optional)
- **Template System**: Fill email templates with tokens like `{first_name}`, `{company}`, `{university}`, `{role}`
- **Source Links**: View discovery and research links for each person
- **Email Editor**: Edit individual emails before sending
- **Gmail Integration**: Send emails directly via Gmail OAuth
- **Rate Limiting**: Max 30 emails/day per user, max 10 per batch
- **Audit Logging**: Full audit log of all sent emails

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- TailwindCSS
- Prisma + PostgreSQL (Supabase)
- NextAuth (Google OAuth)
- Gmail API for sending

## Prerequisites

- Node.js 18+
- Supabase account (free tier works)
- Google Cloud project with:
  - OAuth 2.0 credentials (for sign-in and Gmail)
  - Custom Search Engine API enabled
- Apollo API key (optional, for email enrichment)

## Setup

### 1. Clone and Install

```bash
git clone <repo>
cd networking_app
npm install
```

### 2. Set Up Supabase Database

1. Go to [Supabase](https://supabase.com/) and create a new project
2. Once your project is ready, go to **SQL Editor**
3. Copy and paste the contents of `supabase_schema.sql` into the SQL Editor
4. Click **Run** to execute the schema
5. Go to **Project Settings** → **Database** → **Connection String**
6. Copy the connection string (use the "URI" format)

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database (Supabase connection string)
DATABASE_URL="postgresql://user:password@host:port/database?sslmode=require"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-secret-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Google Custom Search Engine
GOOGLE_CSE_API_KEY="your-google-cse-api-key"
GOOGLE_CSE_CX="bf53ffdb484f145c5"

# Apollo (optional, for email enrichment)
APOLLO_API_KEY=""

# Test mode (set to "true" to log emails instead of sending)
TEST_MODE="false"
```

**Note:** Generate `NEXTAUTH_SECRET` by running:
```bash
openssl rand -base64 32
```

### 4. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable APIs:
   - Google Custom Search API
   - Gmail API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
5. Add scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.send`

### 5. Initialize Database

```bash
# Generate Prisma Client
npm run db:generate

# Note: Database schema is already applied via Supabase SQL Editor
# No need to run db:push if using Supabase
```

### 6. (Optional) Seed Demo Data

```bash
# Seed email templates for all users
tsx prisma/seed-templates.ts

# Seed demo people and relationships
npm run db:seed
```

This creates:
- Demo user (demo@example.com)
- Email templates
- Sample people with various email statuses (VERIFIED, UNVERIFIED, MISSING, MANUAL)
- Email drafts for review

### 7. Start Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Usage

### Searching for People

1. Sign in with Google
2. Enter search criteria:
   - University (e.g., "Harvard University")
   - Company (e.g., "Goldman Sachs")
   - Role (e.g., "Analyst")
   - Limit (number of people to find)
   - Email template to use
3. Click "Search"
4. The system will:
   - Search using Google Custom Search API
   - Parse person names from results
   - Enrich with emails using Apollo (if configured)
   - Create Person and UserCandidate records
   - Generate email drafts from your template
   - Store source links (LinkedIn, etc.)

### Reviewing and Editing Emails

1. Review the list of discovered people
2. Click "Review" on any person to:
   - Edit the email subject and body
   - See email status (Verified, Unverified, Missing)
   - View source links
3. Make any edits needed before sending

### Sending Emails

1. For each person, you can:
   - Click "Send" to send immediately
   - Click "Review" to edit first, then send
   - Use "Send All" to batch send multiple emails
2. Only people with verified or manually confirmed emails can be sent
3. Daily limit: 30 emails per user
4. Batch limit: 10 emails per "Send All" click

### Rate Limits

- **Daily limit**: 30 emails per user per day
- **Batch limit**: 10 emails per batch
- Only verified or manually confirmed emails can be sent

### Test Mode

Set `TEST_MODE=true` in `.env` to log emails to console instead of sending. Useful for testing without actually sending emails.

## Project Structure

```
src/
├── app/
│   ├── actions/          # Server actions (search, send, sendlog)
│   ├── api/              # API routes
│   ├── auth/             # Auth pages
│   └── page.tsx          # Home page (search interface)
├── components/
│   ├── search/           # Search-related components
│   │   ├── SearchForm.tsx
│   │   ├── SearchPageClient.tsx
│   │   ├── ResultsList.tsx
│   │   ├── PersonCard.tsx
│   │   └── ExpandedReview.tsx
│   ├── sidebar/          # Sidebar components
│   └── Header.tsx        # Header component
├── lib/
│   ├── db/               # Database helpers
│   │   └── person-service.ts
│   ├── services/         # Business logic
│   │   ├── discovery.ts  # Google CSE search
│   │   ├── enrichment.ts # Apollo email lookup
│   │   └── gmail.ts      # Gmail sending
│   ├── auth.ts           # NextAuth config
│   ├── prisma.ts         # Prisma client
│   └── constants.ts      # Constants (templates, etc.)
└── types/                # TypeScript declarations
```

## Database Schema

The app uses a shared Person model with user-specific UserCandidate relationships:

- **Person**: Shared person data (name, company, role, LinkedIn URL)
- **UserCandidate**: User-specific relationship data (email, email status, university context)
- **SourceLink**: Discovery links (LinkedIn, etc.) shared across users
- **EmailDraft**: AI-generated drafts for review
- **EmailTemplate**: User's email templates
- **SendLog**: Audit log of all sent emails

This architecture allows:
- Shared discovery (if User A finds John's LinkedIn, User B benefits)
- User-specific emails and relationships
- Collective knowledge building

## Guardrails

- No LinkedIn scraping (uses Google CSE only)
- No auto-sending (user must click "Send")
- Only verified or manually confirmed emails can be sent
- Full audit log of all sends
- Daily send limits enforced

## Troubleshooting

### "No Google account linked"

Make sure you've signed in with Google and granted Gmail send permissions.

### Discovery finds no people

- Check that `GOOGLE_CSE_API_KEY` is set correctly
- Verify the Custom Search Engine is configured properly
- Try different search terms (university, company, role)

### Emails not sending

- Check `TEST_MODE` is not set to `true`
- Verify Gmail API is enabled in Google Cloud
- Check the OAuth scopes include `gmail.send`
- Verify your Google account has Gmail access

### Database connection errors

- Verify `DATABASE_URL` is correct (from Supabase Project Settings)
- Check that the schema was applied in Supabase SQL Editor
- Ensure `npm run db:generate` was run after schema changes

### Prisma errors

- Run `npm run db:generate` after any schema changes
- Make sure your Prisma schema matches your Supabase database schema

## License

MIT
