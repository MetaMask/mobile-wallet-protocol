#!/bin/bash
# Local workflow testing script
# Simulates the GitHub Actions workflow locally

set -e

echo "╔══════════════════════════════════════╗"
echo "║   LOCAL WORKFLOW TESTING SCRIPT     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Default values
ENVIRONMENT="${ENVIRONMENT:-dev}"
SCENARIO="${SCENARIO:-connection-storm}"
CONNECTIONS="${CONNECTIONS:-10}"
DURATION="${DURATION:-30}"
RAMP_UP="${RAMP_UP:-5}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --connections)
      CONNECTIONS="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --ramp-up)
      RAMP_UP="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--environment ENV] [--scenario SCENARIO] [--connections N] [--duration SEC] [--ramp-up SEC]"
      exit 1
      ;;
  esac
done

echo "Configuration:"
echo "  Environment: $ENVIRONMENT"
echo "  Scenario: $SCENARIO"
echo "  Connections: $CONNECTIONS"
echo "  Duration: ${DURATION}s"
echo "  Ramp-up: ${RAMP_UP}s"
echo ""

# Check if environment variables are set
RELAY_URL_VAR="RELAY_URL_$(echo $ENVIRONMENT | tr '[:lower:]' '[:upper:]')"
if [ -z "${!RELAY_URL_VAR}" ]; then
  echo "⚠️  Warning: $RELAY_URL_VAR not set"
  echo "   Set it with: export $RELAY_URL_VAR=ws://localhost:8000/connection/websocket"
  echo ""
fi

# Run the load test
echo "Running load test..."
cd "$(dirname "$0")/.."

yarn start \
  --environment "$ENVIRONMENT" \
  --scenario "$SCENARIO" \
  --connections "$CONNECTIONS" \
  --duration "$DURATION" \
  --ramp-up "$RAMP_UP" \
  --output "results/local-test-$(date +%Y%m%d-%H%M%S).json"

echo ""
echo "✓ Local workflow test complete!"
echo "  Results saved to: results/"
