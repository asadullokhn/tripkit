# Tripkit — static site (landing + itinerary + bill-splitter) served by nginx
FROM nginx:1.27-alpine

# landing page + logo
COPY index.html favicon.svg /usr/share/nginx/html/
# trip itinerary  -> /trip/
COPY trip/ /usr/share/nginx/html/trip/
# bill-splitter   -> /split/
COPY split/ /usr/share/nginx/html/split/

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
