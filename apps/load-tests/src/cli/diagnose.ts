#!/usr/bin/env node
/**
 * Diagnostic script to identify load test bottlenecks.
 * Run this on your load test machine to understand what's limiting capacity.
 *
 * Usage: npx tsx src/cli/diagnose.ts
 */

import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";

function exec(cmd: string): string {
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {
		return "N/A";
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

console.log(chalk.bold.blue("╔══════════════════════════════════════════════════════════╗"));
console.log(chalk.bold.blue("║         LOAD TEST BOTTLENECK DIAGNOSTICS                 ║"));
console.log(chalk.bold.blue("╚══════════════════════════════════════════════════════════╝"));
console.log("");

// ============================================================================
// CPU INFO
// ============================================================================
console.log(chalk.bold.cyan("🖥️  CPU"));
const cpus = os.cpus();
console.log(`  Cores:              ${chalk.yellow(cpus.length)}`);
console.log(`  Model:              ${cpus[0]?.model ?? "Unknown"}`);

// Multi-process benefit estimate
const multiProcessBenefit = cpus.length > 1 ? chalk.green(`Yes (${cpus.length}x potential)`) : chalk.dim("No (single core)");
console.log(`  Multi-process help: ${multiProcessBenefit}`);
console.log("");

// ============================================================================
// MEMORY INFO
// ============================================================================
console.log(chalk.bold.cyan("💾 MEMORY"));
const totalMem = os.totalmem();
const freeMem = os.freemem();
const usedMem = totalMem - freeMem;
console.log(`  Total:              ${formatBytes(totalMem)}`);
console.log(`  Used:               ${formatBytes(usedMem)} (${((usedMem / totalMem) * 100).toFixed(1)}%)`);
console.log(`  Free:               ${formatBytes(freeMem)}`);

// Node.js heap limit
const v8 = await import("node:v8");
const heapStats = v8.getHeapStatistics();
console.log(`  Node Heap Limit:    ${formatBytes(heapStats.heap_size_limit)}`);

// Estimate connection capacity based on memory
// Rough estimate: ~150KB per session pair (2 WebSockets + state)
const memPerPair = 150 * 1024; // 150KB
const maxPairsByMemory = Math.floor(freeMem / memPerPair);
console.log(`  Est. pairs (mem):   ~${maxPairsByMemory.toLocaleString()} pairs (at ~150KB each)`);
console.log("");

// ============================================================================
// FILE DESCRIPTOR LIMITS (Critical for WebSockets!)
// ============================================================================
console.log(chalk.bold.cyan("📁 FILE DESCRIPTORS (often the bottleneck!)"));

const isLinux = os.platform() === "linux";
const isDarwin = os.platform() === "darwin";

if (isLinux || isDarwin) {
	const softLimit = exec("ulimit -Sn");
	const hardLimit = exec("ulimit -Hn");

	const softNum = parseInt(softLimit, 10);
	const limitColor = softNum < 10000 ? chalk.red : softNum < 65535 ? chalk.yellow : chalk.green;

	console.log(`  Soft Limit:         ${limitColor(softLimit)}`);
	console.log(`  Hard Limit:         ${hardLimit}`);

	// Each session pair uses 2 WebSocket connections = 2 file descriptors
	// Plus some for Node internals (~50)
	const maxPairsByFd = Math.floor((softNum - 50) / 2);
	console.log(`  Est. pairs (fd):    ~${maxPairsByFd.toLocaleString()} pairs (2 per pair)`);

	if (softNum < 10000) {
		console.log("");
		console.log(chalk.red("  ⚠️  FILE DESCRIPTOR LIMIT IS LOW!"));
		console.log(chalk.yellow("  Fix: ulimit -n 65535  (or add to /etc/security/limits.conf)"));
	}
} else {
	console.log("  (Not available on this platform)");
}
console.log("");

// ============================================================================
// EPHEMERAL PORT RANGE (for outbound connections)
// ============================================================================
console.log(chalk.bold.cyan("🔌 EPHEMERAL PORTS"));

if (isLinux) {
	const portRange = exec("cat /proc/sys/net/ipv4/ip_local_port_range");
	console.log(`  Port Range:         ${portRange}`);

	const [low, high] = portRange.split(/\s+/).map(Number);
	if (low && high) {
		const availablePorts = high - low;
		console.log(`  Available Ports:    ${availablePorts.toLocaleString()}`);
		// Each session pair uses 2 ports (2 WebSocket connections)
		const maxPairsByPorts = Math.floor(availablePorts / 2);
		console.log(`  Est. pairs (ports): ~${maxPairsByPorts.toLocaleString()} pairs`);

		if (availablePorts < 30000) {
			console.log("");
			console.log(chalk.yellow("  Tip: Expand port range for more connections:"));
			console.log(chalk.dim("  sysctl -w net.ipv4.ip_local_port_range='1024 65535'"));
		}
	}
} else if (isDarwin) {
	const first = exec("sysctl net.inet.ip.portrange.first | awk '{print $2}'");
	const last = exec("sysctl net.inet.ip.portrange.last | awk '{print $2}'");
	console.log(`  Port Range:         ${first} - ${last}`);
	const availablePorts = parseInt(last, 10) - parseInt(first, 10);
	if (availablePorts) {
		console.log(`  Available Ports:    ${availablePorts.toLocaleString()}`);
		const maxPairsByPorts = Math.floor(availablePorts / 2);
		console.log(`  Est. pairs (ports): ~${maxPairsByPorts.toLocaleString()} pairs`);
	}
} else {
	console.log("  (Not available on this platform)");
}
console.log("");

// ============================================================================
// KERNEL NETWORK LIMITS (Linux only)
// ============================================================================
if (isLinux) {
	console.log(chalk.bold.cyan("🌐 KERNEL NETWORK LIMITS"));

	const somaxconn = exec("cat /proc/sys/net/core/somaxconn");
	console.log(`  somaxconn:          ${somaxconn} (socket backlog)`);

	const tcpMaxSynBacklog = exec("cat /proc/sys/net/ipv4/tcp_max_syn_backlog");
	console.log(`  tcp_max_syn_backlog: ${tcpMaxSynBacklog}`);

	// Check if conntrack is loaded
	const conntrackMax = exec("cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null");
	if (conntrackMax !== "N/A") {
		console.log(`  nf_conntrack_max:   ${conntrackMax}`);
	}

	// TCP TIME_WAIT reuse
	const tcpTwReuse = exec("cat /proc/sys/net/ipv4/tcp_tw_reuse 2>/dev/null");
	if (tcpTwReuse !== "N/A") {
		const reuseEnabled = tcpTwReuse === "1" || tcpTwReuse === "2";
		console.log(`  tcp_tw_reuse:       ${reuseEnabled ? chalk.green("enabled") : chalk.yellow("disabled")}`);
		if (!reuseEnabled) {
			console.log(chalk.dim("  Tip: Enable for faster port recycling: sysctl -w net.ipv4.tcp_tw_reuse=1"));
		}
	}
	console.log("");
}

// ============================================================================
// SUMMARY & RECOMMENDATIONS
// ============================================================================
console.log(chalk.bold.cyan("📊 SUMMARY"));
console.log("");

// Find the lowest limit
const limits: { name: string; value: number; fixable: boolean }[] = [];

// Memory-based limit
limits.push({
	name: "Memory",
	value: maxPairsByMemory,
	fixable: false,
});

// File descriptor limit
if (isLinux || isDarwin) {
	const softLimit = parseInt(exec("ulimit -Sn"), 10);
	if (!isNaN(softLimit)) {
		limits.push({
			name: "File Descriptors",
			value: Math.floor((softLimit - 50) / 2),
			fixable: true,
		});
	}
}

// Ephemeral ports limit
if (isLinux) {
	const portRange = exec("cat /proc/sys/net/ipv4/ip_local_port_range");
	const [low, high] = portRange.split(/\s+/).map(Number);
	if (low && high) {
		limits.push({
			name: "Ephemeral Ports",
			value: Math.floor((high - low) / 2),
			fixable: true,
		});
	}
}

// Sort by value (lowest first)
limits.sort((a, b) => a.value - b.value);

const lowestLimit = limits[0];
if (lowestLimit) {
	console.log(`  Bottleneck:         ${chalk.bold.red(lowestLimit.name)}`);
	console.log(`  Max pairs:          ~${chalk.yellow(lowestLimit.value.toLocaleString())}`);

	if (lowestLimit.fixable) {
		console.log("");
		console.log(chalk.green("  ✓ This limit can be increased!"));
	}
}

console.log("");
console.log(chalk.bold.cyan("🔧 WILL MULTI-PROCESS HELP?"));
console.log("");

// Analyze if multi-process would help
const fdLimited = limits.find((l) => l.name === "File Descriptors");
const memLimited = limits.find((l) => l.name === "Memory");
const portLimited = limits.find((l) => l.name === "Ephemeral Ports");

if (lowestLimit?.name === "File Descriptors") {
	console.log(chalk.yellow("  ❌ No - File descriptors are SYSTEM-WIDE"));
	console.log(chalk.dim("     Multiple processes share the same FD limit."));
	console.log(chalk.green("     Fix: ulimit -n 65535"));
} else if (lowestLimit?.name === "Ephemeral Ports") {
	console.log(chalk.yellow("  ❌ No - Ephemeral ports are SYSTEM-WIDE per IP"));
	console.log(chalk.dim("     Multiple processes share the same port range."));
	console.log(chalk.green("     Fix: Expand port range or use multiple IPs"));
} else if (lowestLimit?.name === "Memory") {
	console.log(chalk.green("  ✅ Yes - Memory is PER-PROCESS"));
	console.log(chalk.dim("     Each process gets its own Node.js heap."));
	console.log(chalk.dim(`     With ${cpus.length} workers: ~${(lowestLimit.value * cpus.length).toLocaleString()} pairs possible`));
} else {
	console.log(chalk.green(`  ✅ Possibly - ${cpus.length} cores available`));
	console.log(chalk.dim("     If CPU/event loop is the bottleneck, multi-process helps."));
}

console.log("");
console.log(chalk.gray("─".repeat(60)));
console.log("");
console.log(chalk.dim("Run a test and monitor with:"));
console.log(chalk.dim("  htop              # Watch CPU and memory"));
console.log(chalk.dim("  watch -n1 'ss -s' # Watch socket counts (Linux)"));
console.log("");
