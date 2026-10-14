// Favorite channels: storage and reordering of the Following page response.

export const FAVORITES_KEY = 'taf-favorites';
export const FAVORITES_EVENT = 'taf-favorites-changed';

// Top-level routes that are not channel pages
const RESERVED_ROUTES = new Set([
  'following',
  'directory',
  'search',
  'settings',
  'videos',
  'login',
  'broadcast',
  'app-shell',
  'wrong-format',
  'not-found',
  '_error'
]);

/**
 * Returns the channel login of the current page, or null when the page is
 * not a channel page (/<login> or /<login>/...).
 * @param {string} [pathname]
 * @returns {string | null}
 */
export function getChannelLoginFromPath(pathname = location.pathname) {
  const match = pathname.match(/^\/(\w{1,25})(?:\/|$)/);
  if (!match) return null;
  const login = match[1].toLowerCase();
  return RESERVED_ROUTES.has(login) ? null : login;
}

/**
 * @returns {{login: string, id: string, displayName: string}[]}
 */
export function getFavorites() {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    if (!Array.isArray(list)) return [];
    return list
      .filter((f) => f && (f.login || f.id))
      .map((f) => ({
        login: String(f.login || '').toLowerCase(),
        id: String(f.id || ''),
        displayName: String(f.displayName || f.login || '')
      }));
  } catch (err) {
    console.warn('Favorites: could not read storage', err);
    return [];
  }
}

export function saveFavorites(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Favorites: could not write storage', err);
  }
  window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
}

export function sameChannel(fav, node) {
  if (!node) return false;
  if (fav.id && node.id && String(node.id) === fav.id) return true;
  return !!(
    fav.login &&
    node.login &&
    String(node.login).toLowerCase() === fav.login
  );
}

/**
 * Moves favorites to the front of an edge list (favorites order); the other
 * edges keep their original order. Returns a new array of the same length.
 */
export function reorderEdges(edges, favorites) {
  const used = new Set();
  const front = [];
  favorites.forEach((fav) => {
    edges.forEach((edge, i) => {
      if (!used.has(i) && sameChannel(fav, edge && edge.node)) {
        used.add(i);
        front.push(edge);
      }
    });
  });
  if (!front.length) return edges;
  return front.concat(edges.filter((_, i) => !used.has(i)));
}

/**
 * Reorders a FollowingPage_Query GraphQL response in place.
 * @param {any} payload Parsed response (object or array of objects)
 * @param {{login: string, id: string}[]} favorites
 * @returns {boolean} true when something was changed
 */
export function reorderFollowingPayload(payload, favorites) {
  if (!favorites.length) return false;
  let changed = false;
  (Array.isArray(payload) ? payload : [payload]).forEach((item) => {
    const user = item && item.data && item.data.user;
    if (!user) return;
    ['followedLiveUsers', 'follows'].forEach((key) => {
      const conn = user[key];
      if (!conn || !Array.isArray(conn.edges)) return;
      const next = reorderEdges(conn.edges, favorites);
      if (next !== conn.edges) {
        conn.edges = next;
        changed = true;
      }
    });
  });
  return changed;
}
