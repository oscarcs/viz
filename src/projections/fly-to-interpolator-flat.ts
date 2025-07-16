// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import { TransitionInterpolator } from 'deck.gl';
import { lerp } from '@math.gl/core';

const LINEARLY_INTERPOLATED_PROPS = {
    bearing: 0,
    pitch: 0,
    position: [0, 0, 0]
} as const;

const DEFAULT_OPTS = {
    speed: 1.2,
    curve: 1.414
};

type FlatMapViewportProps = {
    width: number;
    height: number;
    locX: number;
    locY: number;
    zoom: number;
    bearing?: number;
    pitch?: number;
    position?: number[];
    transitionDuration?: number | 'auto';
};

// Implement flyToViewport for flat coordinates
function flyToViewport(
    startProps: FlatMapViewportProps,
    endProps: FlatMapViewportProps,
    t: number,
    opts: { curve: number; speed: number }
): FlatMapViewportProps {
    const startZoom = startProps.zoom;
    const endZoom = endProps.zoom;

    // Use smooth interpolation for position
    const locX = lerp(startProps.locX, endProps.locX, t);
    const locY = lerp(startProps.locY, endProps.locY, t);

    // For zoom, we can use a more sophisticated curve
    let zoom: number;
    if (Math.abs(endZoom - startZoom) < 0.01) {
        // Linear interpolation for small zoom differences
        zoom = lerp(startZoom, endZoom, t);
    }
    else {
        // Smooth zoom curve - zoom out then in for dramatic effect
        const curve = opts.curve;
        const zoomDiff = endZoom - startZoom;
        const midZoom = Math.min(startZoom, endZoom) - Math.abs(zoomDiff) * curve * 0.5;

        if (t < 0.5) {
            zoom = lerp(startZoom, midZoom, t * 2);
        }
        else {
            zoom = lerp(midZoom, endZoom, (t - 0.5) * 2);
        }
    }

    return {
        ...endProps,
        locX,
        locY,
        zoom
    };
}

// Implement getFlyToDuration for flat coordinates
function getFlyToDuration(
    startProps: FlatMapViewportProps,
    endProps: FlatMapViewportProps,
    opts: { speed: number; screenSpeed?: number; maxDuration?: number }
): number {
    const { speed, screenSpeed, maxDuration } = opts;

    // Calculate distance in world units
    const dx = endProps.locX - startProps.locX;
    const dy = endProps.locY - startProps.locY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Calculate zoom change
    const zoomChange = Math.abs(endProps.zoom - startProps.zoom);

    // Base duration calculation
    let duration: number;
    if (screenSpeed) {
        // Calculate based on screen speed
        const avgZoom = (startProps.zoom + endProps.zoom) / 2;
        const screenDistance = distance * Math.pow(2, avgZoom);
        duration = (screenDistance / screenSpeed) * 1000; // Convert to milliseconds
    }
    else {
        // Calculate based on speed parameter
        const normalizedDistance = distance + zoomChange * 100; // Arbitrary scaling for zoom
        duration = (normalizedDistance / speed) * 1000;
    }

    // Apply maximum duration constraint
    if (maxDuration && duration > maxDuration) {
        return 0; // Return 0 to indicate no transition
    }

    return Math.max(100, duration); // Minimum 100ms
}

/**
 * This class adapts mapbox-gl-js Map#flyTo animation so it can be used in
 * react/redux architecture.
 * mapbox-gl-js flyTo : https://www.mapbox.com/mapbox-gl-js/api/#map#flyto.
 * It implements “Smooth and efficient zooming and panning.” algorithm by
 * "Jarke J. van Wijk and Wim A.A. Nuij"
 */
export default class FlyToInterpolatorFlat extends TransitionInterpolator {
    opts: {
        curve: number;
        speed: number;
        screenSpeed?: number;
        maxDuration?: number;
    };

    constructor(
        opts: {
            /** The zooming "curve" that will occur along the flight path. Default 1.414 */
            curve?: number;
            /** The average speed of the animation defined in relation to `options.curve`, it linearly affects the duration, higher speed returns smaller durations and vice versa. Default 1.2 */
            speed?: number;
            /** The average speed of the animation measured in screenfuls per second. Similar to `opts.speed` it linearly affects the duration,  when specified `opts.speed` is ignored. */
            screenSpeed?: number;
            /** Maximum duration in milliseconds, if calculated duration exceeds this value, `0` is returned. */
            maxDuration?: number;
        } = {}
    ) {
        super({
            compare: ['locX', 'locY', 'zoom', 'bearing', 'pitch', 'position'],
            extract: ['width', 'height', 'locX', 'locY', 'zoom', 'bearing', 'pitch', 'position'],
            required: ['width', 'height', 'locX', 'locY', 'zoom']
        });
        this.opts = { ...DEFAULT_OPTS, ...opts };
    }

    interpolateProps(startProps: FlatMapViewportProps, endProps: FlatMapViewportProps, t: number): FlatMapViewportProps {
        const viewport = flyToViewport(startProps, endProps, t, this.opts);

        // Linearly interpolate 'bearing', 'pitch' and 'position'.
        // If they are not supplied, they are interpreted as zeros in viewport calculation
        // (fallback defined in WebMercatorViewport)
        // Because there is no guarantee that the current controller's ViewState normalizes
        // these props, safe guard is needed to avoid generating NaNs
        const result = { ...viewport };

        result.bearing = lerp(
            startProps.bearing || LINEARLY_INTERPOLATED_PROPS.bearing,
            endProps.bearing || LINEARLY_INTERPOLATED_PROPS.bearing,
            t
        );

        result.pitch = lerp(
            startProps.pitch || LINEARLY_INTERPOLATED_PROPS.pitch,
            endProps.pitch || LINEARLY_INTERPOLATED_PROPS.pitch,
            t
        );

        // Handle position array interpolation
        const startPosition = startProps.position || LINEARLY_INTERPOLATED_PROPS.position;
        const endPosition = endProps.position || LINEARLY_INTERPOLATED_PROPS.position;
        result.position = [
            lerp(startPosition[0], endPosition[0], t),
            lerp(startPosition[1], endPosition[1], t),
            lerp(startPosition[2], endPosition[2], t)
        ];

        return result;
    }

    // computes the transition duration
    getDuration(startProps: FlatMapViewportProps, endProps: FlatMapViewportProps): number {
        let { transitionDuration } = endProps;
        if (transitionDuration === 'auto') {
            // auto calculate duration based on start and end props
            transitionDuration = getFlyToDuration(startProps, endProps, this.opts);
        }
        return transitionDuration as number;
    }
}
