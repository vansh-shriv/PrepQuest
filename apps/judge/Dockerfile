# Judge worker image (doc 12 §2, §4). Build from the repository root:
#   docker build -f apps/judge/Dockerfile -t prepquest-judge .
#
# It bundles the compilers/runtimes the sandbox exposes (g++, Python, a JDK) and `isolate`, which is built
# from source because Debian does not package it. Run it privileged (isolate needs namespaces and cgroups):
#   docker run --rm --privileged -e REDIS_URL=... prepquest-judge
# The container has Redis and object-storage access but no database credentials.

FROM debian:bookworm-slim AS isolate
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git ca-certificates pkg-config libcap-dev libsystemd-dev \
    && rm -rf /var/lib/apt/lists/*
# v2.0 is the first release with cgroup v2 support
RUN git clone --depth 1 --branch v2.0 https://github.com/ioi/isolate.git /src \
    && cd /src && make isolate \
    && install -D isolate /usr/local/bin/isolate

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ python3 openjdk-17-jdk-headless libcap2 libsystemd0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=isolate /usr/local/bin/isolate /usr/local/bin/isolate
COPY apps/judge/isolate.conf /usr/local/etc/isolate
COPY apps/judge/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /var/local/lib/isolate /run/isolate/locks

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/judge ./apps/judge
COPY apps/api/package.json ./apps/api/package.json
COPY content ./content
RUN pnpm install --frozen-lockfile --filter "@prepquest/judge..." \
    && pnpm --filter "@prepquest/judge..." build

ENV NODE_ENV=production \
    JUDGE_SANDBOX=isolate \
    JUDGE_CGROUPS=true
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/judge/dist/main.js"]
