/**
 * Email Verification Service
 *
 * Uses Emailable API to verify if email addresses are deliverable.
 * Only used for pattern-generated emails (Apollo handles its own verification).
 *
 * Optimization: For known catch-all domains (stored in CompanyEmailPattern.acceptAll),
 * we skip Emailable verification entirely and mark emails as deliverable.
 */

import emailable from 'emailable';
import prisma from '@/lib/prisma';

const client = emailable(process.env.EMAILABLE_API_KEY!);

export interface VerificationResult {
  email: string;
  deliverable: boolean;
  state: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  reason: string;
  score: number;
  acceptAll: boolean;  // True if domain is catch-all (accepts any email)
  latencyMs: number;
}

/**
 * Verify a single email address using Emailable API
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  const start = Date.now();

  try {
    const response = await client.verify(email);
    const latencyMs = Date.now() - start;

    const acceptAll = response.accept_all === true;
    const score = response.score || 0;

    // Map Emailable states to deliverable boolean
    // - "deliverable" → always deliverable
    // - "risky" with accept_all → trust it (catch-all domain, can't verify individual mailboxes)
    // - "risky" without accept_all → not deliverable
    // - "unknown" with unavailable_smtp/unexpected_error → trust pattern (SMTP blocked, common for enterprises)
    // - "undeliverable" → never deliverable
    let deliverable = false;
    if (response.state === 'deliverable') {
      deliverable = true;
    } else if (response.state === 'risky' && acceptAll) {
      // Catch-all domain: trust the pattern since we can't verify anyway
      deliverable = true;
    } else if (
      response.state === 'unknown' &&
      (response.reason === 'unavailable_smtp' || response.reason === 'unexpected_error')
    ) {
      // SMTP verification blocked (common for large enterprises like BCG, McKinsey, etc.)
      // Trust the pattern since we can't verify either way
      deliverable = true;
    }

    const trustReason =
      response.state === 'unknown' &&
      (response.reason === 'unavailable_smtp' || response.reason === 'unexpected_error')
        ? ', trusting pattern'
        : '';
    console.log(
      `[EmailVerification] ${email} → ${response.state} (${response.reason}, score=${score}, acceptAll=${acceptAll}${trustReason}) → deliverable=${deliverable} in ${latencyMs}ms`
    );

    return {
      email,
      deliverable,
      state: response.state as VerificationResult['state'],
      reason: response.reason || 'unknown',
      score,
      acceptAll,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    console.error(`[EmailVerification] Error verifying ${email}:`, error);

    // On error, return unknown state - don't block the flow
    return {
      email,
      deliverable: false,
      state: 'unknown',
      reason: 'verification_error',
      score: 0,
      acceptAll: false,
      latencyMs,
    };
  }
}

/**
 * Get known catch-all domains from CompanyEmailPattern table
 */
async function getKnownCatchAllDomains(): Promise<Set<string>> {
  const patterns = await prisma.companyEmailPattern.findMany({
    where: { acceptAll: true },
    select: { domain: true },
  });
  return new Set(patterns.map((p) => p.domain.toLowerCase()));
}

/**
 * Get known unverifiable domains (SMTP blocks verification)
 */
async function getKnownUnverifiableDomains(): Promise<Set<string>> {
  const patterns = await prisma.companyEmailPattern.findMany({
    where: { unverifiable: true },
    select: { domain: true },
  });
  return new Set(patterns.map((p) => p.domain.toLowerCase()));
}

/**
 * Mark a domain as unverifiable (SMTP blocks verification)
 */
async function markDomainAsUnverifiable(domain: string): Promise<void> {
  try {
    await prisma.companyEmailPattern.updateMany({
      where: { domain: domain.toLowerCase() },
      data: { unverifiable: true },
    });
    console.log(`[EmailVerification] Marked ${domain} as unverifiable (SMTP blocked)`);
  } catch (error) {
    // Ignore errors - domain may not exist in patterns table yet
  }
}
