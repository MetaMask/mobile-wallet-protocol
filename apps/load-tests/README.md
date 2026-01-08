# Load Testing

Load testing infrastructure for the Mobile Wallet Protocol relay server. This tool runs various load test scenarios against Centrifugo relay servers to measure performance, stability, and scalability.

## Features

- **Multiple Test Scenarios**: Connection storm and steady-state testing
- **Environment Configuration**: Support for dev, UAT, and production environments
- **Docker Support**: Containerized execution for consistent testing
- **GitHub Actions Integration**: Automated workflow for running tests
- **Result Collection**: Automatic result storage and metadata collection

## Prerequisites

- Node.js 20.x or later
- Yarn package manager
- Docker (for containerized testing)
- Access to a Centrifugo relay server for testing

## Installation

From the repository root:

```bash
yarn install
```

## Configuration

### Environment Variables

The load test runner supports environment-based configuration via environment variables:

```bash
export RELAY_URL_DEV=ws://localhost:8000/connection/websocket
export RELAY_URL_UAT=wss://uat-relay.example.com/connection/websocket
export RELAY_URL_PROD=wss://prod-relay.example.com/connection/websocket
```

### Configuration File

Alternatively, create a `config/environments.json` file:

```json
{
  "dev": {
    "relayUrl": "ws://localhost:8000/connection/websocket"
  },
  "uat": {
    "relayUrl": "wss://uat-relay.example.com/connection/websocket"
  },
  "prod": {
    "relayUrl": "wss://prod-relay.example.com/connection/websocket"
  }
}
```

See `config/environments.example.json` for a template.

**Note**: Production URLs should be stored in AWS Secrets Manager (after DevOps setup). For now, use environment variables or config files for local testing.

## Usage

### Direct CLI Usage

Run load tests directly using the CLI:

```bash
cd apps/load-tests

# Using environment configuration
yarn start --environment dev --scenario connection-storm --connections 100

# Using explicit target URL
yarn start --target ws://localhost:8000/connection/websocket --scenario steady-state --connections 50 --duration 60
```

### CLI Options

- `--environment <name>`: Environment name (dev, uat, prod). Resolves relay URL from config.
- `--target <url>`: Explicit WebSocket URL (required if --environment not provided)
- `--scenario <name>`: Test scenario (connection-storm, steady-state). Default: connection-storm
- `--connections <number>`: Number of connections to create. Default: 100
- `--duration <seconds>`: Test duration in seconds (for steady-state). Default: 60
- `--ramp-up <seconds>`: Seconds to ramp up to full connection count. Default: 10
- `--output <path>`: Path to write JSON results file

### Docker Usage

Build the Docker image:

```bash
# From repository root
yarn workspace @metamask/mobile-wallet-protocol-load-tests docker:build
```

Run the container:

```bash
# Test with environment variable
docker run --rm \
  -e RELAY_URL_DEV=ws://host.docker.internal:8000 \
  load-test:local \
  --environment dev \
  --scenario connection-storm \
  --connections 10

# Mount results directory
docker run --rm \
  -e RELAY_URL_DEV=ws://host.docker.internal:8000 \
  -v $(pwd)/results:/app/apps/load-tests/results \
  load-test:local \
  --environment dev \
  --scenario connection-storm \
  --output results/test.json
```

**Note**: Use `host.docker.internal` to access the host machine's relay server from within Docker.

### Local Workflow Testing

Use the test script to simulate the GitHub Actions workflow locally:

```bash
cd apps/load-tests

# Set environment variables
export RELAY_URL_DEV=ws://localhost:8000

# Run test script
./scripts/test-local-workflow.sh \
  --environment dev \
  --scenario connection-storm \
  --connections 10 \
  --duration 30 \
  --ramp-up 5
```

## Test Scenarios

### Connection Storm

Tests the system's ability to handle a rapid burst of connections:

- Creates connections as quickly as possible
- Measures connection success rate
- Tracks retry attempts
- Calculates connection latency

### Steady State

Tests long-term connection stability:

- Ramps up connections gradually
- Holds connections for a specified duration
- Monitors disconnections and reconnections
- Calculates connection stability metrics

## Results

Test results are saved as JSON files with the following structure:

```json
{
  "scenario": "connection-storm",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "target": "ws://localhost:8000",
  "environment": "dev",
  "gitSha": "abc123...",
  "runnerType": "local",
  "config": {
    "connections": 100,
    "durationSec": 60,
    "rampUpSec": 10
  },
  "results": {
    "connections": {
      "attempted": 100,
      "successful": 95,
      "failed": 5,
      "successRate": 95.0,
      "immediate": 90,
      "recovered": 5
    },
    "timing": {
      "totalTimeMs": 5000,
      "connectionsPerSec": 20.0
    },
    "latency": {
      "min": 10,
      "max": 500,
      "avg": 100,
      "p95": 250
    }
  }
}
```

### Result Metadata

- `environment`: Environment name (dev, uat, prod)
- `gitSha`: Git commit SHA (if available)
- `runnerType`: Type of runner (local, docker, aws)
- `containerId`: Container or task ID (if running in container)

## GitHub Actions Workflow

The load test can be triggered via GitHub Actions workflow:

1. Go to **Actions** → **Load Test**
2. Click **Run workflow**
3. Select:
   - Environment (dev, uat, prod)
   - Scenario (connection-storm, steady-state)
   - Optional: connections, duration, ramp-up
4. For production, manual approval is required

Results are uploaded as workflow artifacts.

## Development

### Running Tests Locally

1. Start the relay server:

   ```bash
   docker compose -f backend/docker-compose.yml up -d
   ```

2. Set environment variable:

   ```bash
   export RELAY_URL_DEV=ws://localhost:8000
   ```

3. Run a quick test:
   ```bash
   cd apps/load-tests
   yarn start --environment dev --scenario connection-storm --connections 10
   ```

### Adding New Scenarios

1. Create a new scenario file in `src/scenarios/`
2. Implement the scenario function following the `ScenarioResult` interface
3. Add the scenario to `src/scenarios/index.ts`
4. Update the CLI to include the new scenario

## AWS Integration (Post-DevOps)

After DevOps sets up AWS infrastructure, the following will be available:

- **AWS Secrets Manager**: Environment URLs stored securely
- **S3**: Automatic result upload and storage
- **ECS/EC2/Lambda**: Container orchestration for distributed testing
- **CloudWatch**: Logging and metrics

The code is designed with abstraction layers that allow swapping AWS implementations without changing core logic.

## Troubleshooting

### Environment Not Found

If you see "Environment 'dev' not configured":

- Set the appropriate environment variable: `RELAY_URL_DEV`, `RELAY_URL_UAT`, or `RELAY_URL_PROD`
- Or create `config/environments.json` file

### Docker Can't Connect to Host

When running Docker, use `host.docker.internal` instead of `localhost`:

```bash
-e RELAY_URL_DEV=ws://host.docker.internal:8000
```

### Connection Failures

- Verify the relay server is running and accessible
- Check network connectivity
- Verify the WebSocket URL format (ws:// for local, wss:// for remote)

## Scripts

- `yarn start`: Run load test CLI
- `yarn docker:build`: Build Docker image
- `yarn docker:run`: Run Docker container
- `yarn docker:test`: Quick Docker test

## License

See LICENSE file in the repository root.
