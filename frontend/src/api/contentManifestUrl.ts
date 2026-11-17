/** Kept separate so login-page prefetch does not pull in release-only CDN parsing. */
export function getContentManifestUrl(): string {
  const url = import.meta.env.VITE_CONTENT_MANIFEST_URL ?? import.meta.env.VITE_MANIFEST_URL ?? '';
  return typeof url === 'string' && url.trim() ? url.trim() : '/manifest/index.json';
}
