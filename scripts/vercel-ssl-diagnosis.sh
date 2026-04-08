#!/bin/bash

# Vercel SSL Certificate Diagnosis Script
# Run this to diagnose SSL certificate issues

echo "🔍 Vercel SSL Certificate Diagnosis"
echo "===================================="
echo ""

# Check if vercel CLI is available
if ! command -v vercel &> /dev/null; then
    echo "⚠️  Vercel CLI not found. Installing..."
    npm install -g vercel
fi

echo "1. Checking Vercel project information..."
vercel ls

echo ""
echo "2. Checking project domains..."
vercel domains ls

echo ""
echo "3. Checking deployment status..."
vercel inspect networkingapp-smoky.vercel.app

echo ""
echo "4. Testing SSL certificate..."
echo "Testing with curl..."
curl -vI https://networkingapp-smoky.vercel.app 2>&1 | grep -i "certificate\|ssl\|tls"

echo ""
echo "5. Checking DNS resolution..."
nslookup networkingapp-smoky.vercel.app

echo ""
echo "===================================="
echo "✅ Diagnosis complete!"
echo ""
echo "Common fixes:"
echo "- If custom domain: Check domain configuration in Vercel dashboard"
echo "- Clear browser cache and try incognito mode"
echo "- Wait 5-10 minutes for DNS/SSL propagation"
echo "- Redeploy: vercel --prod"
echo "- Check Vercel project settings for SSL configuration"
