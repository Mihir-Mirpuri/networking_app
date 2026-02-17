# School WiFi Access Solution

## The Problem
School networks often block `.vercel.app` domains and intercept SSL certificates, preventing students from accessing the app.

## Solutions (Prioritized)

### 1. **Use Custom Domain** ⭐ (Best Long-term)
**Why:** Custom domains are less likely to be blocked than `.vercel.app` domains.

**Steps:**
1. Buy a domain (e.g., Namecheap, Google Domains) - ~$10-15/year
2. In Vercel Dashboard → Settings → Domains → Add your domain
3. Configure DNS per Vercel's instructions
4. Update Google OAuth redirect URI to include your custom domain
5. Update `NEXTAUTH_URL` environment variable

**Example:**
- Domain: `yournetworkingapp.com`
- OAuth redirect: `https://yournetworkingapp.com/api/auth/callback/google`

### 2. **Proactive IT Outreach**
Contact IT departments at target schools:

**Email Template:**
```
Subject: Request to Whitelist Domain for Educational Tool

Hi [IT Department],

We're building [Your App Name], a networking tool for students. 
We'd like to request whitelisting of our domain:

Domain: networkingapp-smoky.vercel.app
(or your custom domain)

This will allow students to access the tool on campus WiFi.

Thank you!
```

### 3. **User Instructions Page**
Add a help page in your app with instructions:

**Content:**
- "Having trouble accessing on school WiFi?"
- Options:
  - Use mobile data/hotspot
  - Contact your IT department to whitelist the domain
  - Use a VPN (if allowed by school policy)

### 4. **PWA (Progressive Web App)**
Make your app installable - sometimes works better on restricted networks.

**Implementation:**
- Add `manifest.json`
- Add service worker
- Users can "Add to Home Screen"

### 5. **Alternative: Mobile-First**
If school WiFi is too restrictive:
- Optimize for mobile data usage
- Make it work well on phones
- Students use cellular data

## Quick Implementation: Custom Domain

1. **Buy domain** (e.g., `networkingapp.io`)
2. **Vercel Dashboard:**
   - Settings → Domains → Add domain
   - Follow DNS setup instructions
3. **Google Cloud Console:**
   - Add new redirect URI: `https://yourdomain.com/api/auth/callback/google`
4. **Vercel Environment Variables:**
   - Update `NEXTAUTH_URL` to your custom domain
5. **Redeploy**

## Testing
After setup, test from school WiFi to confirm it works.
