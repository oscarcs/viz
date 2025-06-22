import { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import { 
    area, 
    lineString, 
    union, 
    featureCollection, 
    feature,
    booleanPointInPolygon,
    point,
    pointToLineDistance,
    lengthToDegrees,
    nearestPointOnLine,
    distance,
    lineOverlap
} from '@turf/turf';
import polygonSlice from '../util/polygonSlice';
import { LogicalStreet } from '../ds/LogicalStreet';
import { StraightSkeletonBuilder } from "straight-skeleton-geojson";
import { multipolygonDifference } from "../util/util";

export type Block = {
    polygon: Feature<Polygon>;
    boundingStreets: LogicalStreet[];
    /**
     * Maximum depth of the lot from the street edge in meters.
     */
    maxLotDepth: number;
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

    if (faces.length === 1) {
        // Special case: this is not a perimeter block; we handle it differently
        
        //TODO: actually make this work
        const singleStrip: Strip = {
            polygon: faces[0],
            block: block
        };
        return new Map([[block.boundingStreets[0].id, singleStrip]]);
    }
    else if (faces.length > 1) {
        // Step 2: Calculate the alpha-strips for the skeleton faces
        const alphaStrips = calculateAlphaStripsFromFaces(faces, block);

        // Step 3: Create the beta strips by swapping corner regions between adjacent alpha strips
        const betaStrips = calculateBetaStripsFromAlphaStrips(alphaStrips, block);
    
        const strips = new Map<string, Strip>();
        for (const [streetId, polygon] of betaStrips) {
            if (area(polygon) > 400) {
                strips.set(streetId, {
                    polygon: polygon,
                    block: block
                });
            }
        }
    
        return strips;
    }

    return new Map<string, Strip>();
}

function calculateFacesFromBlock(block: Block): Polygon[] {
    if (!block.polygon || !block.polygon.geometry || block.polygon.geometry.type !== 'Polygon') {
        return [];
    }

    // TODO: fix the input type handling
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

    const faces: Polygon[] = [];
    
    if (lotContour && lotContour.coordinates) {
        for (const coords of lotContour.coordinates) {
            // Each coordinate set should form a polygon
            if (coords && coords.length > 0) {
                const lot: Polygon = {
                    type: 'Polygon',
                    coordinates: coords
                };
                
                const lotFeature = feature(lot);
                
                // Only add lots with sufficient area
                if (lotFeature.geometry && area(lotFeature.geometry) > 0.0001) {
                    faces.push(lotFeature.geometry as Polygon);
                }
            }
        }
    }

    return faces;
}

function calculateAlphaStripsFromFaces(faces: Polygon[], block: Block): Map<string, Polygon[]> {
    // Alpha-strips are lists of faces that are adjacent to each logical street
    const alphaStrips = new Map<string, Polygon[]>();
    
    // Initialize alpha-strips for each bounding street
    for (const street of block.boundingStreets) {
        alphaStrips.set(street.id, []);
    }
    
    for (const face of faces) {
        const faceCoords = face.coordinates[0];
        const blockCoords = block.polygon.geometry.coordinates[0];

        // Each face will have an exterior segment that is adjacent to the block boundary
        let exteriorSegment: LineString | null = null;

        for (let i = 0; i < blockCoords.length - 1; i++) {
            const blockStart = blockCoords[i];
            const blockEnd = blockCoords[i + 1];
            
            // Check if the face boundary segment is adjacent to the block boundary segment
            for (let j = 0; j < faceCoords.length - 1; j++) {
                const faceStart = faceCoords[j];
                const faceEnd = faceCoords[j + 1];
                
                // Check if this face edge segment is close to and aligned with the block edge
                const prospectiveBlockLine: Feature<LineString> = lineString([blockStart, blockEnd]);
                if (isSegmentAdjacentToLineString(faceStart, faceEnd, prospectiveBlockLine)) {
                    exteriorSegment = prospectiveBlockLine.geometry;
                    break;
                }
            }
            
            if (exteriorSegment) break;
        }

        if (!exteriorSegment) {
            console.warn(`No exterior segment found for face in block`);
            continue;
        }
        
        let isAdjacent = false;
        for (const street of block.boundingStreets) {
            // TODO: Dial this in based on the potential street-to-boundary geometry.
            const adjacencyTolerance = street.width * 2;
            
            // Check if any boundary segment of the face lies along this street
            for (const edge of street.edges) {
                const streetStart = edge.from.coordinates;
                const streetEnd = edge.to.coordinates;
                
                // Check if the exterior segment of the face is parallel to a street edge
                if (isSegmentAdjacentToLineString(streetStart, streetEnd, feature(exteriorSegment), adjacencyTolerance)) {
                    alphaStrips.get(street.id)?.push(face);
                    isAdjacent = true;
                    break;
                }
            }
            
        }

        if (!isAdjacent) {
            console.warn(`Face not adjacent to any street in block`);
        }
    }

    return alphaStrips;
}

/**
 * Check if an edge segment is adjacent to a given LineString.
 */
function isSegmentAdjacentToLineString(segment1: number[], segment2: number[], line: Feature<LineString>, tolerance: number = 1): boolean {
    const lineCoords = line.geometry.coordinates;
    
    if (lineCoords.length < 2) {
        console.warn('LineString must have at least two coordinates to check adjacency.');
        return false;
    }
    
    const dist1 = pointToLineDistance(segment1, line, { units: 'meters' });
    const dist2 = pointToLineDistance(segment2, line, { units: 'meters' });
    
    return (dist1 < tolerance && dist2 < tolerance);
}

function mergeAlphaStripGeometry(faces: Polygon[], streetId: string): Polygon {
    if (faces.length < 2) {
        return faces[0];
    }

    const featuresToUnion = featureCollection(faces.map(f => feature(f)));
    const unionResult = union(featuresToUnion);

    if (!unionResult) {
        console.warn(`Alpha strip union failed for street ${streetId} or resulted in invalid geometry.`);
        return faces[0];
    }

    if (!unionResult.geometry || unionResult.geometry.type !== 'Polygon') {
        console.warn(`Alpha strip union result for street ${streetId} is not a polygon:`, JSON.stringify(unionResult, null, 2));
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
    slicingLine: LineString;
    exteriorPoint: number[];
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

            const sharedEdges = findSharedEdgesBetweenStrips(polygon1, polygon2, block);
            
            for (const sharedEdge of sharedEdges) {
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

        const exteriorPoint = pair.sharedEdge.coordinates[0];
        const interiorPoint = pair.sharedEdge.coordinates[pair.sharedEdge.coordinates.length - 1];

        const slicingLine = calculateSlicingLineToClosestExteriorEdge(
            interiorPoint,
            exteriorPoint,
            swapFrom,
            block.polygon.geometry
        );

        if (!slicingLine) {
            console.warn(`Failed to cut line for alpha strip pair: ${pair.streetId1} - ${pair.streetId2}`);
            continue;
        }

        regions.push({
            slicingLine,
            exteriorPoint,
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
function findSharedEdgesBetweenStrips(strip1: Polygon, strip2: Polygon, block: Block): LineString[] {
    const blockBoundary = block.polygon.geometry.coordinates[0];

    const overlapping = lineOverlap(strip1, strip2)
        .features
        .map((feature: Feature<LineString>) => feature.geometry);

    const getMinDistanceToBlockBoundary = (point: number[]) => {
        let minDist = Infinity;
        for (const boundaryPoint of blockBoundary) {
            const dist = distance(point, boundaryPoint, { units: 'meters' });

            if (dist < minDist) {
                minDist = dist;
            }
        }
        return minDist;
    };

    const edges = overlapping.filter(edge => {
        const boundaryPoints = edge.coordinates.filter(p =>
            getMinDistanceToBlockBoundary(p) === 0 
        );
        return edge.coordinates.length > 1 && boundaryPoints.length > 0;
    });

    for (const edge of edges) {
        if (getMinDistanceToBlockBoundary(edge.coordinates[0]) !== 0) {
            // Ensure the first point is on the block boundary
            edge.coordinates.reverse();
        }
    }
    
    return edges;
}

function calculateSlicingLineToClosestExteriorEdge(
    sourcePoint: number[],
    exteriorPoint: number[], 
    polygon: Polygon,
    outsideShape: Polygon,
): LineString | null {    
    const tolerance = 0.00001;

    // Find all shared edges between the polygon and outside shape
    const sharedEdges = lineOverlap(polygon, outsideShape)
        .features
        .map((feature: Feature<LineString>) => feature.geometry);
    
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

            // Skip if it's the same as exterior point
            if (Math.abs(edgePoint[0] - exteriorPoint[0]) < tolerance && 
                Math.abs(edgePoint[1] - exteriorPoint[1]) < tolerance) {
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
 * Move the transfer regions between beta strips based on the calculated slicing lines.
 * @param betaStrips Beta strips to modify
 * @param regions Regions to transfer between strips
 */
function moveTransferRegionsForBetaStrips(betaStrips: Map<string, Polygon>, regions: Array<TransferRegion>): void {
    for (const region of regions) {
        const sourceStrip = betaStrips.get(region.fromStreetId);
        const destinationStrip = betaStrips.get(region.toStreetId);
        
        if (!sourceStrip) {
            console.warn(`Source strip not found for ID: ${region.fromStreetId}`);
            continue;
        }

        if (!destinationStrip) {
            console.warn(`Destination strip not found for ID: ${region.toStreetId}`);
            continue;
        }
                
        let sliceResult: FeatureCollection<Polygon> | null = null;
        try {
            sliceResult = polygonSlice(sourceStrip, region.slicingLine);
        }
        catch (error) {
            console.warn(`Error during polygon slice operation for strip ${region.fromStreetId} to ${region.toStreetId}:`, error);
            console.debug(`Slicing line: ${JSON.stringify(region.slicingLine)}`);
            continue;
        }
        
        if (!sliceResult || sliceResult.features.length === 0) {
            console.warn(`Polygon slice operation failed for strip ${region.fromStreetId}`);
            continue;
        }
        
        // Find which resulting polygon contains the exterior point - this is the transfer region
        const exteriorPointFeature = point(region.exteriorPoint);
        let transferRegion: Polygon | null = null;
        let remainingRegion: Polygon | null = null;
        
        for (const polygonFeature of sliceResult.features) {
            if (polygonFeature.geometry.type === 'Polygon') {
                const polygon = polygonFeature.geometry as Polygon;
                
                // Check if this polygon contains the exterior point
                if (booleanPointInPolygon(exteriorPointFeature, polygonFeature)) {
                    transferRegion = polygon;
                }
                else {
                    remainingRegion = polygon;
                }
            }
        }

        if (!transferRegion) {
            console.warn(`No transfer region found for exterior point ${region.exteriorPoint} in strip ${region.fromStreetId}`);
            continue;
        }

        // Update the source strip to the remaining region (after removing the transfer region)
        betaStrips.set(region.fromStreetId, remainingRegion!);
        
        // Union the transfer region with the destination strip
        const transferFeature = feature(transferRegion);
        const destinationFeature = feature(destinationStrip);
        const unionResult = union(featureCollection([transferFeature, destinationFeature]));
        
        if (!unionResult || !unionResult.geometry || unionResult.geometry.type !== 'Polygon') {
            console.warn(`Union operation failed for strips ${region.fromStreetId} -> ${region.toStreetId}`);
            continue;
        }
        
        // Update the destination strip with the unioned result
        betaStrips.set(region.toStreetId, unionResult.geometry as Polygon);
    }

    // Remove any empty strips
    for (const [streetId, strip] of betaStrips.entries()) {
        if (!strip || !strip.coordinates || strip.coordinates.length === 0) {
            betaStrips.delete(streetId);
        }
    }
}