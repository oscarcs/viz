import { LineString, Polygon } from "@deck.gl-community/editable-layers";
import { lengthToDegrees, feature, cleanCoords, lineString, pointToLineDistance } from "@turf/turf";
import { Color } from "deck.gl";
import { LogicalStreet } from "../ds/LogicalStreet";
import polygonSlice from "../util/polygonSlice";
import { normalRandom } from "../util/random";
import { Block } from "./Strips";

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

export function generateLotsFromStrips(strips: Map<string, Polygon>, block: Block): Lot[] {
    return calculateLotsFromBetaStrips(strips, block.boundingStreets);
}

function calculateLotsFromBetaStrips(betaStrips: Map<string, Polygon>, boundingStreets: LogicalStreet[]): Lot[] {
    // Min and max parcel widths
    const Wmin = lengthToDegrees(20, 'meters');
    const Wmax = lengthToDegrees(35, 'meters');
    
    // Split irregularity (0-1)
    const omega = 1;

    const lots: Lot[] = [];

    for (const [streetId, mergedPolygon] of betaStrips) {
        const street = boundingStreets.find(street => street.id === streetId);

        if (!street) {
            console.warn(`Street with ID ${streetId} not found in bounding streets.`);
            continue;
        }

        const rays = calculateSplittingRaysAlongBetaStripStreet(mergedPolygon, street, Wmin, Wmax, omega);

        lots.push(...splitPolygonIntoLots(mergedPolygon, street, rays));
    }

    return lots.filter(lot => lot.geometry && lot.geometry.coordinates.length > 0);
}

/**
 * Calculate splitting rays along the part of the street that has co-incident edges with the mergedPolygon.
 * First we generate points along the co-incident edges, normally distributed around (Wmin + Wmax)/2, with σ2 = 3ω.
 * Wmin is the min distance between points, Wmax is the max distance between points.
 * Then we generate rays from these points perpendicular to the street.
 */
function calculateSplittingRaysAlongBetaStripStreet(
    mergedPolygon: Polygon,
    logicalStreet: LogicalStreet,
    Wmin: number,
    Wmax: number,
    omega: number
): LineString[] {
    const rays: LineString[] = [];
    const polygonBoundary = mergedPolygon.coordinates[0];
    const tolerance = 0.0001;
    
    const subsegmentEdges: Array<{
        polygonEdge: [number[], number[]],
        length: number
    }> = [];
    
    // Check each polygon edge to see if it's a subsegment of the logical street edges
    for (let i = 0; i < polygonBoundary.length - 1; i++) {
        const polyStart = polygonBoundary[i];
        const polyEnd = polygonBoundary[i + 1];

        for (const edge of logicalStreet.edges) {
            const streetStart = edge.from.coordinates;
            const streetEnd = edge.to.coordinates;
            
            if (isEdgeSubsegment(polyStart, polyEnd, streetStart, streetEnd, tolerance)) {
                const edgeLength = Math.sqrt(
                    (polyEnd[0] - polyStart[0]) ** 2 + (polyEnd[1] - polyStart[1]) ** 2
                );

                subsegmentEdges.push({
                    polygonEdge: [polyStart, polyEnd],
                    length: edgeLength
                });

                break;
            }
        }
    }

    if (subsegmentEdges.length === 0) {
        return rays;
    }
    
    // Generate splitting points along subsegment edges
    const meanDistance = (Wmin + Wmax) / 2;
    const variance = 3 * omega;
    
    for (const { polygonEdge } of subsegmentEdges) {
        const edgeStart = polygonEdge[0];
        const edgeEnd = polygonEdge[1];
        const edgeLength = Math.sqrt(
            (edgeEnd[0] - edgeStart[0]) ** 2 + (edgeEnd[1] - edgeStart[1]) ** 2
        );
        
        // Generate points along this edge
        let currentDistance = 0;
        
        while (currentDistance < edgeLength) {
            // Generate normally distributed spacing
            const spacing = Math.max(Wmin, Math.min(Wmax, 
                normalRandom(meanDistance, variance)
            ));
            
            currentDistance += spacing;
            
            if (currentDistance >= edgeLength) break;
            
            // Calculate point position along the edge
            const t = currentDistance / edgeLength;
            const pointX = edgeStart[0] + t * (edgeEnd[0] - edgeStart[0]);
            const pointY = edgeStart[1] + t * (edgeEnd[1] - edgeStart[1]);
            
            // Create perpendicular ray from this point
            const ray = createPerpendicularRay([pointX, pointY], edgeStart, edgeEnd);
            if (ray) {
                rays.push(ray);
            }
        }
    }
    
    return rays;
}

/**
 * Create a perpendicular ray from a point on an edge, extending into the polygon
 */
function createPerpendicularRay(
    point: number[],
    edgeStart: number[],
    edgeEnd: number[]
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
    
    // TODO: The ray length needs to be the same as the offset distance used in the skeleton 
    const rayLength = 0.01;
 
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
function splitPolygonIntoLots(
    mergedPolygon: Polygon,
    logicalStreet: LogicalStreet,
    rays: LineString[]
): Lot[] {
    const lots: Lot[] = [];
    
    if (rays.length === 0) {
        // If no rays, return the whole polygon as a single lot
        lots.push({
            geometry: mergedPolygon,
            color: logicalStreet.color,
            id: `${logicalStreet.id}-lot-0`
        });
        return lots;
    }
    
    // Start with the original merged polygon
    let currentPolygons: Polygon[] = [mergedPolygon];
    
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
                    // Add all resulting polygons
                    for (const slicedFeature of sliceResult.features) {
                        if (slicedFeature.geometry.type === 'Polygon') {
                            newPolygons.push(slicedFeature.geometry);
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
                console.warn(`Failed to slice polygon with ray ${rayIndex}:`, error);
                console.log(JSON.stringify(ray, null, 2) + ",\n" + JSON.stringify(polygon, null, 2));

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
    const end1ToEdge2 = pointToLineDistance(edge1End, lineString([edge2Start, edge2End], { units: 'degrees' }));
    
    // Check if both endpoints of edge2 are close to edge1
    const start2ToEdge1 = pointToLineDistance(edge2Start, lineString([edge1Start, edge1End]), { units: 'degrees' });
    const end2ToEdge1 = pointToLineDistance(edge2End, lineString([edge1Start, edge1End], { units: 'degrees' }));
    
    return (start1ToEdge2 < tolerance && end1ToEdge2 < tolerance) ||
           (start2ToEdge1 < tolerance && end2ToEdge1 < tolerance);
}