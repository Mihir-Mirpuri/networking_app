# Fix OAuth Redirect URI Error

## The Problem
Error: `redirect_uri_mismatch` when signing in with Google on production.

## The Solution

### Step 1: Add Production Redirect URI to Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Click on your **OAuth 2.0 Client ID**
5. Under **Authorized redirect URIs**, add:
   ```
   https://networkingapp-smoky.vercel.app/api/auth/callback/google
   ```
6. Click **Save**

### Step 2: Set NEXTAUTH_URL in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project: `networkingapp-smoky`
3. Go to **Settings** → **Environment Variables**
4. Add/Update:
   - **Key**: `NEXTAUTH_URL`
   - **Value**: `https://networkingapp-smoky.vercel.app`
   - **Environment**: Production (and Preview if needed)
5. Click **Save**

### Step 3: Redeploy

After adding the environment variable, trigger a new deployment:

```bash
vercel --prod
```

Or redeploy from Vercel dashboard.

## Your Redirect URIs Should Be:

✅ **Local Development:**
```
http://localhost:3000/api/auth/callback/google
```

✅ **Production:**
```
https://networkingapp-smoky.vercel.app/api/auth/callback/google
```

## Why This Happened

- Google OAuth only allows redirects to **exact URIs** you've pre-approved
- Your Google Cloud Console only had `localhost` configured
- Production app tried to redirect to Vercel URL → **mismatch error**

## Test

1. Wait 1-2 minutes for Google's changes to propagate
2. Try signing in again on production
3. Should work now! ✅
