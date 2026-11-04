// The app can be mounted under a path: '/' on the dev server, '/app/moki/' behind the Sogo Apps gateway.
// The server always answers with root-relative paths, because it doesn't know where it's mounted.
const BASE: string = import.meta.env?.BASE_URL ?? '/';

/** A root-relative path, under the app's mount point. Blob URLs and other absolute URLs pass through. */
export function atBase(path: string, base: string = BASE): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const root = base.endsWith('/') ? base : `${base}/`;
  if (root === '/' || path.startsWith(root)) return path;
  return root + path.slice(1);
}
