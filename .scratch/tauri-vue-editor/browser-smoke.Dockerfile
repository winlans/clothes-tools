FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /runner
RUN npm init -y >/dev/null \
    && npm install playwright@1.61.0 --save-exact >/dev/null

ENV NODE_PATH="/runner/node_modules"
