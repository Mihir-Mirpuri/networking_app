# Quick Start - Running Locally

This guide assumes you already have Supabase and Redis set up. You just need to run the Next.js app locally.

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create `.env` File

Create a `.env` file in the project root with your existing credentials:

```env
# Your Supabase Database URL
DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres?sslmode=require"

# Your Redis URL
REDIS_URL="redis://default:[PASSWORD]@[HOST]:6379"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"  # Generate with: openssl rand -base64 32

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Google Custom Search Engine
GOOGLE_CSE_API_KEY="your-google-cse-api-key"
GOOGLE_CSE_CX="bf53ffdb484f145c5"

# Optional APIs
APOLLO_API_KEY="your-apollo-api-key"  # Optional - for email enrichment
GROQ_API_KEY="your-groq-api-key"      # Optional - for AI email generation

# Test Mode (set to "true" to log emails instead of sending)
TEST_MODE="true"
```

### Generate NEXTAUTH_SECRET (if you don't have one):

```bash
openssl rand -base64 32
```

## Step 3: Generate Prisma Client

```bash
npm run db:generate
```

This generates the Prisma Client based on your schema. Make sure your Supabase database schema matches `prisma/schema.prisma`.

## Step 4: Start the Application

You need **two terminal windows**:

### Terminal 1: Next.js Dev Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Terminal 2: Worker (for AI email generation)

```bash
npm run worker
```

**Note**: The worker is only needed if you're using Groq AI for email generation. If you skip Groq API, emails will use placeholder templates (still functional).

## Step 5: Test the Application

1. Open `http://localhost:3000` in your browser
2. Sign in with Google (make sure OAuth is configured)
3. Search for alumni and test the functionality

## Troubleshooting

### Database Connection Issues

```bash
# Test Prisma connection
npx prisma studio
```

If Prisma Studio opens, your database connection is working.

### Redis Connection Issues

The worker will fail to start if Redis isn't accessible. Check your `REDIS_URL` in `.env`.

### Missing Environment Variables

The app will show errors in the console if required env vars are missing. Check the terminal output.

## Optional: Seed Demo Data

If you want to populate your database with test data:

```bash
npm run db:seed
```

This creates:
- Demo user
- Email templates
- Sample people
- Email drafts

## That's It!

Once both terminals are running:
- **Terminal 1**: Next.js dev server (frontend + API routes)
- **Terminal 2**: Worker (background job processing)

You can now test the full application locally while using your cloud Supabase and Redis instances.
