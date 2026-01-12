import chalk from "chalk";
import cliProgress from "cli-progress";

export interface ConnectionProgress {
	immediate: number;
	recovered: number;
	failed: number;
}

/**
 * Create a progress bar for connection tracking.
 */
export function createConnectionProgressBar(label: string): cliProgress.SingleBar {
	return new cliProgress.SingleBar(
		{
			format: `${chalk.cyan(label)} ${chalk.gray("|")} {bar} ${chalk.gray("|")} {value}/{total} (${chalk.green("✓")} {immediate} ${chalk.yellow("↻")} {recovered} ${chalk.red("✗")} {failed})`,
			barCompleteChar: "█",
			barIncompleteChar: "░",
			hideCursor: true,
			clearOnComplete: false,
			stopOnComplete: true,
		},
		cliProgress.Presets.shades_classic,
	);
}

/**
 * Start a connection progress bar.
 */
export function startProgressBar(
	bar: cliProgress.SingleBar,
	total: number,
): void {
	bar.start(total, 0, { immediate: 0, recovered: 0, failed: 0 });
}

/**
 * Update a connection progress bar.
 */
export function updateProgressBar(
	bar: cliProgress.SingleBar,
	current: number,
	progress: ConnectionProgress,
): void {
	bar.update(current, progress);
}

/**
 * Stop a progress bar.
 */
export function stopProgressBar(bar: cliProgress.SingleBar): void {
	bar.stop();
}

