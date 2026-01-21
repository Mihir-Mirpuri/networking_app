# Vercel SSL Certificate Error Troubleshooting

## Error: `ERR_CERT_AUTHORITY_INVALID` on `networkingapp-smoky.vercel.app`

This error indicates the browser cannot verify the SSL certificate. For Vercel-provided domains (`.vercel.app`), this is unusual and typically indicates one of the following issues:

## Quick Fixes (Try These First)

### 1. **Clear Browser Cache & Try Incognito**
- Clear your browser cache completely
- Try accessing the site in an incognito/private window
- Try a different browser
- Try from a different network/device

### 2. **Check Vercel Dashboard**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to your project: `networkingapp-smoky`
3. Go to **Settings** → **Domains**
4. Check if any custom domains are configured incorrectly
5. If you added a custom domain, ensure it's properly configured:
   - DNS records are correct
   - SSL certificate status shows "Valid"
   - Domain is properly verified

### 3. **Redeploy the Project**
Sometimes a fresh deployment resolves SSL issues:

```bash
vercel --prod
```

Or trigger a redeploy from the Vercel dashboard.

### 4. **Check Project Settings**
In Vercel Dashboard → Settings → General:
- Ensure the project is not in a paused/suspended state
- Check for any warnings or errors
- Verify the deployment is marked as "Production"

## Common Causes & Solutions

### Cause 1: Custom Domain Misconfiguration
**If you added a custom domain:**
- The custom domain might be pointing to the wrong place
- DNS records might not be properly configured
- SSL certificate might not have propagated

**Solution:**
1. Go to Vercel Dashboard → Settings → Domains
2. Remove the custom domain temporarily
3. Test if `networkingapp-smoky.vercel.app` works
4. If it works, re-add the custom domain with correct DNS settings

### Cause 2: DNS Propagation Issues
Even though it's been hours, DNS can sometimes take longer.

**Solution:**
- Check DNS propagation: https://www.whatsmydns.net/
- Wait up to 24 hours for full propagation
- Try accessing from different geographic locations

### Cause 3: Browser/System Issues
**Solution:**
- Update your browser to the latest version
- Check system date/time is correct (SSL certificates are time-sensitive)
- Try from a different device/network
- Check if corporate firewall/proxy is interfering

### Cause 4: Vercel Regional CDN Issues
Sometimes regional CDN nodes can have issues.

**Solution:**
- Try accessing from a different location/VPN
- Check Vercel status page: https://www.vercel-status.com/
- Contact Vercel support if the issue persists

## Diagnostic Commands

Run these commands to diagnose:

```bash
# Check project info
vercel ls

# Check domains
vercel domains ls

# Check deployment
vercel inspect networkingapp-smoky.vercel.app

# Test SSL certificate
curl -vI https://networkingapp-smoky.vercel.app

# Check DNS
nslookup networkingapp-smoky.vercel.app
dig networkingapp-smoky.vercel.app
```

## If Nothing Works

1. **Contact Vercel Support:**
   - Go to Vercel Dashboard → Help → Contact Support
   - Provide:
     - Project name: `networkingapp-smoky`
     - Error: `ERR_CERT_AUTHORITY_INVALID`
     - Domain: `networkingapp-smoky.vercel.app`
     - Screenshot of the error

2. **Check Vercel Status:**
   - https://www.vercel-status.com/
   - Look for any ongoing SSL/certificate issues

3. **Try Creating a New Deployment:**
   ```bash
   vercel --prod --force
   ```

## Prevention

- Always use Vercel-provided domains for testing (they have automatic SSL)
- When adding custom domains, follow Vercel's DNS configuration guide exactly
- Wait for SSL certificate to show "Valid" in dashboard before using custom domain
- Keep Vercel CLI updated: `npm install -g vercel@latest`
