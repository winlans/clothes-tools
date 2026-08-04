FROM pdf2plt-tauri-verify:latest AS build-cache

FROM pdf2plt-release-smoke:ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/root/.cargo/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      libwebkit2gtk-4.1-dev \
      libxdo-dev \
      patchelf \
      pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build-cache /usr/bin/node /usr/bin/node
COPY --from=build-cache /usr/lib/node_modules /usr/lib/node_modules
RUN ln -s /usr/lib/node_modules/corepack/dist/corepack.js /usr/bin/corepack \
    && ln -s /usr/lib/node_modules/corepack/dist/pnpm.js /usr/bin/pnpm

COPY --from=build-cache /root/.cargo /root/.cargo
COPY --from=build-cache /root/.rustup /root/.rustup
COPY --from=build-cache /workspace/node_modules /workspace/node_modules
COPY --from=build-cache /workspace/apps/desktop/node_modules /workspace/apps/desktop/node_modules
COPY --from=build-cache /workspace/packages/core/node_modules /workspace/packages/core/node_modules

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile
