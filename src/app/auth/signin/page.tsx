import { redirect } from 'next/navigation';

/**
 * Legacy sign-in page — redirects to the landing page at `/`.
 * Preserves any query params (callbackUrl, error, ref) so the
 * landing page can handle them.
 */
export default function SignInPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : '/');
}
