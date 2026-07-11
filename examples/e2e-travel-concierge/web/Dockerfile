# Static chat UI served by nginx, reverse-proxying the agent. Build context is
# this web/ directory.
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
# The official nginx image runs envsubst over /etc/nginx/templates/*.template at
# startup, writing the result to /etc/nginx/conf.d/. AGENT_UPSTREAM is provided
# by docker-compose (e.g. agent:4000).
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
