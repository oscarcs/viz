import { Feature, Polygon } from "geojson";
import { booleanPointInPolygon, point } from "@turf/turf";

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/sign#Polyfill
function mathSign(x: number) {
    return ((x > 0) as unknown as number) - ((x < 0) as unknown as number) || +x;
}

/**
 * Returns the direction of the point q relative to the vector p1 -> p2.
 *
 * Implementation of geos::algorithm::CGAlgorithm::orientationIndex()
 * (same as geos::algorithm::CGAlgorithm::computeOrientation())
 *
 * @param {number[]} p1 - the origin point of the vector
 * @param {number[]} p2 - the final point of the vector
 * @param {number[]} q - the point to compute the direction to
 *
 * @returns {number} - 1 if q is ccw (left) from p1->p2,
 *    -1 if q is cw (right) from p1->p2,
 *     0 if q is colinear with p1->p2
 */
export function orientationIndex(p1: number[], p2: number[], q: number[]) {
    const dx1 = p2[0] - p1[0],
        dy1 = p2[1] - p1[1],
        dx2 = q[0] - p2[0],
        dy2 = q[1] - p2[1];

    return mathSign(dx1 * dy2 - dx2 * dy1);
}

/**
 * Checks if two envelopes are equal.
 *
 * The function assumes that the arguments are envelopes, i.e.: Rectangular polygon
 *
 * @param {Feature<Polygon>} env1 - Envelope
 * @param {Feature<Polygon>} env2 - Envelope
 * @returns {boolean} - True if the envelopes are equal
 */
export function envelopeIsEqual(
    env1: Feature<Polygon>,
    env2: Feature<Polygon>
) {
    const envX1 = env1.geometry.coordinates[0].map((c) => c[0]),
        envY1 = env1.geometry.coordinates[0].map((c) => c[1]),
        envX2 = env2.geometry.coordinates[0].map((c) => c[0]),
        envY2 = env2.geometry.coordinates[0].map((c) => c[1]);

    return (
        Math.max.apply(null, envX1) === Math.max.apply(null, envX2) &&
        Math.max.apply(null, envY1) === Math.max.apply(null, envY2) &&
        Math.min.apply(null, envX1) === Math.min.apply(null, envX2) &&
        Math.min.apply(null, envY1) === Math.min.apply(null, envY2)
    );
}

/**
 * Check if a envelope is contained in other one.
 *
 * The function assumes that the arguments are envelopes, i.e.: Convex polygon
 * XXX: Envelopes are rectangular, checking if a point is inside a rectangule is something easy,
 * this could be further improved.
 *
 * @param {Feature<Polygon>} self - Envelope
 * @param {Feature<Polygon>} env - Envelope
 * @returns {boolean} - True if env is contained in self
 */
export function envelopeContains(
    self: Feature<Polygon>,
    env: Feature<Polygon>
) {
    return env.geometry.coordinates[0].every((c) =>
        booleanPointInPolygon(point(c), self)
    );
}

/**
 * Checks if two coordinates are equal.
 *
 * @param {number[]} coord1 - First coordinate
 * @param {number[]} coord2 - Second coordinate
 * @returns {boolean} - True if coordinates are equal
 */
export function coordinatesEqual(coord1: number[], coord2: number[]) {
    return coord1[0] === coord2[0] && coord1[1] === coord2[1];
}

/**
 * Compute the inset of a polygon by a fixed distance from every edge.
 * @param polygon - The polygon to inset
 * @param inset - The distance to inset the polygon
 * @returns The inset polygon
 */
export function insetPolygon(polygon: Feature<Polygon>, inset: number): Feature<Polygon> {
    // computes intersection of two lines (p1→p2) and (p3→p4)
    function lineIntersection(
        x1: number, y1: number, x2: number, y2: number,
        x3: number, y3: number, x4: number, y4: number
    ): [number, number] | null {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (denom === 0) return null;
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        return [x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)];
    }

    // offsets the corner at (c,d) formed by edges (a,b)->(c,d) and (c,d)->(e,f)
    function insetCorner(
        ax: number, ay: number,
        cx: number, cy: number,
        ex: number, ey: number,
        insetDist: number
    ): [number, number] {
        let a = ax, b = ay, c = cx, d = cy, e = ex, f = ey;
        let c1 = c, d1 = d, c2 = c, d2 = d;

        const dx1 = c - a, dy1 = d - b, dist1 = Math.hypot(dx1, dy1);
        const dx2 = e - c, dy2 = f - d, dist2 = Math.hypot(dx2, dy2);
        if (dist1 === 0 || dist2 === 0) return [c, d];

        // inset each segment outward by perpendicular offset
        let ix = (dy1 / dist1) * insetDist; a += ix; c1 += ix;
        let iy = (-dx1 / dist1) * insetDist; b += iy; d1 += iy;
        ix = (dy2 / dist2) * insetDist; e += ix; c2 += ix;
        iy = (-dx2 / dist2) * insetDist; f += iy; d2 += iy;

        // if the two inset segments meet exactly, use that point
        if (c1 === c2 && d1 === d2) return [c1, d1];

        // otherwise intersect the two inset lines
        const p = lineIntersection(a, b, c1, d1, c2, d2, e, f);
        return p || [cx, cy];
    }

    const ring = polygon.geometry.coordinates[0];
    const n = ring.length - 1; // drop the duplicate last point
    if (n < 3) return polygon;

    const xs = ring.slice(0, n).map(([x]) => x);
    const ys = ring.slice(0, n).map(([, y]) => y);
    const out: [number, number][] = [];

    for (let i = 0; i < n; i++) {
        const prev = (i - 1 + n) % n;
        const next = (i + 1) % n;
        const [nx, ny] = insetCorner(
            xs[prev], ys[prev],
            xs[i], ys[i],
            xs[next], ys[next],
            inset
        );
        out.push([nx, ny]);
    }

    out.push(out[0]);  // close the ring
    return {
        ...polygon,
        geometry: {
            type: "Polygon",
            coordinates: [out],
        },
    };
}