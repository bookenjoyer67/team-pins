FROM rust:1.82-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY signal-server/Cargo.toml signal-server/Cargo.lock ./
COPY signal-server/src/ ./src/

RUN cargo build --release --no-default-features

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/*

RUN groupadd -r piggpin && useradd -r -g piggpin -d /tmp piggpin

WORKDIR /app
COPY --from=builder --chown=piggpin:piggpin /app/target/release/piggpin-signal /usr/local/bin/
RUN mkdir -p /app && chown piggpin:piggpin /app

EXPOSE 9000 9001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9001/health || exit 1

USER piggpin
CMD ["piggpin-signal", "config.toml"]
