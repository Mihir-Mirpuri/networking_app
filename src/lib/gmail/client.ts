import { google } from 'googleapis';
import prisma from '@/lib/prisma';

/**
 * Custom error classes for Gmail client operations
 */
export class NoGoogleAccountError extends Error {
  constructor(userId: string) {
    super(`No Google account linked for user ${userId}`);
    this.name = 'NoGoogleAccountError';
  }
}

export class NoRefreshTokenError extends Error {
  constructor(userId: string) {
    super(`No refresh token available for user ${userId}`);
    this.name = 'NoRefreshTokenError';
  }
}

export class GmailWatchError extends Error {
  constructor(message: string, public originalError?: unknown) {
    super(`Gmail watch failed: ${message}`);
    this.name = 'GmailWatchError';
  }
}

export class DatabaseUpdateError extends Error {
  constructor(message: string, public originalError?: unknown) {
    super(`Database update failed: ${message}`);
    this.name = 'DatabaseUpdateError';
  }
}

/**
 * Watch response interface
 */
export interface WatchResponse {
  historyId: string | null | undefined;
  expiration: string; // Milliseconds since epoch as string
}

/**
 * Gets an authenticated Gmail client for a user with automatic token refresh.
 * 
 * @param userId - The user ID to get the Gmail client for
 * @returns A configured Gmail API client instance
 * @throws {NoGoogleAccountError} If user has no linked Google account
 * @throws {NoRefreshTokenError} If account is missing refresh token
 */
export async function getGmailClient(userId: string) {
  // 1. Fetch user's OAuth account from Prisma
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: 'google',
    },
    select: {
      access_token: true,
      refresh_token: true,
      expires_at: true,
    },
  });

  if (!account) {
    throw new NoGoogleAccountError(userId);
  }

  // 2. Validate that refresh_token exists (required for auto-refresh)
  if (!account.refresh_token) {
    throw new NoRefreshTokenError(userId);
  }

  // 3. Get OAuth credentials from environment
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured (GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing)');
  }

  // 4. Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret
  );

  // 5. Set credentials with access_token and refresh_token
  oauth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token,
  });

  // 6. Configure automatic token refresh with database updates
  // Listen to 'tokens' event to update database when tokens are refreshed
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = tokens.expiry_date 
        ? Math.floor(tokens.expiry_date / 1000) 
        : (tokens.expires_in ? now + tokens.expires_in : null);

      try {
        await prisma.account.updateMany({
          where: {
            userId,
            provider: 'google',
          },
          data: {
            access_token: tokens.access_token,
            ...(expiresAt && { expires_at: expiresAt }),
          },
        });
        console.log('[Gmail Client] Token refreshed and database updated for user', userId);
      } catch (error) {
        console.error('[Gmail Client] Failed to update token in database:', error);
        // Don't throw - token refresh still succeeded, just DB update failed
      }
    }
  });

  // 7. Create and return Gmail client
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  return gmail;
}

/**
 * Starts Gmail mailbox watch notifications for a user.
 * 
 * @param userId - The user ID to start watch for
 * @param topicName - The Pub/Sub topic name (format: projects/PROJECT_ID/topics/TOPIC_NAME)
 * @returns Watch response with historyId and expiration
 * @throws {NoGoogleAccountError} If user has no linked Google account
 * @throws {NoRefreshTokenError} If account is missing refresh token
 * @throws {GmailWatchError} If Gmail API watch call fails
 * @throws {DatabaseUpdateError} If database update fails
 */
export async function startMailboxWatch(
  userId: string,
  topicName: string
): Promise<WatchResponse> {
  try {
    // 1. Get Gmail client
    const gmail = await getGmailClient(userId);

    // 2. Call users.watch()
    const watchResponse = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: topicName,
        labelIds: [], // Watch all messages (empty array = all labels)
      },
    });

    // 3. Extract expiration from response (milliseconds since epoch)
    const expirationMs = watchResponse.data.expiration;
    if (!expirationMs) {
      throw new GmailWatchError('No expiration returned from watch API');
    }

    // 4. Convert expiration to timestamp (expirationMs is a string of milliseconds)
    const expirationTimestamp = new Date(parseInt(expirationMs, 10));

    // 5. Get user's email address for gmail_sync_state
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user || !user.email) {
      throw new DatabaseUpdateError(`User ${userId} not found or has no email`);
    }

    // 6. Update or create gmail_sync_state record
    try {
      await prisma.gmail_sync_state.upsert({
        where: {
          userId: userId, // Uses unique constraint on userId
        },
        create: {
          id: crypto.randomUUID(), // Generate ID for new record
          userId: userId,
          email_address: user.email,
          watch_expiration: expirationTimestamp,
          historyId: watchResponse.data.historyId || null,
        },
        update: {
          watch_expiration: expirationTimestamp,
          historyId: watchResponse.data.historyId || null,
          updatedAt: new Date(),
        },
      });
    } catch (dbError) {
      throw new DatabaseUpdateError(
        `Failed to update gmail_sync_state for user ${userId}`,
        dbError
      );
    }

    // 7. Return watch response data
    return {
      historyId: watchResponse.data.historyId || null,
      expiration: expirationMs,
    };
  } catch (error) {
    // Handle known errors
    if (error instanceof NoGoogleAccountError || error instanceof NoRefreshTokenError) {
      throw error;
    }
    if (error instanceof GmailWatchError || error instanceof DatabaseUpdateError) {
      throw error;
    }

    // Handle Gmail API errors
    if (error && typeof error === 'object' && 'code' in error) {
      const apiError = error as { code?: number; message?: string };
      throw new GmailWatchError(
        apiError.message || `Gmail API error: ${apiError.code}`,
        error
      );
    }

    // Handle unknown errors
    throw new GmailWatchError(
      error instanceof Error ? error.message : 'Unknown error',
      error
    );
  }
}
