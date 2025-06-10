import { Feature, LineString, MultiPolygon, Polygon } from "geojson";
import { 
    area, 
    lineString, 
    union, 
    featureCollection, 
    feature,
    cleanCoords,
    simplify,
    difference
} from '@turf/turf';
import polygonSlice from '../util/polygonSlice';
import { Color } from '@deck.gl-community/editable-layers';
import { LogicalStreet } from '../ds/LogicalStreet';
import { StraightSkeletonBuilder } from "straight-skeleton-geojson";
import { multipolygonDifference } from "../util/util";

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
    const lots = calculateLotsFromBetaStrips(betaStrips, block.boundingStreets);    

    // Temp output to debug beta strips
    const tempLots: Lot[] = [];
    for (const [streetId, faces] of betaStrips) {
        const color = [
            Math.floor(Math.random() * 200),
            Math.floor(Math.random() * 200),
            Math.floor(Math.random() * 200),
            255
        ] as Color;
        
        for (const [index, face] of faces.entries()) {
            const offset = index * 10;
            tempLots.push({
                geometry: face,
                color: [
                    color[0] + offset,
                    color[1] + offset,
                    color[2] + offset,
                    color[3]
                ] as Color,
                id: `${streetId}-${lots.length}` // Unique ID for each lot
            });
        }
    }
    return tempLots;

    // return lots;
}

function calculateFacesFromBlock(block: Block): Polygon[] {
    // Create a multipolygon from the polygon to match the example in app.tsx
    const multiPoly: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: [block.polygon.geometry.coordinates]
    };
    
    // Build straight skeleton from the multipolygon
    const straightSkeleton = StraightSkeletonBuilder.buildFromGeoJSON(multiPoly as any);
    
    // Generate an offset skeleton to create a buffer between the lots and the block edge
    const offsetDistance = 0.0003;
    const straightSkeletonPolygons = straightSkeleton.toMultiPolygon();
    const offsetSkeleton = straightSkeleton.offset(offsetDistance);

    // Use the multipolygonDifference utility to get the contour between the skeleton and its offset
    // This gives us the basic lot shapes with some buffer from the block edge
    const lotContour = multipolygonDifference(straightSkeletonPolygons, offsetSkeleton);
    
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
                
                // Simplify the polygon to reduce edge count while preserving shape
                const simplifiedLot = simplify(feature(lot), { tolerance: 0.00001, highQuality: true });
                
                // Only add lots with sufficient area (filter out tiny fragments)
                if (simplifiedLot.geometry && area(simplifiedLot.geometry) > 0.0001) {
                    faces.push(simplifiedLot.geometry as Polygon);
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
        const faceCoords = face.coordinates[0];
        
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

    const regions = [];

    // For each adjacent pair of alpha strips, calculate the corner regions
    for (const pair of adjacentPairs) {

        console.log(pair.face1.coordinates[0].length - 1, pair.face2.coordinates[0].length - 1);

        // Calculate which street is longer to determine which strip to cut from
        const street1 = block.boundingStreets.find(street => street.id === pair.streetId1);
        const street2 = block.boundingStreets.find(street => street.id === pair.streetId2);

        if (!street1 || !street2) {
            console.warn(`Street not found for IDs: ${pair.streetId1}, ${pair.streetId2}`);
            continue;
        }

        const length1 = street1.getLength();
        const length2 = street2.getLength();

        if (length1 === 0 || length2 === 0) {
            console.warn(`One of the streets has zero length: ${pair.streetId1} (${length1}), ${pair.streetId2} (${length2})`);
            continue;
        }

        // Swap the triangular corner regions from the shorter street to the longer one
        const swapFrom: Polygon = length1 < length2 ? pair.face1 : pair.face2;

        const region = calculateTriangularRegionToCut(
            swapFrom, 
            pair.sharedEdge, 
            block
        );

        regions.push({
            region,
            fromIndex: length1 < length2 ? pair.indexInStrip1 : pair.indexInStrip2,
            fromStreetId: length1 < length2 ? pair.streetId1 : pair.streetId2,
            toIndex: length1 < length2 ? pair.indexInStrip2 : pair.indexInStrip1,
            toStreetId: length1 < length2 ? pair.streetId2 : pair.streetId1
        });
    }

    // Apply region transfers to create beta strips
    for (const regionTransfer of regions) {
        const { region, fromIndex, fromStreetId, toIndex, toStreetId } = regionTransfer;
        
        // Get the current state of the strips (important for multiple transfers)
        const fromStrip = betaStrips.get(fromStreetId);
        const toStrip = betaStrips.get(toStreetId);
        
        if (!fromStrip || !toStrip) {
            console.warn(`Strip not found for transfer: from ${fromStreetId} to ${toStreetId}`);
            continue;
        }
        
        if (fromIndex >= fromStrip.length || toIndex >= toStrip.length) {
            console.warn(`Index out of bounds for transfer: from ${fromIndex}/${fromStrip.length} to ${toIndex}/${toStrip.length}`);
            continue;
        }

        try {
            // Remove the region from the source polygon using difference
            const fromPolygon = fromStrip[fromIndex];
            const fromFeature = feature(fromPolygon);
            const regionFeature = feature(region);
            
            const differenceResult = difference(featureCollection([fromFeature, regionFeature]));
            
            if (differenceResult && differenceResult.geometry && differenceResult.geometry.type === 'Polygon') {
                // Update the from polygon with the result of the difference operation
                fromStrip[fromIndex] = differenceResult.geometry as Polygon;
            }
            else {
                console.warn(`Difference operation failed or resulted in non-polygon geometry for ${fromStreetId}[${fromIndex}]`);
                continue;
            }

            // Add the region to the target polygon using union
            const toPolygon = toStrip[toIndex];
            const toFeature = feature(toPolygon);
            
            const unionResult = union(featureCollection([toFeature, regionFeature]));
            
            if (unionResult && unionResult.geometry && unionResult.geometry.type === 'Polygon') {
                // Update the to polygon with the result of the union operation
                toStrip[toIndex] = unionResult.geometry as Polygon;
            }
            else {
                console.warn(`Union operation failed or resulted in non-polygon geometry for ${toStreetId}[${toIndex}]`);
                // If union failed, we should revert the difference operation
                fromStrip[fromIndex] = fromPolygon;
                continue;
            } 
        }
        catch (error) {
            console.warn(`Error during region transfer from ${fromStreetId}[${fromIndex}] to ${toStreetId}[${toIndex}]:`, error);
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

/**
 * Calculate the triangular area to cut from swapFrom (CDX), where X is the
 * closest point on edge AC to point D.
 * @param swapFrom The quadrilateral to swap from (ABCD)
 * @param sharedEdge The shared edge between the two polygons (CD)
 * @param block The block containing both polygons, including edge AC.
 * @returns The triangular area to cut from swapFrom and transfer to swapTo.
 */
function calculateTriangularRegionToCut(
    swapFrom: Polygon,
    sharedEdge: [number[], number[]],
    block: Block
): Polygon | null {
    // Contains edges AC and CE, shared with swapFrom and swapTo
    const blockBoundary = block.polygon.geometry.coordinates[0];
    const isPointOnBoundary = (point: number[]) => blockBoundary.some(coord =>
        coord[0] === point[0] && coord[1] === point[1]
    );
    
    // Find the shared edge points C and D
    // C should be the point on the block boundary, D should be the interior point
    const [point1, point2] = sharedEdge;
    let pointC: number[], pointD: number[];

    const isPoint1OnBoundary = isPointOnBoundary(point1);
    const isPoint2OnBoundary = isPointOnBoundary(point2);

    if (isPoint1OnBoundary && !isPoint2OnBoundary) {
        pointC = point1; // On block boundary
        pointD = point2; // Interior point
    }
    else if (isPoint2OnBoundary && !isPoint1OnBoundary) {
        pointC = point2; // On block boundary
        pointD = point1; // Interior point
    }
    else {
        console.warn(`Could not determine boundary vs interior points for shared edge: ${sharedEdge}`);
        return null;
    }

    let pointA: number[] | null = null;
    let edgeAC: [number[], number[]] | null = null;

    const swapFromCoords = swapFrom.coordinates[0];

    // Look for an edge in swapFrom that contains pointC and has its other endpoint on the block boundary
    for (let i = 0; i < swapFromCoords.length - 1; i++) {
        const edgeStart = swapFromCoords[i];
        const edgeEnd = swapFromCoords[i + 1];
        
        // Check if this edge contains pointC
        const containsC = (edgeStart[0] === pointC[0] && edgeStart[1] === pointC[1]) ||
            (edgeEnd[0] === pointC[0] && edgeEnd[1] === pointC[1]);
        
        if (containsC) {
            // Determine which point is A (the other endpoint that should be on block boundary)
            const otherPoint = (edgeStart[0] === pointC[0] && edgeStart[1] === pointC[1]) ? edgeEnd : edgeStart;
            
            // Check if the other point is on the block boundary
            const isOtherPointOnBoundary = isPointOnBoundary(otherPoint);
            
            // Also check that this other point is not pointD (we want the AC edge, not CD edge)
            const isNotPointD = !(otherPoint[0] === pointD[0] && otherPoint[1] === pointD[1]);
            
            if (isOtherPointOnBoundary && isNotPointD) {
                pointA = otherPoint;
                edgeAC = [pointA, pointC];
                break;
            }
        }
    }

    if (!pointA || !edgeAC) {
        console.warn(`Could not find edge AC in swapFrom polygon`);
        return null;
    }

    const pointX = findClosestPointOnLineSegment(pointD, pointA, pointC);

    const triangularArea: Polygon = {
        type: "Polygon",
        coordinates: [[pointC, pointD, pointX, pointC]]
    };

    return triangularArea;
}

/**
 * Find the closest point on a line segment to a given point
 */
function findClosestPointOnLineSegment(
    point: number[], 
    lineStart: number[], 
    lineEnd: number[]
): number[] {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    
    if (dx === 0 && dy === 0) {
        // Line segment is actually a point, return that point
        return lineStart;
    }
    
    // Calculate the parameter t for the closest point on the line
    const t = Math.max(0, Math.min(1, 
        ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy)
    ));
    
    // Calculate the closest point
    return [
        lineStart[0] + t * dx,
        lineStart[1] + t * dy
    ];
}

function calculateLotsFromBetaStrips(betaStrips: Map<string, Polygon[]>, boundingStreets: LogicalStreet[]): Lot[] {
    // Minimum parcel width
    const Wmin = 0.0004;
    // Maximum parcel width
    const Wmax = 0.0004;
    // Split irregularity (0-1)
    const omega = 1;
    
    const mergedPolygons: Map<string, Polygon> = new Map();
    for (const [streetId, faces] of betaStrips) {

        if (faces.length < 2) {
            mergedPolygons.set(streetId, faces[0]);
            continue;
        }

        const featuresToUnion = featureCollection(faces.map(f => feature(f)));
        const unionResult = union(featuresToUnion);
       
        if (unionResult && unionResult.geometry && unionResult.geometry.type === 'Polygon') {
            const mergedPolygon = unionResult.geometry as Polygon;
            mergedPolygons.set(streetId, mergedPolygon);
        }
        else {
            console.warn(`Union failed for street ${streetId} or resulted in invalid geometry.`);
        }
    }

    const lots: Lot[] = [];
    // for (const [streetId, mergedPolygon] of mergedPolygons) {
    //     lots.push({
    //         geometry: mergedPolygon,
    //         color: [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255] as Color,
    //         id: `merged-${lots.length}` // Unique ID for each merged polygon
    //     });
    // }
    // return lots;

    for (const [streetId, mergedPolygon] of mergedPolygons) {
        const street = boundingStreets.find(street => street.id === streetId);

        if (!street) {
            console.warn(`Street with ID ${streetId} not found in bounding streets.`);
            continue;
        }

        const rays = calculateSplittingRaysAlongBetaStripStreet(
            mergedPolygon,
            street,
            Wmin,
            Wmax,
            omega
        );

        lots.push(...splitPolygonIntoLots(mergedPolygon, street, rays));
    }

    return lots.filter(lot => lot.geometry && lot.geometry.coordinates.length > 0 && area(lot.geometry) > 1000);
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
    const start1ToEdge2 = pointToLineDistance(edge1Start, edge2Start, edge2End);
    const end1ToEdge2 = pointToLineDistance(edge1End, edge2Start, edge2End);
    
    // Check if both endpoints of edge2 are close to edge1
    const start2ToEdge1 = pointToLineDistance(edge2Start, edge1Start, edge1End);
    const end2ToEdge1 = pointToLineDistance(edge2End, edge1Start, edge1End);
    
    return (start1ToEdge2 < tolerance && end1ToEdge2 < tolerance) ||
           (start2ToEdge1 < tolerance && end2ToEdge1 < tolerance);
}

/**
 * Generate a normally distributed random number using Box-Muller transform
 */
function normalRandom(mean: number, variance: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + Math.sqrt(variance) * z0;
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
                // console.warn(`Failed to slice polygon with ray ${rayIndex}:`, error);
                // console.log("Original polygon:", JSON.stringify(polygon.coordinates));
                // console.log("Ray:", JSON.stringify(ray.coordinates));

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
