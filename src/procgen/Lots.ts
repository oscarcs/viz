import { LineString, Polygon, Feature } from "geojson";
import { lengthToDegrees, feature, cleanCoords, lineString, area, lineOverlap, featureCollection, union, length, transformTranslate } from "@turf/turf";
import { Color } from "deck.gl";
import { LogicalStreet } from "../ds/LogicalStreet";
import polygonSlice from "../util/polygonSlice";
import { customBuffer } from "../util/CustomBuffer";
import { Strip } from "./Strips";

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

// Track polygon adjacency during slicing
type PolygonNode = {
    id: string;
    geometry: Polygon;
    adjacentEdges: Map<string, number>; // Maps adjacent polygon ID to shared edge length
    parentRayIndex?: number; // Which ray created this polygon (for tracking adjacency)
    isValid: boolean; // Whether this polygon meets area and street frontage requirements
};

const LOT_MIN_AREA = 750; // Minimum area for a valid lot in square meters

export function generateLotsFromStrips(street: LogicalStreet, strips: Strip[]): Lot[] {
    const lots: Lot[] = [];

    for (const strip of strips) {
        const edgesFacingStreet = findStripEdgesFacingStreet(strip);
        
        if (!edgesFacingStreet) {
            console.warn(`No edges facing street found`);
            continue;
        }
        
        const rays = calculateSplittingRays(strip, edgesFacingStreet);
        const polygonNodes = splitStripIntoPolygonNodes(strip, rays, edgesFacingStreet);
        const mergedNodes = mergeInvalidPolygons(polygonNodes, edgesFacingStreet);
        lots.push(...generateLotsFromNodes(mergedNodes, street));
    }

    return lots;
}

/**
 * Generate splitting rays by traversing the edges of the strip polygon that face the street.
 * @param street LogicalStreet
 * @param strip Strip
 * @returns A set of rays (LineStrings) that will be used to split the strip into lots.
 */
function calculateSplittingRays(strip: Strip, edgesFacingStreet: LineString): LineString[] {
    const rays: LineString[] = [];
    const rayLength = lengthToDegrees(strip.block.maxLotDepth + 10, 'meters');
    const lotWidth = lengthToDegrees(25, 'meters');

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
 * Split the merged polygon into polygon nodes with adjacency tracking.
 */
function splitStripIntoPolygonNodes(strip: Strip, rays: LineString[], edgesFacingStreet: LineString): PolygonNode[] {
    const getNextId = (() => {
        let idCounter = 0;
        return () => `${idCounter++}`;
    })();
    
    if (rays.length === 0) {
        const node: PolygonNode = {
            id: getNextId(),
            geometry: strip.polygon,
            adjacentEdges: new Map(),
            isValid: validatePolygon(strip.polygon, edgesFacingStreet)
        };
        return [node];
    }
    
    // Start with the original strip geometry
    let currentNodes: PolygonNode[] = [{
        id: getNextId(),
        geometry: strip.polygon,
        adjacentEdges: new Map(),
        isValid: validatePolygon(strip.polygon, edgesFacingStreet)
    }];
    
    // Apply each ray to split the polygons
    for (let rayIndex = 0; rayIndex < rays.length; rayIndex++) {
        const ray = rays[rayIndex];
        const newNodes: PolygonNode[] = [];
        
        // Split each current polygon with this ray
        for (const node of currentNodes) {
            try {
                // Use polygonSlice to split the polygon with the ray
                const sliceResult = polygonSlice(feature(node.geometry), feature(ray));
                
                if (sliceResult && sliceResult.features && sliceResult.features.length > 1) {
                    // Create new nodes for each resulting polygon
                    const resultingNodes: PolygonNode[] = [];
                    
                    for (let i = 0; i < sliceResult.features.length; i++) {
                        const slicedFeature = sliceResult.features[i];
                        if (slicedFeature.geometry.type === 'Polygon') {
                            const newNode: PolygonNode = {
                                id: getNextId(),
                                geometry: slicedFeature.geometry,
                                adjacentEdges: new Map(),
                                parentRayIndex: rayIndex,
                                isValid: validatePolygon(slicedFeature.geometry, edgesFacingStreet)
                            };
                            resultingNodes.push(newNode);
                        }
                    }
                    
                    // Calculate adjacency between the resulting polygons
                    if (resultingNodes.length === 2) {
                        const sharedEdgeLength = calculateSharedEdgeLength(resultingNodes[0].geometry, resultingNodes[1].geometry);
                        if (sharedEdgeLength > 0) {
                            resultingNodes[0].adjacentEdges.set(resultingNodes[1].id, sharedEdgeLength);
                            resultingNodes[1].adjacentEdges.set(resultingNodes[0].id, sharedEdgeLength);
                        }
                    }
                    
                    newNodes.push(...resultingNodes);
                }
                else {
                    // If slicing failed or produced only one polygon, keep the original
                    newNodes.push(node);
                }
            }
            catch (error) {
                // Keep the original polygon if slicing fails
                newNodes.push(node);
            }
        }
        
        currentNodes = newNodes;
    }

    // After all rays are applied, calculate adjacency between all polygons
    updateGlobalAdjacency(currentNodes);
    
    return currentNodes;
}

/**
 * Validate if a polygon meets the requirements (minimum area and street frontage)
 */
function validatePolygon(polygon: Polygon, edgesFacingStreet: LineString): boolean {
    // Check minimum area
    const areaValue = area(polygon);
    if (areaValue < LOT_MIN_AREA) {
        return false;
    }
    
    // Check if lot has street frontage
    const intersection = lineOverlap(polygon, edgesFacingStreet, { tolerance: 1 / 1000 });
    return intersection.features.length > 0;
}

/**
 * Calculate the length of shared edge between two polygons
 */
function calculateSharedEdgeLength(poly1: Polygon, poly2: Polygon): number {
    try {
        const overlap = lineOverlap(poly1, poly2, { tolerance: 1 / 1000 });
        if (overlap.features.length === 0) {
            return 0;
        }
        
        // Calculate total length of all overlapping segments
        let totalLength = 0;
        for (const feature of overlap.features) {
            if (feature.geometry.type === 'LineString') {
                totalLength += length(feature, { units: 'meters' });
            }
        }
        return totalLength;
    }
    catch (error) {
        return 0;
    }
}

/**
 * Update adjacency information between all polygons in the collection
 */
function updateGlobalAdjacency(nodes: PolygonNode[]): void {
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const node1 = nodes[i];
            const node2 = nodes[j];
            
            // Skip if they were already marked as adjacent during ray splitting
            if (node1.adjacentEdges.has(node2.id)) {
                continue;
            }
            
            const sharedLength = calculateSharedEdgeLength(node1.geometry, node2.geometry);
            if (sharedLength > 0.01) {
                node1.adjacentEdges.set(node2.id, sharedLength);
                node2.adjacentEdges.set(node1.id, sharedLength);
            }
        }
    }
}

/**
 * Merge invalid polygons with their best adjacent neighbors recursively
 */
function mergeInvalidPolygons(nodes: PolygonNode[], edgesFacingStreet: LineString): PolygonNode[] {
    return mergeInvalidPolygonsRecursive(nodes, edgesFacingStreet, 0);
}

/**
 * Recursive helper function for merging invalid polygons
 */
function mergeInvalidPolygonsRecursive(nodes: PolygonNode[], edgesFacingStreet: LineString, iteration: number): PolygonNode[] {
    const MAX_ITERATIONS = 10; // Prevent infinite loops
    
    if (iteration >= MAX_ITERATIONS) {
        console.warn(`Reached maximum merge iterations (${MAX_ITERATIONS}), stopping recursion`);
        return nodes;
    }
        
    const result: PolygonNode[] = [];
    const processed = new Set<string>();
    let hasMerges = false;
    
    // Process invalid polygons first to avoid duplicate merging
    for (const invalidNode of nodes) {
        if (invalidNode.isValid || processed.has(invalidNode.id)) {
            continue;
        }
        
        // Find the best adjacent polygon to merge with
        let bestAdjacentNode: PolygonNode | null = null;
        let maxSharedLength = 0;
        
        for (const [adjacentId, sharedLength] of invalidNode.adjacentEdges) {
            const adjacentNode = nodes.find(n => n.id === adjacentId);
            if (adjacentNode && !processed.has(adjacentId) && sharedLength > maxSharedLength) {
                bestAdjacentNode = adjacentNode;
                maxSharedLength = sharedLength;
            }
        }
        
        if (bestAdjacentNode) {
            const mergeResult = mergePolygonNodes(invalidNode, bestAdjacentNode, edgesFacingStreet);
            
            if (mergeResult.success && mergeResult.mergedNode) {
                result.push(mergeResult.mergedNode);
                hasMerges = true;
                
                // Mark both polygons as processed
                processed.add(invalidNode.id);
                processed.add(bestAdjacentNode.id);
            }
            else {
                console.warn(`Failed to merge polygons: ${invalidNode.id} with ${bestAdjacentNode.id}`, mergeResult.error);

                // If merge failed, keep the original adjacent node if it's valid
                if (bestAdjacentNode.isValid) {
                    result.push(bestAdjacentNode);
                    processed.add(bestAdjacentNode.id);
                }
                processed.add(invalidNode.id);
            }
        }
        else {
            // No adjacent polygon found; process in a subsequent iteration
            result.push(invalidNode);
            processed.add(invalidNode.id);
        }
    }
    
    // Add remaining valid polygons that weren't involved in any merge
    for (const node of nodes) {
        if (node.isValid && !processed.has(node.id)) {
            result.push(node);
            processed.add(node.id);
        }
    }
    
    // If we made merges, we need to update adjacency and potentially merge again
    if (hasMerges) {
        // Update adjacency information for the new set of polygons
        updateGlobalAdjacency(result);

        // Check if there are still invalid polygons that need merging
        const hasInvalidPolygons = result.some(node => !node.isValid);
        
        if (hasInvalidPolygons) {
            return mergeInvalidPolygonsRecursive(result, edgesFacingStreet, iteration + 1);
        }
    }
    
    return result;
}

/**
 * Merge two polygon nodes with error handling
 * @param invalidNode The invalid polygon node to merge
 * @param adjacentNode The adjacent polygon node to merge with
 * @param edgesFacingStreet The street edges for validation
 * @returns Object containing the merge result and status
 */
function mergePolygonNodes(
    invalidNode: PolygonNode, 
    adjacentNode: PolygonNode, 
    edgesFacingStreet: LineString
): { success: boolean; mergedNode?: PolygonNode; error?: string } {
    try {
        const bufferMerged = bufferUnionErode([invalidNode.geometry, adjacentNode.geometry]);
            
        if (bufferMerged) {
            const isValid = validatePolygon(bufferMerged, edgesFacingStreet);
            const mergedNode: PolygonNode = {
                id: `${adjacentNode.id}x${invalidNode.id}`,
                geometry: bufferMerged,
                adjacentEdges: new Map(),
                isValid
            };                
            return { success: true, mergedNode };
        }
        else {
            return { 
                success: false, 
                error: `Merge operations failed to produce a valid polygon`
            };
        }
    }
    catch (error) {
        return { 
            success: false, 
            error: `Merge operations failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

/**
 * Attempts to merge polygons using a buffer-union-erode strategy.
 * @param polygons Array of polygon geometries to merge
 * @param tolerance Buffer distance in meters (default: 1m)
 * @returns Merged polygon or null if operation fails
 */
function bufferUnionErode(polygons: Polygon[], tolerance: number = 1): Polygon | null {
    try {
        if (polygons.length === 0) return null;
        if (polygons.length === 1) return polygons[0];

        // Step 1: Buffer slightly to close gaps
        const buffered: Polygon[] = [];
        for (const poly of polygons) {
            const bufferedResult = customBuffer(poly, tolerance, { units: 'meters' });
            if (bufferedResult && bufferedResult.type === 'Feature' && bufferedResult.geometry.type === 'Polygon') {
                buffered.push(bufferedResult.geometry);
            }
            else {
                // If buffer fails, use original polygon
                buffered.push(poly);
            }
        }
        
        // Step 2: Union the buffered polygons
        let result = feature(buffered[0]);
        for (let i = 1; i < buffered.length; i++) {
            const unionResult = union(featureCollection([result, feature(buffered[i])]));
            if (unionResult && unionResult.geometry.type === 'Polygon') {
                result = feature(unionResult.geometry as Polygon);
            }
            else {
                // If union fails at any step, return null
                return null;
            }
        }

        // Step 3: Erode back to original size
        if (result.geometry.type === 'Polygon') {
            const erodedResult = customBuffer(result.geometry, -tolerance, { units: 'meters' });
            if (erodedResult && erodedResult.type === 'Feature' && erodedResult.geometry.type === 'Polygon') {                
                return erodedResult.geometry;
            }
        }
        
        return null;
    }
    catch (error) {
        console.warn('Buffer-union-erode failed:', error);
        return null;
    }
}

/**
 * Generate lots from the processed polygon nodes
 */
function generateLotsFromNodes(nodes: PolygonNode[], street: LogicalStreet): Lot[] {
    const lots: Lot[] = [];
    
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        
        const lotColor = street.color || [100, 100, 100, 255]; // Default color if not set
        
        // Create the lot object
        lots.push({
            geometry: node.geometry,
            color: lotColor,
            id: `${street.id}-lot-${node.id}`
        });
    }
    
    return lots;
}