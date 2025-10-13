import * as pako from "pako";

/**
 * Cross-platform base64 encoding
 * Works in browser, Node.js, and React Native environments
 */
export function base64Encode(str: string): string {
	if (typeof btoa !== "undefined") {
		// Browser and React Native with polyfills
		return btoa(str);
	} else if (typeof Buffer !== "undefined") {
		// Node.js
		return Buffer.from(str).toString("base64");
	} else {
		throw new Error("No base64 encoding method available");
	}
}

/**
 * Cross-platform base64 decoding
 * Works in browser, Node.js, and React Native environments
 */
export function base64Decode(str: string): string {
	if (typeof atob !== "undefined") {
		// Browser and React Native with polyfills
		return atob(str);
	} else if (typeof Buffer !== "undefined") {
		// Node.js
		return Buffer.from(str, "base64").toString();
	} else {
		throw new Error("No base64 decoding method available");
	}
}

/**
 * Compress a string using pako (deflate)
 * Returns a base64-encoded compressed string
 */
export function compressString(str: string): string {
	const compressed = pako.deflate(str);
	// Convert Uint8Array to string for base64 encoding
	const binaryString = String.fromCharCode.apply(null, Array.from(compressed));
	return base64Encode(binaryString);
}

/**
 * Decompress a base64-encoded compressed string
 */
export function decompressString(compressedBase64: string): string {
	const binaryString = base64Decode(compressedBase64);
	// Convert string back to Uint8Array
	const compressed = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		compressed[i] = binaryString.charCodeAt(i);
	}
	const decompressed = pako.inflate(compressed);
	return new TextDecoder().decode(decompressed);
}

/**
 * Compare different encoding methods and return size information
 */
export function compareEncodingSizes(jsonPayload: string): {
	original: number;
	uriEncoded: number;
	base64: number;
	compressed: number;
	stats: {
		base64Reduction: number;
		compressionReduction: number;
	};
} {
	const uriEncoded = encodeURIComponent(jsonPayload);
	const base64 = base64Encode(jsonPayload);
	const compressed = compressString(jsonPayload);

	const originalLength = jsonPayload.length;
	const uriEncodedLength = uriEncoded.length;
	const base64Length = base64.length;
	const compressedLength = compressed.length;

	const base64Reduction = ((uriEncodedLength - base64Length) / uriEncodedLength) * 100;
	const compressionReduction = ((uriEncodedLength - compressedLength) / uriEncodedLength) * 100;

	return {
		original: originalLength,
		uriEncoded: uriEncodedLength,
		base64: base64Length,
		compressed: compressedLength,
		stats: {
			base64Reduction,
			compressionReduction,
		},
	};
}
