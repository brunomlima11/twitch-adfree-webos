import { showNotification } from './ui.js';
import {
  apiConsumerType,
  contentTypeJson,
  tvClientId,
  twitchGraphQLEndpoint,
  xDeviceId
} from '../constants/requests.constants.js';
import {
  getChannelLoginFromPath,
  getFavorites,
  reorderEdges,
  reorderFollowingPayload,
  sameChannel,
  saveFavorites
} from '../utils/favorites.js';
import { getAuthToken } from '../utils/utils.js';

const YELLOW_KEY_CODES = [405, 170];

// #region Following page response reordering
// The Following page loads its first 25 follows with FollowingPage_Query.
// The offline row then paginates (8 at a time) with OfflineInfiniteShelf_Query,
// which returns the same user.follows.edges shape.
const FOLLOWING_QUERY = 'query FollowingPage_Query(';
const OFFLINE_PAGE_QUERY = 'query OfflineInfiniteShelf_Query(';

// Same selection as the OfflineInfiniteShelf_followedUsers fragment, so
// channels fetched here render exactly like the ones Twitch returns.
const OFFLINE_NODE_FIELDS = `
  id
  __typename
  bannerImageURL
  displayName
  lastBroadcast {
    game { boxArtURL id __typename }
    id
    __typename
    startedAt
  }
  stream { id __typename }
  login
  followers { totalCount }
  profileImageURL(width: 300)
`;

// Ids of favorites injected into the first follows page. They are removed
// from later pages so they don't show twice.
let injectedIds = new Set();
// Ids on the first page; the server wraps around to the start of the list
// when asked for more edges than remain, so refills stop at the first of these.
let firstPageIds = new Set();

function parseBody(body) {
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function matchesQuery(input, init) {
  const body = init && init.body;
  if (typeof body !== 'string') return null;
  const url = typeof input === 'string' ? input : input && input.url;
  if (!String(url).startsWith(twitchGraphQLEndpoint)) return null;
  if (body.includes(FOLLOWING_QUERY)) return 'first';
  if (body.includes(OFFLINE_PAGE_QUERY)) return 'page';
  return null;
}

// Unhooked fetch, so our own requests are not intercepted
const nativeFetch = window.fetch.bind(window);

function postGql(init, body, wrap) {
  return nativeFetch(twitchGraphQLEndpoint, {
    method: 'POST',
    headers: init.headers,
    body: JSON.stringify(wrap ? [body] : body)
  })
    .then((r) => r.json())
    .then((j) => (Array.isArray(j) ? j[0] : j));
}

// Fetches full follow nodes for favorites missing from the first page.
async function fetchFavoriteEdges(missing, init) {
  const fields = missing
    .map(
      (f, i) =>
        `u${i}: user(login: ${JSON.stringify(f.login)}) {${OFFLINE_NODE_FIELDS}}`
    )
    .join('\n');
  const result = await postGql(init, { query: `query { ${fields} }` }, false);
  const data = (result && result.data) || {};
  return missing
    .map((fav, i) => ({ fav, node: data[`u${i}`] }))
    .filter(({ node }) => node && node.id)
    .map(({ node }) => ({ node, cursor: null }));
}

// First page: put favorites first, injecting the ones that are not in it.
async function patchFirstPage(item, favorites, init) {
  const conn = item.data.user.follows;
  if (!conn || !Array.isArray(conn.edges)) return;

  const missing = favorites.filter(
    (fav) => !conn.edges.some((e) => sameChannel(fav, e && e.node))
  );
  let extra = [];
  if (missing.length) {
    try {
      extra = await fetchFavoriteEdges(missing, init);
    } catch (err) {
      console.warn('Favorites: could not fetch favorite channels', err);
    }
  }
  injectedIds = new Set(extra.map((e) => String(e.node.id)));

  const originalLength = conn.edges.length;
  let edges = reorderEdges(conn.edges.concat(extra), favorites);
  // Keep the page size: dropped tail edges are re-served by the next page
  // because the pagination cursor is the one of the last remaining edge.
  const isFav = (e) => favorites.some((fav) => sameChannel(fav, e.node));
  let drop = edges.length - originalLength;
  while (drop > 0 && edges.length && !isFav(edges[edges.length - 1])) {
    edges = edges.slice(0, -1);
    drop--;
  }
  conn.edges = edges;
  firstPageIds = new Set(edges.map((e) => String(e.node.id)));
}

// Later pages: remove injected favorites and refill the page from the cursor.
async function patchLaterPage(item, requestBody, init, wrap) {
  const conn = item.data.user.follows;
  if (!conn || !Array.isArray(conn.edges) || !injectedIds.size) return;
  const wanted = requestBody.variables.first;

  const isInjected = (e) => injectedIds.has(String(e && e.node && e.node.id));
  let edges = conn.edges.filter((e) => !isInjected(e));
  // A short page means the end of the list: nothing to refill
  if (edges.length === conn.edges.length || conn.edges.length < wanted) {
    conn.edges = edges;
    return;
  }

  let lastCursor = conn.edges[conn.edges.length - 1].cursor;
  for (let tries = 0; tries < 5 && edges.length < wanted; tries++) {
    const requested = wanted - edges.length;
    // eslint-disable-next-line no-await-in-loop
    const more = await postGql(
      init,
      {
        ...requestBody,
        variables: {
          ...requestBody.variables,
          first: requested,
          offlineUserCursor: lastCursor
        }
      },
      wrap
    );
    let moreEdges =
      (more && more.data && more.data.user && more.data.user.follows.edges) ||
      [];
    const wrapAt = moreEdges.findIndex((e) =>
      firstPageIds.has(String(e.node.id))
    );
    if (wrapAt >= 0) moreEdges = moreEdges.slice(0, wrapAt);
    if (!moreEdges.length) break;
    lastCursor = moreEdges[moreEdges.length - 1].cursor;
    edges = edges.concat(moreEdges.filter((e) => !isInjected(e)));
    if (moreEdges.length < requested) break;
  }
  conn.edges = edges;
}

async function reorderResponse(response, kind, init) {
  try {
    const favorites = getFavorites();
    if (!favorites.length || !response.ok) return response;

    const payload = await response.clone().json();
    const items = Array.isArray(payload) ? payload : [payload];
    const requestBody = parseBody(init.body);
    const wrap = Array.isArray(JSON.parse(init.body));
    const isFirst =
      kind === 'first' && !requestBody.variables.offlineUserCursor;

    if (isFirst) reorderFollowingPayload(payload, favorites);
    for (const item of items) {
      if (!item || !item.data || !item.data.user) continue;
      if (isFirst) {
        // eslint-disable-next-line no-await-in-loop
        await patchFirstPage(item, favorites, init);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await patchLaterPage(item, requestBody, init, wrap);
      }
    }

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const patched = new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    Object.defineProperty(patched, 'url', { value: response.url });
    return patched;
  } catch (err) {
    console.warn('Favorites: could not reorder Following response', err);
    return response;
  }
}

function hookFetch() {
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = originalFetch.apply(this, arguments);
    let kind = null;
    try {
      kind = matchesQuery(input, init);
    } catch {
      kind = null;
    }
    return kind ? promise.then((r) => reorderResponse(r, kind, init)) : promise;
  };
}
// #endregion

// #region Toggle favorite on the current channel
async function lookupChannel(login) {
  const response = await fetch(twitchGraphQLEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': contentTypeJson,
      'Client-Id': tvClientId,
      'api-consumer-type': apiConsumerType,
      'X-Device-Id': xDeviceId,
      Authorization: getAuthToken()
    },
    body: JSON.stringify({
      query:
        'query($login: String!) { user(login: $login) { id login displayName } }',
      variables: { login }
    })
  });
  const data = await response.json();
  return data && data.data && data.data.user;
}

let busy = false;

async function toggleCurrentChannel() {
  const login = getChannelLoginFromPath();
  if (!login || busy) return;
  busy = true;
  try {
    const favorites = getFavorites();
    const index = favorites.findIndex((f) => f.login === login);
    if (index >= 0) {
      const [removed] = favorites.splice(index, 1);
      saveFavorites(favorites);
      showNotification(
        `${removed.displayName || login} removido dos favoritos`,
        4000,
        'info'
      );
      return;
    }

    let user = null;
    try {
      user = await lookupChannel(login);
    } catch (err) {
      console.warn('Favorites: channel lookup failed', err);
    }
    if (!user || !user.id) {
      showNotification(
        'Não foi possível favoritar este canal agora',
        4000,
        'error'
      );
      return;
    }
    const name = user.displayName || login;
    favorites.push({ login, id: String(user.id), displayName: name });
    saveFavorites(favorites);
    showNotification(`⭐ ${name} adicionado aos favoritos`, 4000, 'success');
  } finally {
    busy = false;
  }
}

function settingsPanelOpen() {
  const panel = document.querySelector('.taf-ui-container');
  return !!panel && panel.style.display !== 'none';
}

function keyHandler(evt) {
  if (!YELLOW_KEY_CODES.includes(evt.keyCode)) return;
  if (!getChannelLoginFromPath() || settingsPanelOpen()) return;

  evt.preventDefault();
  evt.stopPropagation();
  if (evt.type === 'keydown' && !evt.repeat) {
    toggleCurrentChannel();
  }
}
// #endregion

hookFetch();
['keydown', 'keypress', 'keyup'].forEach((type) => {
  document.addEventListener(type, keyHandler, true);
});

/**
 * Force babel to interpret this file as ESM so it
 * polyfills with ESM imports instead of CommonJS.
 */
export {};
