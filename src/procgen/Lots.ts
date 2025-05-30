import { area } from "@turf/turf";
import { Feature, Polygon } from "geojson";
import { StraightSkeletonBuilder } from "straight-skeleton-geojson";
import { multipolygonDifference } from "../ds/util";
import { LogicalStreet } from "../ds/LogicalStreet";
import { Color } from "deck.gl";


export type Block = {
    polygon: Feature<Polygon>;
    boundingStreets: LogicalStreet[];
};

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

export function generateLotsFromBlock(block: Block): Lot[] {
    // Step 1: Calculate the offset straight skeleton of the block
    // Create a multipolygon from the polygon to match the example in app.tsx
    const multiPoly = {
        type: 'MultiPolygon',
        coordinates: [block.polygon.geometry.coordinates]
    };
    
    // Build straight skeleton from the multipolygon
    const skelly = StraightSkeletonBuilder.buildFromGeoJSON(multiPoly as any);
    
    // Generate an offset skeleton to create a buffer between the lots and the block edge
    const offsetDistance = 0.0003;
    const skellyPolygon = skelly.toMultiPolygon();
    const offsetSkeleton = skelly.offset(offsetDistance);
    
    // Use the multipolygonDifference utility to get the contour between the skeleton and its offset
    // This gives us the basic lot shapes with some buffer from the block edge
    const lotContour = multipolygonDifference(skellyPolygon, offsetSkeleton);
    
    // Convert the multipolygon result to faces
    const faces: Polygon[] = [];
    
    // Each coordinate set in the multipolygon represents a set of lots that we're going to cut up.
    if (lotContour && lotContour.coordinates) {
        for (const coords of lotContour.coordinates) {
            // Each coordinate set should form a polygon
            if (coords && coords.length > 0) {
                const lot: Polygon = {
                    type: 'Polygon',
                    coordinates: coords
                };
                
                // Only add lots with sufficient area (filter out tiny fragments)
                if (area(lot) > 0.0001) {
                    faces.push(lot);
                }
            }
        }
    }

    // Step 2: Calculate the alpha-strips for the skeleton faces
    // Alpha-strips are lists of faces that are adjacent to each logical street
    const alphaStrips = new Map<string, Polygon[]>();
    
    // Initialize alpha-strips for each bounding street
    for (const street of block.boundingStreets) {
        alphaStrips.set(street.id, []);
    }
    
    // For each face, determine which logical street(s) it's adjacent to
    // A face is adjacent to a street if it shares boundary segments with that street
    // By the straight skeleton property, every face is guaranteed to be adjacent 
    // to at least one of the bounding logical streets
    for (const face of faces) {
        // Get the outer boundary coordinates of the face
        const faceCoords = face.coordinates[0]; // exterior ring
        
        for (const street of block.boundingStreets) {
            let isAdjacent = false;
            
            // Check if any boundary segment of the face lies along this street
            for (const edge of street.edges) {
                const streetStart = edge.from.coordinates;
                const streetEnd = edge.to.coordinates;
                
                // Check if any segment of the face boundary coincides with this street edge
                for (let i = 0; i < faceCoords.length - 1; i++) {
                    const faceStart = faceCoords[i];
                    const faceEnd = faceCoords[i + 1];
                    
                    // Check if this face edge segment is close to and aligned with the street edge
                    if (isSegmentAdjacentToStreetEdge(faceStart, faceEnd, streetStart, streetEnd)) {
                        isAdjacent = true;
                        break;
                    }
                }
                
                if (isAdjacent) break;
            }
            
            if (isAdjacent) {
                alphaStrips.get(street.id)?.push(face);
            }
        }
    }
    
    // Log the alpha strips for debugging
    console.log('Alpha strips calculated:', {
        totalStreets: block.boundingStreets.length,
        totalFaces: faces.length,
        strips: Array.from(alphaStrips.entries()).map(([streetId, faces]) => ({
            streetId,
            faceCount: faces.length
        })),
        // Verify all faces are assigned
        totalAssignedFaces: Array.from(alphaStrips.values()).reduce((sum, faces) => sum + faces.length, 0)
    });

    // Verify that all faces have been assigned to at least one strip
    const totalAssignedFaces = Array.from(alphaStrips.values()).reduce((sum, faces) => sum + faces.length, 0);
    if (totalAssignedFaces !== faces.length) {
        console.warn(`Warning: ${faces.length - totalAssignedFaces} faces were not assigned to any alpha-strip`);
    }

    // Step 3: Adjust the strips at the corners to get the beta-strips

    // Step 4: Generate lots from the strips
    
    // For now, return the faces as lots with random colors
    return faces.map((face, index) => ({
        geometry: face,
        color: [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255] as Color,
        id: `lot-${index}`
    }));
}

/**
 * Check if a face edge segment is adjacent to a street edge
 * Two segments are considered adjacent if they overlap or are very close
 */
function isSegmentAdjacentToStreetEdge(
    faceStart: number[], 
    faceEnd: number[], 
    streetStart: number[], 
    streetEnd: number[]
): boolean {
    const tolerance = 0.0001; // Tolerance for coordinate proximity
    
    // Check if the face segment endpoints are on or very close to the street edge
    const startDistanceToStreet = pointToLineDistance(faceStart, streetStart, streetEnd);
    const endDistanceToStreet = pointToLineDistance(faceEnd, streetStart, streetEnd);
    
    // If both endpoints of the face segment are close to the street edge, 
    // then the face segment is adjacent to the street
    return (startDistanceToStreet < tolerance && endDistanceToStreet < tolerance);
}

/**
 * Calculate the distance from a point to a line segment
 */
function pointToLineDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    
    if (dx === 0 && dy === 0) {
        // Line segment is actually a point
        return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
    }
    
    const t = Math.max(0, Math.min(1, 
        ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy)
    ));
    
    const projection = [
        lineStart[0] + t * dx,
        lineStart[1] + t * dy
    ];
    
    return Math.sqrt((point[0] - projection[0]) ** 2 + (point[1] - projection[1]) ** 2);
}