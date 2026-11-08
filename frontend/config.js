/**
 * Runtime API base URL for the FilmLog frontend.
 *
 * The frontend is a zero-build static site, so there is no bundler to inject
 * environment variables. This file is the single place to point the deployed
 * copy at the deployed API.
 *
 * Resolution order in app.js:
 *   1. localStorage 'filmlog_api_url'  (the in-app URL input — highest priority)
 *   2. window.FILMLOG_API_URL          (this file)
 *   3. http://localhost:8000/api       (final fallback)
 *
 * Change the production URL below if your Render service has a different name.
 */
(function () {
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', ''];
  const isLocal = LOCAL_HOSTS.includes(window.location.hostname);

  window.FILMLOG_API_URL = isLocal
    ? 'http://localhost:8000/api'
    : 'https://movieapi-gdg-api.onrender.com/api';
})();
