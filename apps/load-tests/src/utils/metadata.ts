import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Detect the type of runner environment.
 * Uses only file system checks to avoid hanging on execSync calls.
 */
export function detectRunnerType(): "local" | "docker" | "aws" {
  // Check for AWS ECS environment
  if (process.env.ECS_CONTAINER_METADATA_URI || process.env.AWS_EXECUTION_ENV) {
    return "aws";
  }

  // Check for /.dockerenv file (works on all platforms)
  try {
    if (fs.existsSync("/.dockerenv")) {
      return "docker";
    }
  } catch {
    // Ignore errors
  }

  // Skip cgroup check on macOS/Windows to avoid hanging
  // Docker detection via /.dockerenv is sufficient for most cases
  return "local";
}

/**
 * Get container or task ID if running in containerized environment.
 */
export function getContainerId(): string | undefined {
  // AWS ECS task ID
  if (process.env.ECS_CONTAINER_METADATA_URI) {
    // Extract task ID from metadata URI or use environment variable
    return (
      process.env.ECS_TASK_ID ||
      process.env.ECS_CONTAINER_METADATA_URI.split("/").pop()
    );
  }

  // Docker container ID from hostname (common in Docker containers)
  // This is safer than reading /proc/self/cgroup which can hang
  if (process.env.HOSTNAME) {
    // Docker often sets HOSTNAME to container ID
    const hostname = process.env.HOSTNAME;
    // Check if it looks like a container ID (12+ hex characters)
    if (/^[0-9a-f]{12,}$/i.test(hostname)) {
      return hostname.substring(0, 12);
    }
  }

  return undefined;
}

/**
 * Find the git root directory by walking up the directory tree.
 */
function findGitRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const gitDir = path.join(current, ".git");
    if (fs.existsSync(gitDir)) {
      return gitDir;
    }
    current = path.dirname(current);
  }

  return undefined;
}

/**
 * Get git commit SHA if available.
 * Reads directly from .git/HEAD and .git/refs to avoid hanging on execSync.
 */
export function getGitSha(): string | undefined {
  try {
    // Find git root by walking up from current working directory
    const cwd = process.cwd();
    const gitDir = findGitRoot(cwd);

    if (!gitDir) {
      return undefined;
    }

    const headPath = path.join(gitDir, "HEAD");
    if (!fs.existsSync(headPath)) {
      return undefined;
    }

    const headContent = fs.readFileSync(headPath, "utf-8").trim();

    // If HEAD points to a branch, resolve it
    if (headContent.startsWith("ref: ")) {
      const refPath = headContent.substring(5);
      const fullRefPath = path.join(gitDir, refPath);
      if (fs.existsSync(fullRefPath)) {
        return fs.readFileSync(fullRefPath, "utf-8").trim();
      }
    } else {
      // Direct SHA reference
      return headContent;
    }
  } catch {
    // Not a git repo or file read failed
    return undefined;
  }

  return undefined;
}

/**
 * Collect all metadata for test results.
 */
export interface TestMetadata {
  environment?: string;
  gitSha?: string;
  runnerType: string;
  containerId?: string;
}

/**
 * Collect metadata for test results.
 * All operations are synchronous file system checks - no execSync calls.
 */
export function collectMetadata(environment?: string): TestMetadata {
  // Wrap all metadata collection in try-catch to prevent any failures from blocking
  let gitSha: string | undefined;
  let runnerType: "local" | "docker" | "aws" = "local";
  let containerId: string | undefined;

  try {
    gitSha = getGitSha();
  } catch {
    // Ignore errors - git SHA is optional
  }

  try {
    runnerType = detectRunnerType();
  } catch {
    // Fallback to local if detection fails
    runnerType = "local";
  }

  try {
    containerId = getContainerId();
  } catch {
    // Ignore errors - container ID is optional
  }

  return {
    environment,
    gitSha,
    runnerType,
    containerId,
  };
}
