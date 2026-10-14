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
  reorderFollowingPayload,
  saveFavorites
} from '../utils/favorites.js';
import { getAuthToken } from '../utils/utils.js';

const YELLOW_KEY_CODES = [405, 170];
const FOLLOWING_QUERY_MARK = 'query FollowingPage_Query(';

// #region Following page response reordering
function isFollowingQuery(input, init) {
  const body = init && init.body;
  if (typeof body !== 'string') return false;
  const url = typeof input === 'string' ? input : input && input.url;
  return (
    String(url).startsWith(twitchGraphQLEndpoint) &&
    body.includes(FOLLOWING_QUERY_MARK)
  );
}

async function reorderResponse(response) {
  try {
    const favorites = getFavorites();
    if (!favorites.length || !response.ok) return response;

    const payload = await response.clone().json();
    if (!reorderFollowingPayload(payload, favorites)) return response;

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
    let following;
    try {
      following = isFollowingQuery(input, init);
    } catch {
      following = false;
    }
    return following ? promise.then(reorderResponse) : promise;
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
