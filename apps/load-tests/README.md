# Load Tests

A load testing tool for validating the Mobile Wallet Protocol relay server's performance and reliability at production scale.

## Why it exists

The relay server is a WebSocket service (Centrifugo-based) that brokers connections between dApps and MetaMask Mobile. Before it can be considered production-ready, we need to prove it can handle realistic traffic at scale — both bursts of new connections and long-running steady state.

Key questions it answers:

- Can the relay handle 100K+ concurrent WebSocket connections?
- What are the p50/p95/p99 connection times under load?
- Does the server stay stable when connections are held for 10+ minutes?
- Does it recover correctly when clients disconnect and reconnect?
- Are messages delivered reliably at scale?

A single machine can open ~10K connections before hitting CPU, memory, or OS limits. To reach 100K+, this tool provisions multiple DigitalOcean droplets that run tests in parallel, then aggregates the results into a single report.

## Architecture

```
Local Testing (up to ~10K connections)
─────────────────────────────────────
  Your Mac  ────────── WebSocket ──────────►  Relay Server
  (1-10K)                                     (Production)

  ⚠ Limited by local CPU, memory, and network


Distributed Testing (100K+ connections)
─────────────────────────────────────────
  Droplet 1 (10K) ──┐
  Droplet 2 (10K) ──┤
  Droplet 3 (10K) ──┼── WebSocket ──────────►  Relay Server
  ...               ┤                           (Production)
  Droplet 10 (10K) ─┘

  ✓ Scale to 100K+ connections across multiple machines
```

Each droplet is a 2vCPU / 2GB RAM DigitalOcean VM (~$0.018/hr). The tool creates them, runs the test, collects results, and destroys them — keeping costs minimal.

## Scenarios

There are five test scenarios, split into two categories:

**Low-fidelity** (raw WebSocket connections, no protocol handshake):

| Scenario | What it tests |
|---|---|
| `connection-storm` | Burst of connections to test peak capacity |
| `steady-state` | Sustained connections to test stability over time |

**High-fidelity** (full dApp + Wallet session pairs, with encryption and protocol):

| Scenario | What it tests |
|---|---|
| `realistic-session` | Full session lifecycle with message exchange |
| `async-delivery` | Message delivery after a reconnect delay |
| `steady-messaging` | Continuous message throughput over time |

## Setup

### Prerequisites

- Node.js 20+
- Yarn

### Install dependencies

From the repo root:

```bash
yarn install
```

### Environment variables (for distributed testing only)

Create `apps/load-tests/.env`:

```bash
# Required: DigitalOcean API token
# Get one at: https://cloud.digitalocean.com/account/api/tokens
DIGITALOCEAN_TOKEN=your_token_here

# Required: SSH key fingerprint registered in DigitalOcean
# Find yours at: https://cloud.digitalocean.com/account/security
SSH_KEY_FINGERPRINT=your:fingerprint:here

# Optional: path to your SSH private key (default: ~/.ssh/id_rsa)
SSH_PRIVATE_KEY_PATH=~/.ssh/id_rsa
```

Local testing does not require any environment variables.

## Usage

All commands are run from `apps/load-tests/`.

### Local testing

Run a scenario directly from your machine:

```bash
# Connection storm: 1,000 connections, 10s ramp-up
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=connection-storm \
  --connections=1000 \
  --ramp-up=10

# Steady state: 1,000 connections held for 60 seconds
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=steady-state \
  --connections=1000 \
  --duration=60 \
  --ramp-up=10

# Realistic session: 100 session pairs, 3 messages each
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=realistic-session \
  --connection-pairs=100 \
  --messages-per-session=3

# Async delivery: send messages, disconnect for 30s, reconnect
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=async-delivery \
  --connection-pairs=100 \
  --delay=30

# Steady messaging: 100 pairs exchanging messages every 5s for 120s
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=steady-messaging \
  --connection-pairs=100 \
  --duration=120 \
  --message-interval=5
```

Save results to a file with `--output`:

```bash
yarn start \
  --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
  --scenario=connection-storm \
  --connections=1000 \
  --output=results/my-run.json
```

### Distributed testing

#### 1. Spin up droplets

```bash
# Create 10 droplets using the current branch
yarn infra create --count=10 --branch=main
```

This takes 3-5 minutes. Each droplet clones the repo, installs Node.js, and builds the project.

#### 2. Run a test across all droplets

```bash
# Start test in background (each droplet runs independently)
yarn infra exec --background \
  --command="cd /app/apps/load-tests && /usr/local/bin/yarn start \
    --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
    --scenario=connection-storm \
    --connections=5000 \
    --ramp-up=250 \
    --output=/tmp/results.json"

# Wait for all droplets to finish
yarn infra wait --file=/tmp/results.json --timeout=600

# Pull results down
yarn infra collect --output=results/my-run

# Aggregate into a single report
yarn results aggregate --input=results/my-run
```

With 10 droplets × 5,000 connections each = 50,000 total connections.

#### 3. Destroy droplets

Always clean up when done — droplets cost money while running.

```bash
yarn infra destroy --yes
```

### Infrastructure management

```bash
yarn infra list                          # list running droplets
yarn infra create --count=5             # spin up 5 droplets
yarn infra exec --command="<cmd>"       # run a shell command on all droplets
yarn infra update --branch=my-branch   # git pull + rebuild on all droplets
yarn infra destroy --yes               # destroy all droplets
```

### All CLI flags

#### `yarn start` (run a test)

| Flag | Default | Description |
|---|---|---|
| `--target` | required | WebSocket URL of the relay server |
| `--scenario` | `connection-storm` | Scenario name |
| `--connections` | `100` | Number of raw connections (low-fidelity scenarios) |
| `--connection-pairs` | `100` | Number of session pairs (high-fidelity scenarios) |
| `--duration` | `60` | Test duration in seconds |
| `--ramp-up` | `10` | Seconds to ramp up to full connection count |
| `--messages-per-session` | `3` | Messages per pair (`realistic-session` only) |
| `--delay` | `30` | Disconnect delay in seconds (`async-delivery` only) |
| `--message-interval` | `5` | Seconds between messages (`steady-messaging` only) |
| `--output` | — | Path to write JSON results |

#### `yarn infra create`

| Flag | Default | Description |
|---|---|---|
| `--count` | `3` | Number of droplets to create |
| `--branch` | `main` | Git branch to clone on each droplet |
| `--name-prefix` | `load-test` | Prefix for droplet names |
| `--skip-setup` | `false` | Create droplets without running setup |

#### `yarn infra exec`

| Flag | Default | Description |
|---|---|---|
| `--command` | required | Shell command to run on each droplet |
| `--background` | `false` | Fire-and-forget (don't wait for completion) |

#### `yarn infra wait`

| Flag | Default | Description |
|---|---|---|
| `--file` | required | Path to file to wait for on each droplet |
| `--timeout` | `600` | Timeout in seconds |
| `--interval` | `5` | Poll interval in seconds |

#### `yarn infra collect`

| Flag | Default | Description |
|---|---|---|
| `--output` | required | Local directory to save results |
| `--remote-path` | `/tmp/results.json` | Path to results file on each droplet |

## Example: 100K steady-state test

```bash
# 10 droplets × 10K connections each = 100K total
yarn infra create --count=10 --branch=main

yarn infra exec --background \
  --command="cd /app/apps/load-tests && /usr/local/bin/yarn start \
    --target=wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket \
    --scenario=steady-state \
    --connections=10000 \
    --duration=600 \
    --ramp-up=200 \
    --output=/tmp/results.json"

yarn infra wait --file=/tmp/results.json --timeout=900
yarn infra collect --output=results/steady-state-100k
yarn results aggregate --input=results/steady-state-100k

yarn infra destroy --yes
```

Expected results: 100% connection stability, zero disconnects during the 10-minute hold.
