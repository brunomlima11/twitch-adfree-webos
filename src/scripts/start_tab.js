import { configRead } from '../config.js';
import { START_TAB } from '../constants/config.constants.js';

// Opens the configured start tab once per app launch.
// This runs here (not in index.js) because the configuration lives in the
// localStorage of the lg.tv.twitch.tv origin.

const DONE_KEY = 'taf-start-tab-done';
const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 10000;

const TAB_ROUTES = {
  Following: '/following',
  Browse: '/directory',
  Search: '/search'
};

function startTabInit() {
  // Only act on the landing page so a channel launch parameter still wins
  if (location.pathname !== '/') return;

  const route = TAB_ROUTES[configRead(START_TAB)];
  if (!route) return;

  try {
    if (sessionStorage.getItem(DONE_KEY)) return;
    sessionStorage.setItem(DONE_KEY, '1');
  } catch (err) {
    console.warn('Start tab: sessionStorage unavailable', err);
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const router = window.next && window.next.router;
    if (router && typeof router.replace === 'function') {
      clearInterval(timer);
      router.replace(route);
    } else if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
      clearInterval(timer);
      location.replace(route);
    }
  }, POLL_INTERVAL_MS);
}

startTabInit();
