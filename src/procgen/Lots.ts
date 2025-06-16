import { LineString, Polygon, Feature } from "geojson";
import { lengthToDegrees, feature, cleanCoords, lineString, area, lineOverlap } from "@turf/turf";
import { Color } from "deck.gl";
import { LogicalStreet } from "../ds/LogicalStreet";
import polygonSlice from "../util/polygonSlice";
import { Strip } from "./Strips";
import { debugStore } from "../debug/DebugStore";
import { randomColor } from "../util/random";

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

const LOT_MIN_AREA = 500; // Minimum area for a valid lot in square meters

export function generateLotsFromStrips(street: LogicalStreet, strips: Strip[]): Lot[] {
    const lots: Lot[] = [];

    for (const strip of strips) {
        const rays = calculateSplittingRays(strip);
        const polygons = splitStripIntoPolygons(strip, street, rays);
        const postProcessedPolygons = postProcessLotPolygons(polygons, street);
        lots.push(...generateLots(postProcessedPolygons, street));
    }

    return lots;
}

/**
 * Generate splitting rays by traversing the edges of the strip polygon that face the street.
 * @param street LogicalStreet
 * @param strip Strip
 * @returns A set of rays (LineStrings) that will be used to split the strip into lots.
 */
function calculateSplittingRays(strip: Strip): LineString[] {
    const rays: LineString[] = [];
    const rayLength = lengthToDegrees(strip.block.maxLotDepth + 10, 'meters');
    const lotWidth = lengthToDegrees(25, 'meters');

    const edgesFacingStreet = findStripEdgesFacingStreet(strip);
    if (edgesFacingStreet) {
        // Traverse the edges facing the street. Every lotWidth meters, create a ray.
        const streetEdgeCoords = edgesFacingStreet.coordinates;
        
        // Calculate the total length of the street-facing edge(s)
        let totalLength = 0;
        for (let i = 0; i < streetEdgeCoords.length - 1; i++) {
            const dx = streetEdgeCoords[i + 1][0] - streetEdgeCoords[i][0];
            const dy = streetEdgeCoords[i + 1][1] - streetEdgeCoords[i][1];
            totalLength += Math.sqrt(dx * dx + dy * dy);
        }
        
        // Generate rays at regular intervals along the street edge
        let currentDistance = 0;
        let currentSegmentIndex = 0;
        let segmentStartDistance = 0;
        
        while (currentDistance < totalLength - lotWidth && currentSegmentIndex < streetEdgeCoords.length - 1) {
            // Find which segment we're currently on
            while (currentSegmentIndex < streetEdgeCoords.length - 1) {
                const segmentStart = streetEdgeCoords[currentSegmentIndex];
                const segmentEnd = streetEdgeCoords[currentSegmentIndex + 1];
                const dx = segmentEnd[0] - segmentStart[0];
                const dy = segmentEnd[1] - segmentStart[1];
                const segmentLength = Math.sqrt(dx * dx + dy * dy);
                
                if (currentDistance <= segmentStartDistance + segmentLength) {
                    // We're on this segment
                    const segmentProgress = (currentDistance - segmentStartDistance) / segmentLength;
                    const rayPoint = [
                        segmentStart[0] + segmentProgress * dx,
                        segmentStart[1] + segmentProgress * dy
                    ];
                    
                    // Create a perpendicular ray from this point
                    const ray = createPerpendicularRay(rayPoint, segmentStart, segmentEnd, rayLength);
                    if (ray) {
                        rays.push(ray);
                    }
                    break;
                }
                else {
                    // Move to next segment
                    segmentStartDistance += segmentLength;
                    currentSegmentIndex++;
                }
            }
            
            currentDistance += lotWidth;
        }
    }

    return rays;
}

/**
 * Find the edges of the strip polygon that are shared with the edges of the given logical street.
 * @param street LogicalStreet
 * @param strip Strip
 * @returns A line string representing the edges of the strip that face the street, or null if none found.
 */
function findStripEdgesFacingStreet(strip: Strip): LineString | null {
    const blockBoundary = strip.block.polygon.geometry;

    const overlapping = lineOverlap(strip.polygon, blockBoundary, { tolerance: 1 / 1000 })
        .features
        .map((feature: Feature<LineString>) => feature.geometry);

    const combined = stitchLineStrings(overlapping);

    return combined;
}

/**
 * Stitch multiple LineStrings together into a single LineString.
 * Input line strings should be connected end-to-end to form a lineString with no cycles.
 * @param lines 
 * @returns Combined LineString or null if no lines provided.
 */
function stitchLineStrings(lines: LineString[]): LineString | null {
    if (lines.length === 0) return null;
    if (lines.length === 1) return lines[0];
    
    const tolerance = 1e-10;
    
    // Helper function to check if two points are the same
    const pointsEqual = (p1: number[], p2: number[]) => {
        return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
    };
    
    // Start with the first line string
    let result = [...lines[0].coordinates];
    const used = new Set<number>();
    used.add(0);
    
    while (used.size < lines.length) {
        const currentStart = result[0];
        const currentEnd = result[result.length - 1];
        let found = false;
        
        // Look for a line that connects to either end of our current result
        for (let i = 1; i < lines.length; i++) {
            if (used.has(i)) continue;
            
            const lineCoords = lines[i].coordinates;
            const lineStart = lineCoords[0];
            const lineEnd = lineCoords[lineCoords.length - 1];
            
            // Check if this line connects to the end of our result
            if (pointsEqual(currentEnd, lineStart)) {
                // Append this line (skip the first point to avoid duplication)
                result.push(...lineCoords.slice(1));
                used.add(i);
                found = true;
                break;
            }
            else if (pointsEqual(currentEnd, lineEnd)) {
                // Append this line in reverse (skip the last point to avoid duplication)
                const reversedCoords = [...lineCoords].reverse();
                result.push(...reversedCoords.slice(1));
                used.add(i);
                found = true;
                break;
            }
            else if (pointsEqual(currentStart, lineEnd)) {
                // Prepend this line (skip the last point to avoid duplication)
                result = [...lineCoords.slice(0, -1), ...result];
                used.add(i);
                found = true;
                break;
            }
            else if (pointsEqual(currentStart, lineStart)) {
                // Prepend this line in reverse (skip the first point to avoid duplication)
                const reversedCoords = [...lineCoords].reverse();
                result = [...reversedCoords.slice(0, -1), ...result];
                used.add(i);
                found = true;
                break;
            }
        }
        
        if (!found) {
            // If we can't find a connecting line, we might have disconnected segments
            // Just return what we have so far
            break;
        }
    }
    
    // Create a new LineString from the stitched coordinates
    const stitchedLine = lineString(result);
    // Clean coordinates to remove any duplicate consecutive points
    const cleanedLine = cleanCoords(stitchedLine);
    return cleanedLine.geometry;
}

/**
 * Create a perpendicular ray from a point on an edge, extending into the polygon
 */
function createPerpendicularRay(
    point: number[],
    edgeStart: number[],
    edgeEnd: number[],
    rayLength: number
): LineString | null {
    // Calculate edge direction vector
    const edgeDir = [
        edgeEnd[0] - edgeStart[0],
        edgeEnd[1] - edgeStart[1]
    ];
    
    // Calculate perpendicular vector (rotate 90 degrees)
    const perpDir = [-edgeDir[1], edgeDir[0]];
    
    // Normalize the perpendicular vector
    const perpLength = Math.sqrt(perpDir[0] * perpDir[0] + perpDir[1] * perpDir[1]);
    if (perpLength === 0) return null;
    
    const normalizedPerp = [perpDir[0] / perpLength, perpDir[1] / perpLength];
     
    // Extend the ray in both directions to ensure it crosses the polygon
    const rayEnd1 = [
        point[0] + normalizedPerp[0] * rayLength,
        point[1] + normalizedPerp[1] * rayLength
    ];
    const rayEnd2 = [
        point[0] - normalizedPerp[0] * rayLength,
        point[1] - normalizedPerp[1] * rayLength
    ];
    
    // Create ray from one end to the other, passing through the point
    const rayFeature = lineString([rayEnd1, rayEnd2]);
    
    // Clean coordinates to remove any duplicate consecutive points
    const cleanedRay = cleanCoords(rayFeature);
    return cleanedRay.geometry;
}

/**
 * Split the merged polygon into lots based on the calculated rays.
 */
function splitStripIntoPolygons(strip: Strip, logicalStreet: LogicalStreet, rays: LineString[]): Polygon[] {
    if (rays.length === 0) {
        return [strip.polygon];
    }
    
    // Start with the original strip geometry
    let currentPolygons: Polygon[] = [strip.polygon];
    
    // Apply each ray to split the polygons
    for (let rayIndex = 0; rayIndex < rays.length; rayIndex++) {
        const ray = rays[rayIndex];
        const newPolygons: Polygon[] = [];
        
        // Split each current polygon with this ray
        for (const polygon of currentPolygons) {
            try {
                // Use polygonSlice to split the polygon with the ray
                const sliceResult = polygonSlice(feature(polygon), feature(ray));
                
                if (sliceResult && sliceResult.features && sliceResult.features.length > 0) {

                    let producesSmallPolygons = false;
                    for (const slicedFeature of sliceResult.features) {
                        if (slicedFeature.geometry.type === 'Polygon') {
                            if (area(slicedFeature) < LOT_MIN_AREA) {
                                producesSmallPolygons = true;
                                break;
                            }
                        }
                    }
                    
                    if (producesSmallPolygons) {
                        // Skip this ray and just keep the original polygon
                        newPolygons.push(polygon);
                    }
                    else {
                        // Add all resulting polygons
                        for (const slicedFeature of sliceResult.features) {
                            if (slicedFeature.geometry.type === 'Polygon') {
                                newPolygons.push(slicedFeature.geometry);
                            }
                        }
                    }
                }
                else {
                    // If slicing failed, keep the original polygon
                    newPolygons.push(polygon);
                }
            }
            catch (error) {
                // TODO: Debug the slicing errors
                //console.warn(`Failed to slice polygon with ray ${rayIndex}:`, error);
                //console.log(JSON.stringify(ray, null, 2) + ",\n" + JSON.stringify(polygon, null, 2));

                // Keep the original polygon if slicing fails
                newPolygons.push(polygon);
            }
        }
        
        currentPolygons = newPolygons;
    }

    return currentPolygons;
}

function postProcessLotPolygons(polygons: Polygon[], street: LogicalStreet): Polygon[] {
    return polygons;
}

function generateLots(polygons: Polygon[], street: LogicalStreet): Lot[] {
    const lots: Lot[] = [];
    
    for (let i = 0; i < polygons.length; i++) {
        const polygon = polygons[i];
        
        // Calculate a random color for each lot
        const lotColor: Color = randomColor();
        
        // Create the lot object
        lots.push({
            geometry: polygon,
            color: lotColor,
            id: `${street.id}-lot-${i}`
        });
    }
    
    return lots;
}