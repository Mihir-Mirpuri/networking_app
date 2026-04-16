/**
 * Detects if the current browser is an in-app/embedded browser
 * that Google OAuth blocks (403: disallowed_useragent)
 */

export function isEmbeddedBrowser(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();

  // LinkedIn in-app browser
  if (ua.includes('linkedin')) return true;

  // Facebook in-app browser
  if (ua.includes('fban') || ua.includes('fbav')) return true;

  // Instagram in-app browser
  if (ua.includes('instagram')) return true;

  // Twitter/X in-app browser
  if (ua.includes('twitter')) return true;

  // Generic webview indicators
  if (ua.includes('webview')) return true;
  if (ua.includes('wv)')) return true; // Android WebView

  // iOS webview detection
  // Standalone Safari has "Safari" in UA, webviews often don't
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const hasSafari = ua.includes('safari');
  const hasChrome = ua.includes('crios') || ua.includes('chrome');
  if (isIOS && !hasSafari && !hasChrome) return true;

  return false;
}

export function getOpenInBrowserUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}
