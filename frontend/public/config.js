// Settings a deployment hands to the page before the app starts.
// Left empty here: in development, and on a static host, the app uses the VITE_ values it was built with.
// When the API serves the app (WEB_DIR), it answers /config.js itself with its own Supabase settings.
window.__WEALTHOS__ = window.__WEALTHOS__ || {};
