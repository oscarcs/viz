import { LineString, Polygon } from "@deck.gl-community/editable-layers";
import { lengthToDegrees, feature, cleanCoords, lineString, pointToLineDistance, area } from "@turf/turf";
import { Color } from "deck.gl";
import { LogicalStreet } from "../ds/LogicalStreet";
import polygonSlice from "../util/polygonSlice";
import { Strip } from "./Strips";

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

export function generateLotsFromStrips(street: LogicalStreet, strips: Strip[]): Lot[] {
    return calculateLotsFromBetaStrips(street, strips);
}

function calculateLotsFromBetaStrips(street: LogicalStreet, strips: Strip[]): Lot[] {
    const lots: Lot[] = [];

    for (const strip of strips) {
        const rays = calculateSplittingRays(street, strip);
        lots.push(...splitStripIntoLots(strip, street, rays));
    }

    return lots;
}

const LOT_MIN_AREA = 500; // Minimum area for a valid lot in square meters

/**
 * Generate splitting rays by traversing the edges of the strip polygon that face the street.
 * @param street LogicalStreet
 * @param strip Strip
 * @returns A set of rays (LineStrings) that will be used to split the strip into lots.
 */
function calculateSplittingRays(street: LogicalStreet, strip: Strip): LineString[] {
    const rays: LineString[] = [];
    const rayLength = lengthToDegrees(strip.block.maxLotDepth + 5, 'meters');
    const lotWidth = lengthToDegrees(25, 'meters');

    const edgesFacingStreet = findStripEdgesFacingStreet(street, strip);
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
                } else {
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
function findStripEdgesFacingStreet(street: LogicalStreet, strip: Strip): LineString | null {
    const stripCoords = strip.polygon.coordinates[0];
    const sharedPoints: number[][] = [];
    const tolerance = 1e-10;

    // Check each edge of the strip polygon against each edge of the logical street
    for (let i = 0; i < stripCoords.length - 1; i++) {
        const stripStart = stripCoords[i];
        const stripEnd = stripCoords[i + 1];
        
        // Check against all edges in the logical street
        for (const edge of street.edges) {
            const streetStart = edge.from.coordinates;
            const streetEnd = edge.to.coordinates;
            
            // Check if the strip edge is a subsegment of or coincident with the street edge
            if (isEdgeSubsegment(stripStart, stripEnd, streetStart, streetEnd, tolerance)) {
                // Add the strip edge points if not already present
                if (!sharedPoints.some(p => 
                    Math.abs(p[0] - stripStart[0]) < tolerance && Math.abs(p[1] - stripStart[1]) < tolerance)) {
                    sharedPoints.push(stripStart);
                }
                if (!sharedPoints.some(p => 
                    Math.abs(p[0] - stripEnd[0]) < tolerance && Math.abs(p[1] - stripEnd[1]) < tolerance)) {
                    sharedPoints.push(stripEnd);
                }
                break; // Found a match for this strip edge
            }
        }
    }
    
    if (sharedPoints.length < 2) {
        return null;
    }
    
    // Sort points along the street direction to create a proper line string
    // For simplicity, we'll sort by distance from the first point
    const firstPoint = sharedPoints[0];
    sharedPoints.sort((a, b) => {
        const distA = Math.sqrt((a[0] - firstPoint[0]) ** 2 + (a[1] - firstPoint[1]) ** 2);
        const distB = Math.sqrt((b[0] - firstPoint[0]) ** 2 + (b[1] - firstPoint[1]) ** 2);
        return distA - distB;
    });
    
    return {
        type: 'LineString',
        coordinates: sharedPoints
    };
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
function splitStripIntoLots(
    strip: Strip,
    logicalStreet: LogicalStreet,
    rays: LineString[]
): Lot[] {
    const lots: Lot[] = [];
    
    if (rays.length === 0) {
        // If no rays, return the whole polygon as a single lot
        lots.push({
            geometry: strip.polygon,
            color: logicalStreet.color,
            id: `${logicalStreet.id}-lot-0`
        });
        return lots;
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
    
    // Convert the final polygons to Lot objects
    for (let i = 0; i < currentPolygons.length; i++) {
        const polygon = currentPolygons[i];
        
        // Calculate a slight color variation for each lot
        const baseColor = logicalStreet.color;
        const colorVariation = (i * 20) % 100; // Small variation
        const lotColor: Color = [
            Math.min(255, baseColor[0] + colorVariation),
            Math.min(255, baseColor[1] + colorVariation),
            Math.min(255, baseColor[2] + colorVariation),
            baseColor[3]
        ];
        
        lots.push({
            geometry: polygon,
            color: lotColor,
            id: `${logicalStreet.id}-lot-${i}`
        });
    }
    
    return lots;
}

/**
 * Check if two edges are coincident (overlapping or very close)
 */
function isEdgeSubsegment(
    edge1Start: number[],
    edge1End: number[],
    edge2Start: number[],
    edge2End: number[],
    tolerance: number
): boolean {
    // Check if both endpoints of edge1 are close to edge2
    const start1ToEdge2 = pointToLineDistance(edge1Start, lineString([edge2Start, edge2End]), { units: 'degrees' });
    const end1ToEdge2 = pointToLineDistance(edge1End, lineString([edge2Start, edge2End]), { units: 'degrees' });
    
    // Check if both endpoints of edge2 are close to edge1
    const start2ToEdge1 = pointToLineDistance(edge2Start, lineString([edge1Start, edge1End]), { units: 'degrees' });
    const end2ToEdge1 = pointToLineDistance(edge2End, lineString([edge1Start, edge1End]), { units: 'degrees' });
    
    return (start1ToEdge2 < tolerance && end1ToEdge2 < tolerance) ||
           (start2ToEdge1 < tolerance && end2ToEdge1 < tolerance);
}