import type { CreateDropletOptions, DropletInfo } from "./types.js";

const DO_API_BASE = "https://api.digitalocean.com/v2";

/**
 * DigitalOcean API error.
 */
export class DigitalOceanError extends Error {
	constructor(
		message: string,
		public statusCode: number,
		public responseBody?: string,
	) {
		super(message);
		this.name = "DigitalOceanError";
	}
}

/**
 * Make an authenticated request to the DigitalOcean API.
 */
async function doRequest<T>(
	token: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(`${DO_API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new DigitalOceanError(
			`DigitalOcean API error: ${response.status} ${response.statusText}`,
			response.status,
			text,
		);
	}

	// Handle 204 No Content
	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}

/**
 * Parse a droplet from the API response.
 */
function parseDroplet(data: ApiDroplet): DropletInfo {
	// Find the public IPv4 address
	const publicIpv4 = data.networks?.v4?.find(
		(n: { type: string }) => n.type === "public",
	);

	return {
		id: data.id,
		name: data.name,
		status: data.status as DropletInfo["status"],
		ip: publicIpv4?.ip_address ?? null,
		region: data.region?.slug ?? "unknown",
		size: data.size?.slug ?? "unknown",
		createdAt: data.created_at,
	};
}

// API response types (partial, only what we need)
interface ApiDroplet {
	id: number;
	name: string;
	status: string;
	created_at: string;
	networks?: {
		v4?: Array<{ type: string; ip_address: string }>;
	};
	region?: { slug: string };
	size?: { slug: string };
}

interface ListDropletsResponse {
	droplets: ApiDroplet[];
}

interface CreateDropletResponse {
	droplet: ApiDroplet;
}

interface GetDropletResponse {
	droplet: ApiDroplet;
}

/**
 * List all droplets.
 */
export async function listDroplets(token: string): Promise<DropletInfo[]> {
	const response = await doRequest<ListDropletsResponse>(
		token,
		"GET",
		"/droplets?per_page=200",
	);
	return response.droplets.map(parseDroplet);
}

/**
 * List droplets matching a name prefix.
 */
export async function listDropletsByPrefix(
	token: string,
	prefix: string,
): Promise<DropletInfo[]> {
	const all = await listDroplets(token);
	return all.filter((d) => d.name.startsWith(prefix));
}

/**
 * Create a new droplet.
 */
export async function createDroplet(
	token: string,
	options: CreateDropletOptions,
): Promise<DropletInfo> {
	const response = await doRequest<CreateDropletResponse>(
		token,
		"POST",
		"/droplets",
		{
			name: options.name,
			region: options.region,
			size: options.size,
			image: options.image,
			ssh_keys: [options.sshKeyFingerprint],
			user_data: options.userData,
		},
	);
	return parseDroplet(response.droplet);
}

/**
 * Get a droplet by ID.
 */
export async function getDroplet(
	token: string,
	id: number,
): Promise<DropletInfo> {
	const response = await doRequest<GetDropletResponse>(
		token,
		"GET",
		`/droplets/${id}`,
	);
	return parseDroplet(response.droplet);
}

/**
 * Delete a droplet by ID.
 */
export async function deleteDroplet(token: string, id: number): Promise<void> {
	await doRequest<void>(token, "DELETE", `/droplets/${id}`);
}

/**
 * Wait for a droplet to reach the "active" status.
 * Polls every 5 seconds up to the timeout.
 */
export async function waitForDropletActive(
	token: string,
	id: number,
	timeoutMs = 120000,
): Promise<DropletInfo> {
	const startTime = Date.now();
	const pollInterval = 5000;

	while (Date.now() - startTime < timeoutMs) {
		const droplet = await getDroplet(token, id);
		if (droplet.status === "active" && droplet.ip) {
			return droplet;
		}
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(`Droplet ${id} did not become active within ${timeoutMs}ms`);
}

