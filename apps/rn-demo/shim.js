// Polyfill for 'crypto.getRandomValues'
import "react-native-get-random-values";

// Polyfill for 'Buffer'
if (typeof Buffer === "undefined") {
	global.Buffer = require("buffer").Buffer;
}

// Polyfill for 'global' in web environments
if (typeof global === "undefined") {
	window.global = window;
}
