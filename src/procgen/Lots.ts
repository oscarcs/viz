import { area, lineString, nearestPointOnLine, intersect, union, difference, polygons, convex, featureCollection, point } from "@turf/turf";
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

/**
 * Calculate lots from a block polygon and its bounding logical streets according to the algorithm given in Vanegas et al. (2012).
 * @param block Polygon representing the block and its bounding logical streets.
 * @returns An array of lots.
 */
export function generateLotsFromBlock(block: Block): Lot[] {
    // Step 1: Calculate the offset straight skeleton of the block
    const faces = calculateFacesFromBlock(block);

    // Step 2: Calculate the alpha-strips for the skeleton faces
    const alphaStrips = calculateAlphaStripsFromFaces(faces, block.boundingStreets);

    // Step 3: Create the beta strips by swapping corner regions between adjacent alpha strips
    const betaStrips = calculateBetaStripsFromAlphaStrips(alphaStrips, block);

    // Step 4: Generate lots from the strips
    // const lots = calculateLotsFromBetaStrips(betaStrips);    

    //Temp output to debug beta strips
    const lots: Lot[] = [];
    for (const [streetId, faces] of betaStrips) {
        const color = [Math.floor(Math.random() * 200), Math.floor(Math.random() * 200), Math.floor(Math.random() * 200), 255] as Color;
        for (const [index, face] of faces.entries()) {
            const offset = index * 10;
            lots.push({
                geometry: face,
                color: [color[0] + offset, color[1] + offset, color[2] + offset, color[3]] as Color,
                id: `${streetId}-${lots.length}` // Unique ID for each lot
            });
        }
    }

    return lots;
}

function calculateFacesFromBlock(block: Block): Polygon[] {
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

    return faces;
}

function calculateAlphaStripsFromFaces(faces: Polygon[], boundingStreets: LogicalStreet[]
): Map<string, Polygon[]> {
    // Alpha-strips are lists of faces that are adjacent to each logical street
    const alphaStrips = new Map<string, Polygon[]>();
    
    // Initialize alpha-strips for each bounding street
    for (const street of boundingStreets) {
        alphaStrips.set(street.id, []);
    }
    
    // For each face, determine which logical street(s) it's adjacent to
    // A face is adjacent to a street if it shares boundary segments with that street
    // By the straight skeleton property, every face is guaranteed to be adjacent 
    // to at least one of the bounding logical streets
    for (const face of faces) {
        // Get the outer boundary coordinates of the face
        const faceCoords = face.coordinates[0]; // exterior ring
        
        for (const street of boundingStreets) {
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

    return alphaStrips;
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

type AdjacentPair = {
    streetId1: string;
    streetId2: string;
    sharedEdge: [number[], number[]];
    face1: Polygon;
    face2: Polygon;
    indexInStrip1: number;
    indexInStrip2: number;
}

function calculateBetaStripsFromAlphaStrips(alphaStrips: Map<string, Polygon[]>, block: Block): Map<string, Polygon[]> {
    // Create a copy of alpha strips to work with
    const betaStrips = new Map<string, Polygon[]>();
    for (const [streetId, faces] of alphaStrips) {
        betaStrips.set(streetId, [...faces]);
    }

    // Find adjacent alpha strips
    const adjacentPairs: Array<AdjacentPair> = [];
    const streetIds = Array.from(alphaStrips.keys());
    
    for (let i = 0; i < streetIds.length; i++) {
        for (let j = i + 1; j < streetIds.length; j++) {
            const strip1 = alphaStrips.get(streetIds[i])!;
            const strip2 = alphaStrips.get(streetIds[j])!;
            
            const sharedEdgeInfo = findSharedEdgeBetweenStrips(streetIds[i], streetIds[j], strip1, strip2, block);
            if (sharedEdgeInfo) {
                adjacentPairs.push(sharedEdgeInfo);
            }
        }
    }

    // For each adjacent pair of alpha strips, calculate the corner regions
    for (const {streetId1, streetId2, sharedEdge, face1, face2, indexInStrip1, indexInStrip2} of adjacentPairs) {
        // Calculate which street is longer to determine which strip to cut from
        const street1 = block.boundingStreets.find(street => street.id === streetId1);
        const street2 = block.boundingStreets.find(street => street.id === streetId2);

        if (!street1 || !street2) {
            console.warn(`Street not found for IDs: ${streetId1}, ${streetId2}`);
            continue;
        }

        const length1 = street1.getLength();
        const length2 = street2.getLength();

        if (length1 === 0 || length2 === 0) {
            console.warn(`One of the streets has zero length: ${streetId1} (${length1}), ${streetId2} (${length2})`);
            continue;
        }

        // Cut from the shorter street's strip to the longer street's strip
        const cutFromFace1 = length1 < length2;

        // Find the corner region between these two strips
        const cornerRegion = calculateCornerRegion(sharedEdge, face1, face2, block, cutFromFace1);
        
        // Swap the corner region from one strip to the other
        if (cornerRegion) {
            // Add the corner region to the first beta strip for debugging
            // betaStrips.get(streetId1)?.push(cornerRegion);
            
            if (cutFromFace1) {
                cutCornerRegionAndTransfer(betaStrips, streetId1, streetId2, indexInStrip1, indexInStrip2, cornerRegion);
            }
            else {
                cutCornerRegionAndTransfer(betaStrips, streetId2, streetId1, indexInStrip2, indexInStrip1, cornerRegion);                
            }
        }
    }

    return betaStrips;
}

function findSharedEdgeBetweenStrips(streetId1: string, streetId2: string, strip1: Polygon[], strip2: Polygon[], block: Block): AdjacentPair | null {
    for (const [indexInStrip1, face1] of strip1.entries()) {
        for (const [indexInStrip2, face2] of strip2.entries()) {
            const sharedEdge = findSharedEdge(face1, face2);

            if (sharedEdge) {
                // Check if the shared edge shares a coordinate with the block polygon
                const blockBoundary = block.polygon.geometry.coordinates[0];
                const isEdgeOnBlock = blockBoundary.some(coord =>
                    (coord[0] === sharedEdge[0][0] && coord[1] === sharedEdge[0][1]) ||
                    (coord[0] === sharedEdge[1][0] && coord[1] === sharedEdge[1][1])
                );
                if (!isEdgeOnBlock) continue;

                return {
                    streetId1,
                    streetId2,
                    sharedEdge,
                    face1,
                    face2,
                    indexInStrip1, 
                    indexInStrip2
                };
            }
        }
    }
    return null;
}

function findSharedEdge(polygon1: Polygon, polygon2: Polygon): [number[], number[]] | null {
    const coords1 = polygon1.coordinates[0];
    const coords2 = polygon2.coordinates[0];
            
    // Check each edge of polygon1 against each edge of polygon2
    for (let i = 0; i < coords1.length - 1; i++) {
        const edge1Start = coords1[i];
        const edge1End = coords1[i + 1];
        
        for (let j = 0; j < coords2.length - 1; j++) {
            const edge2Start = coords2[j];
            const edge2End = coords2[j + 1];
            
            // Check if edges are the same (same or opposite direction)
            if (edgesAreEqual(edge1Start, edge1End, edge2Start, edge2End)) {
                return [edge1Start, edge1End];
            }
        }
    }

    return null;
}

function edgesAreEqual(e1Start: number[], e1End: number[], e2Start: number[], e2End: number[]): boolean {
    return (
        (e1Start[0] === e2Start[0] && e1Start[1] === e2Start[1] && e1End[0] === e2End[0] && e1End[1] === e2End[1]) ||
        (e1Start[0] === e2End[0] && e1Start[1] === e2End[1] && e1End[0] === e2Start[0] && e1End[1] === e2Start[1])
    );
}

// Calculate the corner region between two faces based on their shared edge
// This is currently too simplistic because it only handles triangular corner regions
function calculateCornerRegion(
    sharedEdge: [number[], number[]],
    face1: Polygon,
    face2: Polygon,
    block: Block,
    cutFromFace1: boolean
): Polygon | null {
    // Find which of the points on the shared edge is not on the block polygon
    const sharedEdgeStart = sharedEdge[0];
    const sharedEdgeEnd = sharedEdge[1];
    const blockBoundary = block.polygon.geometry.coordinates[0];
    const isStartOnBlock = blockBoundary.some(coord => coord[0] === sharedEdgeStart[0] && coord[1] === sharedEdgeStart[1]);
    const furthestPoint = isStartOnBlock ? sharedEdgeEnd : sharedEdgeStart;

    let edgeToCutTo = cutFromFace1 ?
        findSharedEdge(face1, block.polygon.geometry) :
        findSharedEdge(face2, block.polygon.geometry); 

    if (!edgeToCutTo) {
        console.warn("No co-incident edge found for corner region cutting");
        return null;
    }

    let closestPointOnEdgeToCutTo = nearestPointOnLine(
        lineString([edgeToCutTo[0], edgeToCutTo[1]]),
        furthestPoint
    ).geometry.coordinates;

    // Create a polygon that defines the corner region to be transferred
    const points = featureCollection([
        point(sharedEdgeStart),
        point(sharedEdgeEnd),
        point(closestPointOnEdgeToCutTo),
        point(furthestPoint),
    ]);

    const convexHull = convex(points);
    if (!convexHull || !convexHull.geometry || convexHull.geometry.type !== 'Polygon') {
        console.warn("Could not create convex hull for corner region");
        return null;
    }

    return convexHull.geometry as Polygon;
}

function cutCornerRegionAndTransfer(
    betaStrips: Map<string, Polygon[]>,
    fromStreetId: string,
    toStreetId: string,
    fromFaceIndex: number,
    toFaceIndex: number,
    cornerRegion: Polygon
): void {
    const fromStrip = betaStrips.get(fromStreetId);
    const toStrip = betaStrips.get(toStreetId);
    
    if (!fromStrip || !toStrip || 
        fromFaceIndex < 0 || fromFaceIndex >= fromStrip.length || 
        toFaceIndex < 0 || toFaceIndex >= toStrip.length) {
        return;
    }

    const fromFace = fromStrip[fromFaceIndex];
    const toFace = toStrip[toFaceIndex];
    
    try {
        // Find the shared edge between the two faces
        const sharedEdge = findSharedEdge(fromFace, toFace);
        if (!sharedEdge) {
            console.warn("No shared edge found between faces for cutting");
            return;
        }
        
        // Create FeatureCollection for intersection operation
        const intersectionFeatureCollection = polygons([
            fromFace.coordinates,
            cornerRegion.coordinates
        ]);
        
        // Find the intersection (corner region) between the fromFace and the cutting polygon
        const cornerRegionIntersection = intersect(intersectionFeatureCollection);
        if (!cornerRegionIntersection) {
            console.warn("No intersection found for corner region");
            return;
        }
        
        // Ensure we have polygon coordinates (not multipolygon)
        let cornerCoordinates: number[][][];
        if (cornerRegionIntersection.geometry.type === 'Polygon') {
            cornerCoordinates = cornerRegionIntersection.geometry.coordinates;
        }
        else if (cornerRegionIntersection.geometry.type === 'MultiPolygon') {
            // Take the first polygon from the multipolygon
            cornerCoordinates = cornerRegionIntersection.geometry.coordinates[0];
        }
        else {
            console.warn("Unexpected geometry type from intersection");
            return;
        }
        
        // Create FeatureCollection for difference operation
        const differenceFeatureCollection = polygons([
            fromFace.coordinates,
            cornerCoordinates
        ]);
        
        // Get the remaining part of fromFace after removing the corner region
        const remainingFaceResult = difference(differenceFeatureCollection);
        if (!remainingFaceResult) {
            console.warn("Could not compute remaining face after corner region removal");
            return;
        }
        
        // Update the fromFace with the remaining geometry
        fromStrip[fromFaceIndex] = remainingFaceResult.geometry as Polygon;
        
        // Create FeatureCollection for union operation
        const unionFeatureCollection = polygons([
            toFace.coordinates,
            cornerCoordinates
        ]);
        
        // Merge the corner region with the toFace using union
        const mergedResult = union(unionFeatureCollection);
        if (mergedResult) {
            toStrip[toFaceIndex] = mergedResult.geometry as Polygon;
        }
        else {
            console.warn("Could not merge corner region with target face");
        }
        
    }
    catch (error) {
        console.warn("Failed to cut corner region:", error);
    }
}

function calculateLotsFromBetaStrips(betaStrips: Map<string, Polygon[]>): Lot[] {
    // Parameters for lot generation
    const Wmin = 0.0005; // Minimum parcel width
    const Wmax = 0.002;  // Maximum parcel width
    const omega = 0.3;   // Split irregularity (0-1)
    
    // Step 1: Merge all beta strip faces into one polygon
    const allFaces: Polygon[] = [];
    for (const faces of betaStrips.values()) {
        allFaces.push(...faces);
    }
    
    if (allFaces.length === 0) {
        return [];
    }
    
    // Union all faces together
    let mergedPolygon = allFaces[0];
    for (let i = 1; i < allFaces.length; i++) {
        const unionFeatureCollection = polygons([
            mergedPolygon.coordinates,
            allFaces[i].coordinates
        ]);
        const unionResult = union(unionFeatureCollection);
        if (unionResult && unionResult.geometry.type === 'Polygon') {
            mergedPolygon = unionResult.geometry as Polygon;
        }
    }
    
    // Step 2: Sample points along the block edge
    const blockBoundary = mergedPolygon.coordinates[0];
    const splitPoints = samplePointsAlongEdge(blockBoundary, Wmin, Wmax, omega);
    
    // Step 3: Create splitting rays and split the polygon
    
    return [];
}

function samplePointsAlongEdge(
    boundary: number[][],
    Wmin: number,
    Wmax: number,
    omega: number
): Array<{point: number[], normal: number[]}> {
    const splitPoints: Array<{point: number[], normal: number[]}> = [];
    
    // Calculate the mean distance and standard deviation
    const meanDistance = (Wmin + Wmax) / 2;
    const stdDev = Math.sqrt(3 * omega);
    
    let currentDistance = 0;
    let totalEdgeLength = 0;
    
    // Calculate total edge length
    for (let i = 0; i < boundary.length - 1; i++) {
        const dx = boundary[i + 1][0] - boundary[i][0];
        const dy = boundary[i + 1][1] - boundary[i][1];
        totalEdgeLength += Math.sqrt(dx * dx + dy * dy);
    }
    
    // Sample points along the boundary
    let accumulatedLength = 0;
    for (let i = 0; i < boundary.length - 1; i++) {
        const start = boundary[i];
        const end = boundary[i + 1];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const edgeLength = Math.sqrt(dx * dx + dy * dy);
        
        // Skip very short edges
        if (edgeLength < 0.0001) continue;
        
        const edgeDirection = [dx / edgeLength, dy / edgeLength];
        const normal = [-edgeDirection[1], edgeDirection[0]]; // Perpendicular inward normal
        
        // Sample points along this edge
        while (currentDistance <= accumulatedLength + edgeLength) {
            const t = (currentDistance - accumulatedLength) / edgeLength;
            const point = [
                start[0] + t * dx,
                start[1] + t * dy
            ];
            
            splitPoints.push({
                point,
                normal
            });
            
            // Calculate next distance with normal distribution
            let nextDistance = meanDistance;
            if (omega > 0) {
                // Box-Muller transform for normal distribution
                const u1 = Math.random();
                const u2 = Math.random();
                const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                nextDistance = meanDistance + stdDev * z0;
            }
            
            // Clamp to valid range
            nextDistance = Math.max(Wmin, Math.min(Wmax, nextDistance));
            currentDistance += nextDistance;
            
            if (currentDistance >= totalEdgeLength) break;
        }
        
        accumulatedLength += edgeLength;
    }
    
    return splitPoints;
}

