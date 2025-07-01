"use client";

import dynamic from "next/dynamic";

const ProtocolDemo = dynamic(() => import("../protocol-demo"), {
	ssr: false,
	loading: () => (
		<div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 flex items-center justify-center">
			<div className="text-xl">Loading demo...</div>
		</div>
	),
});

export default function DemoPage() {
	return <ProtocolDemo />;
}
