import { Feature, LineString, MultiPolygon, Polygon } from "geojson";
import { 
    area, 
    lineString, 
    union, 
    featureCollection, 
    feature,
    difference,
    booleanPointInPolygon,
    point,
    pointToLineDistance,
    lengthToDegrees,
    nearestPointOnLine
} from '@turf/turf';
import polygonSlice from '../util/polygonSlice';
import { LogicalStreet } from '../ds/LogicalStreet';
import { StraightSkeletonBuilder } from "straight-skeleton-geojson";
import { multipolygonDifference } from "../util/util";

export type Block = {
    polygon: Feature<Polygon>;
    boundingStreets: LogicalStreet[];
    maxLotDepth: number; // Maximum depth of the lot from the street edge in degrees 
};

export type Strip = {
    polygon: Polygon;
    block: Block;
}

/**
 * Calculate strips from a block polygon and its bounding logical streets according to the algorithm given in Vanegas et al. (2012).
 * @param block Polygon representing the block and its bounding logical streets.
 * @returns A map of street IDs to polygons representing the strips.
 */
export function generateStripsFromBlock(block: Block): Map<string, Strip> {
    // Step 1: Calculate the offset straight skeleton of the block
    const faces = calculateFacesFromBlock(block);

    // Step 2: Calculate the alpha-strips for the skeleton faces
    const alphaStrips = calculateAlphaStripsFromFaces(faces, block.boundingStreets);

    // Step 3: Create the beta strips by swapping corner regions between adjacent alpha strips
    const betaStrips = calculateBetaStripsFromAlphaStrips(alphaStrips, block);

    const strips = new Map<string, Strip>();
    for (const [streetId, polygon] of betaStrips) {
        strips.set(streetId, {
            polygon: polygon,
            block: block
        });
    }

    return strips;
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
    const offsetDistance = lengthToDegrees(block.maxLotDepth, 'meters');
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
                
                // simplify(feature(lot), { tolerance: 0.00001, highQuality: true });
                const simplifiedLot = feature(lot);
                
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
                    const prospectiveStreetLine: Feature<LineString> = lineString([streetStart, streetEnd]);
                    if (isSegmentAdjacentToStreetEdge(faceStart, faceEnd, prospectiveStreetLine)) {
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
    streetLine: Feature<LineString>,
): boolean {
    const tolerance = 0.0001; // Tolerance for coordinate proximity
    
    // Check if the face segment endpoints are on or very close to the street edge
    const startDistanceToStreet = pointToLineDistance(faceStart, streetLine, { units: 'degrees' });
    const endDistanceToStreet = pointToLineDistance(faceEnd, streetLine, { units: 'degrees' });
    
    // If both endpoints of the face segment are close to the street edge, 
    // then the face segment is adjacent to the street
    return (startDistanceToStreet < tolerance && endDistanceToStreet < tolerance);
}

function mergeAlphaStripGeometry(faces: Polygon[], streetId: string): Polygon {
    if (faces.length < 2) {
        return faces[0];
    }

    const featuresToUnion = featureCollection(faces.map(f => feature(f)));
    const unionResult = union(featuresToUnion);

    if (!unionResult) {
        console.warn(`Union failed for street ${streetId} or resulted in invalid geometry.`);
        return faces[0];
    }

    if (!unionResult.geometry || unionResult.geometry.type !== 'Polygon') {
        console.warn(`Union result for street ${streetId} is not a polygon:`, JSON.stringify(unionResult, null, 2));
        return faces[0];
    }
    
    const mergedPolygon = unionResult.geometry as Polygon;
    return mergedPolygon;
}

type AdjacentPair = {
    streetId1: string;
    streetId2: string;
    sharedEdge: LineString;
    face1: Polygon;
    face2: Polygon;
}

type TransferRegion = {
    region: Polygon;
    fromStreetId: string;
    toStreetId: string;
};

function calculateBetaStripsFromAlphaStrips(alphaStrips: Map<string, Polygon[]>, block: Block): Map<string, Polygon> {    
    // Merge the alpha strips into beta strips
    const betaStrips = new Map<string, Polygon>();
    for (const [streetId, faces] of alphaStrips) {
        betaStrips.set(streetId, mergeAlphaStripGeometry(faces, streetId));
    }

    // Find adjacent alpha strips
    const adjacentPairs: Array<AdjacentPair> = [];
    const streetIds = Array.from(alphaStrips.keys());
    
    for (let i = 0; i < streetIds.length; i++) {
        for (let j = i + 1; j < streetIds.length; j++) {
            if (streetIds[i] === streetIds[j]) continue;

            const polygon1 = betaStrips.get(streetIds[i]);
            const polygon2 = betaStrips.get(streetIds[j]);

            if (!polygon1 || !polygon2) {
                console.warn(`Polygon not found for street IDs: ${streetIds[i]}, ${streetIds[j]}`);
                continue;
            }

            const sharedEdge = findSharedEdgesBetweenStrips(polygon1, polygon2, block);

            if (sharedEdge) {
                adjacentPairs.push({
                    streetId1: streetIds[i],
                    streetId2: streetIds[j],
                    sharedEdge,
                    face1: polygon1,
                    face2: polygon2
                });
            }
        }
    }

    const regions: Array<TransferRegion> = [];

    // For each adjacent pair of beta strips, calculate the corner regions
    for (const pair of adjacentPairs) {
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

        const region = calculateNearTriangularRegionToCut(
            swapFrom,
            pair.sharedEdge, 
            block
        );

        if (!region) {
            console.warn(`Failed to calculate triangular region for alpha strip pair: ${pair.streetId1} - ${pair.streetId2}`);
            continue;
        }

        regions.push({
            region,
            fromStreetId: length1 < length2 ? pair.streetId1 : pair.streetId2,
            toStreetId: length1 < length2 ? pair.streetId2 : pair.streetId1
        });
    }

    moveTransferRegionsForBetaStrips(betaStrips, regions);

    return betaStrips;
}

/**
 * Return the LineString containing the edge or edges that are shared between two beta strip polygons.
 * The line string is sorted so that the point on the block boundary comes first and the interior point is last.
 * @param strip1 
 * @param strip2 
 * @param block 
 */
function findSharedEdgesBetweenStrips(strip1: Polygon, strip2: Polygon, block: Block): LineString | null {
    const coords1 = strip1.coordinates[0];
    const coords2 = strip2.coordinates[0];
    const sharedEdgePoints: number[][] = [];
    
    // Find all shared edges between the two polygons
    for (let i = 0; i < coords1.length - 1; i++) {
        const edge1Start = coords1[i];
        const edge1End = coords1[i + 1];
        
        for (let j = 0; j < coords2.length - 1; j++) {
            const edge2Start = coords2[j];
            const edge2End = coords2[j + 1];
            
            // Check if edges are the same using existing helper
            if (edgesAreEqual(edge1Start, edge1End, edge2Start, edge2End)) {
                // Add points to shared edge collection if not already present
                if (!sharedEdgePoints.some(p => 
                    p[0] === edge1Start[0] && p[1] === edge1Start[1])) {
                    sharedEdgePoints.push(edge1Start);
                }
                if (!sharedEdgePoints.some(p => 
                    p[0] === edge1End[0] && p[1] === edge1End[1])) {
                    sharedEdgePoints.push(edge1End);
                }
            }
        }
    }
    
    // If no shared edges found, return null
    if (sharedEdgePoints.length < 2) {
        return null;
    }
    
    // Use block geometry to determine correct sort order
    const blockBoundary = block.polygon.geometry.coordinates[0];

    const getMinDistanceToBlockBoundary = (point: number[]) => {
        let minDist = Infinity;
        for (const boundaryPoint of blockBoundary) {
            const dist = (point[0] - boundaryPoint[0]) ** 2 + (point[1] - boundaryPoint[1]) ** 2;
            if (dist < minDist) {
                minDist = dist;
            }
        }
        return minDist;
    };
    
    // Sort points: boundary points first, then by increasing distance from boundary
    const sortedPoints = sharedEdgePoints.sort((a, b) => {
        const aDist = getMinDistanceToBlockBoundary(a);
        const bDist = getMinDistanceToBlockBoundary(b);
        
        return aDist - bDist;
    });
    
    return {
        type: 'LineString',
        coordinates: sortedPoints
    };
}

function edgesAreEqual(e1Start: number[], e1End: number[], e2Start: number[], e2End: number[]): boolean {
    return (
        (e1Start[0] === e2Start[0] && e1Start[1] === e2Start[1] && e1End[0] === e2End[0] && e1End[1] === e2End[1]) ||
        (e1Start[0] === e2End[0] && e1Start[1] === e2End[1] && e1End[0] === e2Start[0] && e1End[1] === e2Start[1])
    );
}

function calculateNearTriangularRegionToCut(swapFrom: Polygon, sharedEdge: LineString, block: Block): Polygon | null {    
    const exteriorPoint = sharedEdge.coordinates[0];
    const interiorPoint = sharedEdge.coordinates[sharedEdge.coordinates.length - 1];
    const slicingLine = calculateSlicingLineToClosestExteriorEdge(interiorPoint, swapFrom, block.polygon.geometry);

    if (!slicingLine) {
        console.warn('Failed to calculate slicing line');
        return null;
    }

    const sliceResult = polygonSlice(swapFrom, slicingLine);

    if (!sliceResult || sliceResult.features.length === 0) {
        console.warn('Polygon slice operation failed or returned no features');
        return null;
    }

    // Find which resulting polygon contains the exterior point
    const exteriorPointFeature = point(exteriorPoint);
    
    for (const polygonFeature of sliceResult.features) {
        if (polygonFeature.geometry.type === 'Polygon') {
            // Check if this polygon contains the exterior point
            if (booleanPointInPolygon(exteriorPointFeature, polygonFeature)) {
                return polygonFeature.geometry as Polygon;
            }
        }
    }
    
    return null;
}

function calculateSlicingLineToClosestExteriorEdge(
    sourcePoint: number[], 
    polygon: Polygon,
    outsideShape: Polygon
): LineString | null {
    const polygonBoundary = polygon.coordinates[0];
    const outsideShapeBoundary = outsideShape.coordinates[0];
    
    // Find all shared edges between the polygon and outside shape
    const sharedEdges: LineString[] = [];
    const tolerance = 0.00001;
    
    for (let i = 0; i < polygonBoundary.length - 1; i++) {
        const polyStart = polygonBoundary[i];
        const polyEnd = polygonBoundary[i + 1];
        
        for (let j = 0; j < outsideShapeBoundary.length - 1; j++) {
            const outsideStart = outsideShapeBoundary[j];
            const outsideEnd = outsideShapeBoundary[j + 1];
            
            // Check if edges are the same or overlapping
            if (edgesAreEqual(polyStart, polyEnd, outsideStart, outsideEnd)) {
                sharedEdges.push({
                    type: 'LineString',
                    coordinates: [polyStart, polyEnd]
                });
                break;
            }
        }
    }
    
    if (sharedEdges.length === 0) {
        console.warn('No shared edges found between polygon and outside shape');
        return null;
    }
    
    // Find the closest point on any shared edge to the source point
    let closestPoint: number[] | null = null;
    let minDistance = Infinity;
    
    for (const sharedEdge of sharedEdges) {
        const nearestPoint = nearestPointOnLine(sharedEdge, sourcePoint);
        
        if (nearestPoint && nearestPoint.geometry.coordinates) {
            const edgePoint = nearestPoint.geometry.coordinates;
            
            // Skip if it's the same as source point
            if (Math.abs(edgePoint[0] - sourcePoint[0]) < tolerance && 
                Math.abs(edgePoint[1] - sourcePoint[1]) < tolerance) {
                continue;
            }
            
            const distance = Math.sqrt(
                (edgePoint[0] - sourcePoint[0]) ** 2 + 
                (edgePoint[1] - sourcePoint[1]) ** 2
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = edgePoint;
            }
        }
    }
    
    if (!closestPoint) {
        console.warn('No valid closest point found on shared edges');
        return null;
    }

    // Extend the line slightly beyond the closest point to ensure it's outside the polygon
    const direction = [
        closestPoint[0] - sourcePoint[0],
        closestPoint[1] - sourcePoint[1]
    ];
    
    // Normalize the direction vector
    const directionLength = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1]);
    if (directionLength === 0) {
        console.warn('Source point and closest point are the same');
        return null;
    }
    
    const normalizedDirection = [
        direction[0] / directionLength,
        direction[1] / directionLength
    ];
    
    // Extend beyond the closest point by a small amount
    const extensionDistance = tolerance * 10; // Make it larger than tolerance to be safe
    const extendedPoint = [
        closestPoint[0] + normalizedDirection[0] * extensionDistance,
        closestPoint[1] + normalizedDirection[1] * extensionDistance
    ];
    
    // Create the slicing line from source point to closest point on shared edge
    return {
        type: 'LineString',
        coordinates: [sourcePoint, extendedPoint]
    };
}

/**
 * Move the calculated corner transfer regions between beta strips.
 * @param betaStrips Beta strips to modify
 * @param regions Regions to transfer between strips
 */
function moveTransferRegionsForBetaStrips(betaStrips: Map<string, Polygon>, regions: Array<TransferRegion>): void {
    for (const regionTransfer of regions) {
        const { region, fromStreetId, toStreetId } = regionTransfer;
        
        // Get the current state of the strips (important for multiple transfers)
        let fromStrip = betaStrips.get(fromStreetId);
        let toStrip = betaStrips.get(toStreetId);
        
        if (!fromStrip || !toStrip) {
            console.warn(`Strip not found for transfer: from ${fromStreetId} to ${toStreetId}`);
            continue;
        }

        try {
            // Remove the region from the source polygon using difference
            const fromPolygon = betaStrips.get(fromStreetId);
            if (!fromPolygon) {
                console.warn(`From polygon not found for street ID ${fromStreetId}`);
                continue;
            }

            const fromFeature = feature(fromPolygon);
            const regionFeature = feature(region);
            
            const differenceResult = difference(featureCollection([fromFeature, regionFeature]));
            
            if (differenceResult && differenceResult.geometry && differenceResult.geometry.type === 'Polygon') {
                fromStrip = differenceResult.geometry as Polygon;
            }
            else {
                console.warn(`Difference operation failed or resulted in non-polygon geometry for ${fromStreetId}`);
                continue;
            }
            
            const unionResult = union(featureCollection([feature(toStrip), regionFeature]));
            
            if (unionResult && unionResult.geometry && unionResult.geometry.type === 'Polygon') {
                toStrip = unionResult.geometry as Polygon;
            }
            else {
                console.warn(`Union operation failed or resulted in non-polygon geometry for ${toStreetId}`);
                continue;
            }

            // Update the betaStrips map with the modified polygons
            betaStrips.set(fromStreetId, fromStrip);
            betaStrips.set(toStreetId, toStrip);
        }
        catch (error) {
            console.warn(`Error during region transfer from ${fromStreetId} to ${toStreetId}:`, error);
        }
    }
}