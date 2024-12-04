/**
 * @module colorutils
 *
 * This module provides utility functions for colors, in particular for
 * converting from a segment ID to a color.
 */
import ColorHash from 'color-hash';

/**
 * Converts a segment ID to a color.
 *
 * @param {number} segmentId - The segment ID.
 * @returns {string} The color.
 * @throws {Error} If the segment ID is not a number.
 */
export function segmentIdToRGB(segmentId: number): [number, number, number] {
    if (typeof segmentId !== 'number') {
        throw new Error('segmentId must be a number');
    }

    const colorHash = new ColorHash();
    return colorHash.rgb(segmentId.toString());
}