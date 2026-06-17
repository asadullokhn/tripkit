# Tripkit — static site (landing + itinerary + bill-splitter) served by nginx
FROM nginx:1.27-alpine

# landing page + logo + PWA manifest/icons + service worker + social cover
COPY index.html favicon.svg favicon-32.png manifest.webmanifest sw.js og-cover.png /usr/share/nginx/html/
COPY icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon-180.png /usr/share/nginx/html/
# shared design tokens (single source of truth)
COPY shared/ /usr/share/nginx/html/shared/
# trip itinerary  -> /trip/
COPY trip/ /usr/share/nginx/html/trip/
# bill-splitter   -> /split/
COPY split/ /usr/share/nginx/html/split/

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
