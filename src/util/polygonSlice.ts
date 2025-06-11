import {
    point,
    polygon,
    multiPolygon,
    lineString,
    featureCollection,
    lineIntersect,
    lineOffset,
    lineOverlap,
    lineToPolygon,
    unkinkPolygon,
    difference,
    getGeom,
    booleanPointInPolygon,
    area
} from "@turf/turf";
import type {
    FeatureCollection,
    Polygon,
    LineString,
    Feature,
    MultiPolygon,
    Position
} from "geojson";

/**
 * Slices {@link Polygon} using a {@link Linestring}.
 * @name polygonSlice
 * @param {Feature<Polygon>} poly Polygon to slice
 * @param {Feature<LineString>} splitter LineString used to slice Polygon
 * @returns {FeatureCollection<Polygon>} Sliced Polygons
 */
export default function polygonSlice(polyInput: Feature<Polygon> | Polygon, splitterInput: Feature<LineString> | LineString
): FeatureCollection<Polygon> {
    const polyGeom = getGeom(polyInput);
    const splitterGeom = getGeom(splitterInput);

    const line = trimStartEndPoints(polyGeom, splitterGeom);
    if (line == null) return featureCollection([polygon(polyGeom.coordinates)]);

    const newPolygonGeometries: (Polygon | MultiPolygon)[] = [];

    const upperCut = cutPolygon(polyGeom, line, 1, "upper");
    const lowerCut = cutPolygon(polyGeom, line, -1, "lower");
    
    if (upperCut && lowerCut) {
        newPolygonGeometries.push(upperCut.geometry);
        newPolygonGeometries.push(lowerCut.geometry);
    }
    else {
        newPolygonGeometries.push(polyGeom);
    }

    const generatedPolygons: Polygon[] = [];
    newPolygonGeometries.forEach(geom => {
        if (geom.type === "Polygon") {
            generatedPolygons.push(geom);
        }
        else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach((polygonCoords: Position[][]) => {
                // Creates a new polygon from the first ring (exterior ring) of each polygon in the MultiPolygon
                generatedPolygons.push(polygon([polygonCoords[0]]).geometry);
            });
        }
    });

    return featureCollection(generatedPolygons.map(p => polygon(p.coordinates)));
}

/**
 * Cuts a polygon using a line and a direction.
 * @param {Polygon} poly The polygon to cut.
 * @param {LineString} line The line to use for cutting.
 * @param {number} direction The direction of the cut (1 for upper, -1 for lower).
 * @param {string} id An identifier for the resulting polygon(s).
 * @returns {Feature<Polygon | MultiPolygon> | null} The cut polygon or multipolygon, or null if the cut fails.
 */
function cutPolygon(poly: Polygon, line: LineString, direction: number, id: string): Feature<Polygon | MultiPolygon> | null {
    const cutPolyGeoms: Position[][][] = [];
    let retVal: Feature<Polygon | MultiPolygon> | null = null;

    if (poly.type !== "Polygon" || line.type !== "LineString") return retVal;

    const intersectPoints = lineIntersect(poly, line);
    const nPoints = intersectPoints.features.length;
    
    // Handle edge cases: if we have an odd number of intersections,
    // it likely means the line starts/ends on a vertex or edge
    if (nPoints === 0) return retVal;
    
    // For odd number of intersections, we can still attempt to slice
    // by checking if the line properly crosses the polygon
    if (nPoints % 2 !== 0) {
        // Check if line endpoints are on polygon boundary
        const startPoint = point(line.coordinates[0]);
        const endPoint = point(line.coordinates[line.coordinates.length - 1]);
        const startOnBoundary = booleanPointInPolygon(startPoint, poly, {ignoreBoundary: false}) && 
                               !booleanPointInPolygon(startPoint, poly, {ignoreBoundary: true});
        const endOnBoundary = booleanPointInPolygon(endPoint, poly, {ignoreBoundary: false}) && 
                             !booleanPointInPolygon(endPoint, poly, {ignoreBoundary: true});
        
        // If one endpoint is on boundary and we have odd intersections, 
        // we might still be able to slice
        if (!(startOnBoundary || endOnBoundary)) {
            return retVal;
        }
    }

    const thickLinePolygon = prepareDiffLinePolygon(line, direction);

    // Perform difference operation to cut the polygon
    const polyFeature = polygon(poly.coordinates);
    
    // Perform difference using a FeatureCollection of [subject, clip]
    const clippedResult: Feature<Polygon | MultiPolygon> | undefined =
        difference(featureCollection([polyFeature, thickLinePolygon])) as Feature<Polygon | MultiPolygon> | undefined;
    
    if (!clippedResult) return retVal;

    if (clippedResult.geometry.type === "MultiPolygon") {
        for (let j = 0; j < clippedResult.geometry.coordinates.length; j++) {
            const polyg = polygon(clippedResult.geometry.coordinates[j]);

            if (area(polyg) === 0) continue;

            const overlap = lineOverlap(polyg, line, { tolerance: 0.00005 });

            if (overlap.features.length > 0) {
                cutPolyGeoms.push(polyg.geometry.coordinates);
            }
        }
    }
    else {
        const polyg = polygon(clippedResult.geometry.coordinates);
        
        if (area(polyg) !== 0) {
            const overlap = lineOverlap(polyg, line, { tolerance: 0.00005 });
            if (overlap.features.length > 0) {
                cutPolyGeoms.push(polyg.geometry.coordinates);
            }
        };
    }

    if (cutPolyGeoms.length === 1) {
        retVal = polygon(cutPolyGeoms[0], { id });
    }
    else if (cutPolyGeoms.length > 1) {
        retVal = multiPolygon(cutPolyGeoms, { id });
    }

    return retVal;
}

/**
 * Prepares a thick polygon from a line string for use in a difference operation.
 * This polygon is created by offsetting the line in a given direction and then forming a polygon
 * from the original line and the offset line. It attempts to resolve self-intersections.
 * @param {LineString} line The line to thicken.
 * @param {number} direction The direction to offset the line (positive or negative).
 * @returns {Feature<Polygon>} A polygon feature representing the thickened line.
 */
function prepareDiffLinePolygon(line: LineString, direction: number): Feature<Polygon> {
    const offsetScales = [0.01, 0.001, 0.0001];
    let thickLinePolygon!: Feature<Polygon>;

    for (let j = 0; j < offsetScales.length; j++) {
        const offsetLine = lineOffset(line, offsetScales[j] * direction, { units: "kilometers" });
        
        // Simplified construction of polyCoords
        const polyCoords: Position[] = [
            ...line.coordinates,
            ...offsetLine.geometry.coordinates.slice().reverse(),
            line.coordinates[0]
        ];
        
        const thickLineString = lineString(polyCoords);
        thickLinePolygon = lineToPolygon(thickLineString) as Feature<Polygon>;

        // Handle both Polygon and MultiPolygon cases for unkinkPolygon
        const result = unkinkPolygon(thickLinePolygon); 

        const selfIntersectPolygons = result.features.length;

        if (selfIntersectPolygons === 1) {
            return thickLinePolygon;
        }
    }
    
    // Fallback: return last generated polygon
    return thickLinePolygon;
}

/**
 * Trims the start and end points of a line string that are inside a given polygon.
 * @param {Polygon} poly The polygon to check against.
 * @param {LineString} line The line string to trim.
 * @returns {LineString | null} The trimmed line string, or null if the line has less than 2 points after trimming.
 */
function trimStartEndPoints(poly: Polygon, line: LineString): LineString | null {
    let startAt = 0;
    let endAt = line.coordinates.length;

    for (let j = 0; j < line.coordinates.length; j++) {
        if (booleanPointInPolygon(point(line.coordinates[j]), poly, {ignoreBoundary: true})) {
            startAt++;
        }
        else {
            break;
        }
    }

    for (let j = line.coordinates.length - 1; j >= 0; j--) {
        if (booleanPointInPolygon(point(line.coordinates[j]), poly, {ignoreBoundary: true})) {
            endAt--;
        }
        else {
            break;
        }
    }

    const newCoordinates = line.coordinates.slice(startAt, endAt);

    if (newCoordinates.length > 1) {
        return lineString(newCoordinates).geometry;
    }
    else {
        return null;
    }
}
