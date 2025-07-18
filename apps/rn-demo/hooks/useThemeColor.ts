/**
 * A hook that returns the color for a given theme property, respecting the current color scheme.
 */

import { Colors } from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';

export function useThemeColor(
	props: { light?: string; dark?: string },
	colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
	const theme = useColorScheme() ?? 'light';
	const colorFromProps = props[theme];

	if (colorFromProps) {
		return colorFromProps;
	} else {
		return Colors[theme][colorName];
	}
} 