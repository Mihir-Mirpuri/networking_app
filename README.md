# AlumniReach

A finance/consulting recruiting outreach tool that helps you discover alumni connections and send personalized outreach emails.

## Features

- **Candidate Discovery**: Auto-discovers ~30 people for a given school, company, and role keywords using Google Custom Search
- **Email Enrichment**: Enriches work emails using Apollo (optional)
- **Template System**: Fill email templates with tokens like `{first_name}`, `{company}`, `{school}`
- **Source Links**: View discovery and research links for each candidate
- **Email Editor**: Edit individual emails before sending
- **Gmail Integration**: Send emails directly via Gmail OAuth
- **Rate Limiting**: Max 30 emails/day per user, max 10 per batch
- **Audit Logging**: Full audit log of all sent emails

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- TailwindCSS
- Prisma + PostgreSQL
- NextAuth (Google OAuth)
- Gmail API for sending
- BullMQ + Redis for background jobs

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- Google Cloud project with:
  - OAuth 2.0 credentials (for sign-in and Gmail)
  - Custom Search Engine API enabled
- Apollo API key (optional)

## Setup

### 1. Clone and Install

```bash
git clone <repo>
cd alumni-reach
npm install
```

### 2. Start Database & Redis

```bash
docker-compose up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database
DATABASE_URL="postgresql://alumnireach:alumnireach@localhost:5432/alumnireach"

# Redis
REDIS_URL="redis://localhost:6379"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-secret-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Google Custom Search Engine
GOOGLE_CSE_API_KEY="your-google-cse-api-key"
GOOGLE_CSE_CX="bf53ffdb484f145c5"

# Apollo (optional)
APOLLO_API_KEY=""

# Test mode (set to "true" to log emails instead of sending)
TEST_MODE="false"
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
npm run db:generate
npm run db:push
```

### 6. (Optional) Seed Demo Data

```bash
npm run db:seed
```

This creates a demo campaign with mock candidates for testing the UI.

### 7. Start Development

In two terminals:

```bash
# Terminal 1: Start Next.js
npm run dev

# Terminal 2: Start worker
npm run worker
```

Open [http://localhost:3000](http://localhost:3000)

## Usage

### Creating a Campaign

1. Sign in with Google
2. Click "New Campaign"
3. Enter:
   - Campaign name
   - School (e.g., "Harvard University")
   - Company (e.g., "Goldman Sachs")
   - Role keywords (comma-separated, e.g., "analyst, associate")
4. Click "Create & Start Discovery"

### Discovery Process

The system will:
1. Generate multiple search queries
2. Search using Google Custom Search API
3. Parse candidate names from results
4. Store discovery source links
5. Create initial email drafts from template

### Enriching Emails

If you have an Apollo API key configured:
1. Click "Enrich Emails" after discovery completes
2. The system will attempt to find verified work emails

### Sending Emails

1. Review and edit individual emails as needed
2. For candidates without verified emails, you can:
   - Enter an email manually
   - Check "I confirm this email is correct"
3. Select candidates to email (checkbox)
4. Click "Send Selected"

### Rate Limits

- **Daily limit**: 30 emails per user per day
- **Batch limit**: 10 emails per "Send Selected" click
- Only verified or manually confirmed emails can be sent

### Test Mode

Set `TEST_MODE=true` in `.env` to log emails to console instead of sending.

## Project Structure

```
src/
├── app/
│   ├── actions/          # Server actions
│   ├── api/              # API routes
│   ├── auth/             # Auth pages
│   ├── campaign/[id]/    # Campaign detail page
│   └── page.tsx          # Home page
├── components/
│   ├── campaign/         # Campaign-related components
│   └── ...               # Shared components
├── lib/
│   ├── services/         # Business logic
│   ├── auth.ts           # NextAuth config
│   ├── prisma.ts         # Prisma client
│   └── queue.ts          # BullMQ queues
├── types/                # TypeScript declarations
└── worker/               # Background job processor
```

## Guardrails

- No LinkedIn scraping (uses Google CSE only)
- No auto-sending (user must click "Send Selected")
- Only verified or manually confirmed emails can be sent
- Full audit log of all sends
- Easy campaign deletion (cascades to all data)

## Troubleshooting

### "No Google account linked"

Make sure you've signed in with Google and granted Gmail send permissions.

### Discovery finds no candidates

- Check that `GOOGLE_CSE_API_KEY` is set correctly
- Verify the Custom Search Engine is configured properly
- Try different role keywords

### Emails not sending

- Check `TEST_MODE` is not set to `true`
- Verify Gmail API is enabled in Google Cloud
- Check the OAuth scopes include `gmail.send`

## License

MIT
