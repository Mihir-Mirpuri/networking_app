/**
 * Email Verification Service
 *
 * Uses Emailable API to verify if email addresses are deliverable.
 * Only used for pattern-generated emails (Apollo handles its own verification).
 */

import emailable from 'emailable';

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
    // - "undeliverable" → never deliverable
    let deliverable = false;
    if (response.state === 'deliverable') {
      deliverable = true;
    } else if (response.state === 'risky' && acceptAll) {
      // Catch-all domain: trust the pattern since we can't verify anyway
      deliverable = true;
    }

    console.log(
      `[EmailVerification] ${email} → ${response.state} (${response.reason}, score=${score}, acceptAll=${acceptAll}) → deliverable=${deliverable} in ${latencyMs}ms`
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
 * Verify multiple emails with catch-all domain detection.
 * For catch-all domains, only verifies ONE email to detect the domain type,
 * then skips verification for remaining emails (saves API calls).
 * Returns results in the same order as input.
 */
export async function verifyEmailsBatch(
  emails: string[],
  concurrency: number = 5
): Promise<VerificationResult[]> {
  if (emails.length === 0) return [];

  const startTime = Date.now();
  console.log(`[EmailVerification] Batch verifying ${emails.length} emails...`);

  // Group emails by domain
  const emailsByDomain = new Map<string, string[]>();
  for (const email of emails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain) {
      if (!emailsByDomain.has(domain)) {
        emailsByDomain.set(domain, []);
      }
      emailsByDomain.get(domain)!.push(email);
    }
  }

  // Track results by email for correct ordering
  const resultsByEmail = new Map<string, VerificationResult>();
  let apiCallsSaved = 0;

  // Process each domain
  for (const [domain, domainEmails] of Array.from(emailsByDomain.entries())) {
    // Verify first email to check if domain is catch-all
    const firstEmail = domainEmails[0];
    const firstResult = await verifyEmail(firstEmail);
    resultsByEmail.set(firstEmail, firstResult);

    if (firstResult.acceptAll) {
      // Domain is catch-all - skip verification for remaining emails
      // Mark them all as deliverable (we can't verify individual mailboxes anyway)
      console.log(
        `[EmailVerification] ${domain} is catch-all, skipping ${domainEmails.length - 1} remaining verifications`
      );
      apiCallsSaved += domainEmails.length - 1;

      for (let i = 1; i < domainEmails.length; i++) {
        resultsByEmail.set(domainEmails[i], {
          email: domainEmails[i],
          deliverable: true, // Trust pattern for catch-all
          state: 'risky',
          reason: 'catch_all_domain_skipped',
          score: firstResult.score,
          acceptAll: true,
          latencyMs: 0,
        });
      }
    } else {
      // Not catch-all - verify each email individually
      const remainingEmails = domainEmails.slice(1);

      // Process in chunks for rate limiting
      for (let i = 0; i < remainingEmails.length; i += concurrency) {
        const chunk = remainingEmails.slice(i, i + concurrency);
        const chunkResults = await Promise.all(chunk.map(verifyEmail));

        for (let j = 0; j < chunk.length; j++) {
          resultsByEmail.set(chunk[j], chunkResults[j]);
        }

        if (i + concurrency < remainingEmails.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  }

  // Return results in original order
  const results = emails.map((email) => resultsByEmail.get(email)!);

  const totalTime = Date.now() - startTime;
  const deliverableCount = results.filter((r) => r.deliverable).length;

  console.log(
    `[EmailVerification] Batch complete: ${deliverableCount}/${emails.length} deliverable in ${totalTime}ms (saved ${apiCallsSaved} API calls)`
  );

  return results;
}
