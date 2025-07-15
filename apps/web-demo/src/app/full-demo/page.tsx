export default function FullDemoPage() {
	return (
		<div className="max-w-4xl mx-auto space-y-6">
			<h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
				Full Demo
			</h2>
			<p className="text-gray-600 dark:text-gray-400 mb-6">
				A comprehensive demo with separate dApp and wallet interfaces, QR code generation and scanning, and full protocol flow visualization.
			</p>

			<div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-6 rounded-lg">
				<h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">
					🚧 Coming Soon
				</h3>
				<p className="text-blue-700 dark:text-blue-300">
					This demo will feature a split-screen interface with a dApp on the left and wallet on the right,
					complete with QR code generation, scanning simulation, and message exchange visualization.
				</p>
			</div>
		</div>
	);
} 