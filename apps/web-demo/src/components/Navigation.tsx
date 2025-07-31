"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const demos = [
	{ name: "Basic Demo", href: "/" },
	{ name: "Trusted Demo", href: "/trusted-demo" },
	{ name: "Untrusted Demo", href: "/untrusted-demo" },
];

export default function Navigation() {
	const pathname = usePathname();

	return (
		<nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between h-16">
					<div className="flex">
						<div className="flex-shrink-0 flex items-center">
							<h1 className="text-xl font-bold text-gray-900 dark:text-white">Mobile Wallet Protocol</h1>
						</div>
						<div className="ml-10 flex items-center space-x-4">
							{demos.map((demo) => {
								const isActive = pathname === demo.href;
								return (
									<Link
										key={demo.href}
										href={demo.href}
										className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
											? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200"
											: "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700"
											}`}
									>
										{demo.name}
									</Link>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</nav>
	);
}
