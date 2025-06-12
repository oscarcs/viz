import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter";
import geoAzimuthalEquidistant from "d3-geo/src/projection/azimuthalEquidistant";
import {
    feature,
    featureCollection,
    radiansToLength,
    lengthToRadians,
    earthRadius,
    geomEach,
    featureEach,
    center,
    Units,
} from "@turf/turf";
import {
    Feature,
    FeatureCollection,
    Geometry,
    GeometryCollection,
    Polygon,
    MultiPolygon,
    Position
} from "geojson";

interface BufferOptions {
    units?: Units;
    steps?: number;
    endCapStyle?: "flat" | "round" | "square";
}

/**
 * Calculates a buffer for input features for a given radius.
 *
 * When using a negative radius, the resulting geometry may be invalid if
 * it's too small compared to the radius magnitude. If the input is a
 * FeatureCollection, only valid members will be returned in the output
 * FeatureCollection - i.e., the output collection may have fewer members than
 * the input, or even be empty.
 *
 * @function
 * @param {FeatureCollection|Geometry|Feature<any>} geojson input to be buffered
 * @param {number} radius distance to draw the buffer (negative values are allowed)
 * @param {Object} [options={}] Optional parameters
 * @param {Units} [options.units="kilometers"] Supports all valid Turf {@link https://turfjs.org/docs/api/types/Units Units}.
 * @param {number} [options.steps=8] number of steps
 * @returns {FeatureCollection|Feature<Polygon|MultiPolygon>|undefined} buffered features
 * @example
 * var point = turf.point([-90.548630, 14.616599]);
 * var buffered = turf.buffer(point, 500, {units: 'miles'});
 *
 * //addToMap
 * var addToMap = [point, buffered]
 */
export function customBuffer(
    geojson: FeatureCollection | Geometry | Feature,
    radius: number,
    options: BufferOptions = {}
): FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon> | undefined {
    // use user supplied options or default values
    const units: Units = options.units || "kilometers";
    const steps: number = options.steps || 8;
    const endCapStyle: string = options.endCapStyle || "round";

    // validation
    if (!geojson) throw new Error("geojson is required");
    if (typeof options !== "object") throw new Error("options must be an object");
    if (typeof steps !== "number") throw new Error("steps must be an number");

    // Allow negative buffers ("erosion") or zero-sized buffers ("repair geometry")
    if (radius === undefined) throw new Error("radius is required");
    if (steps <= 0) throw new Error("steps must be greater than 0");

    const results: any[] = [];
    switch (geojson.type) {
        case "GeometryCollection":
            geomEach(geojson, function (geometry: Geometry) {
                const buffered = bufferFeature(geometry, radius, units, steps, endCapStyle);
                if (buffered) results.push(buffered);
            });
            return featureCollection(results);
        case "FeatureCollection":
            featureEach(geojson, function (feature: Feature) {
                const multiBuffered = bufferFeature(feature, radius, units, steps, endCapStyle);
                if (multiBuffered) {
                    featureEach(multiBuffered, function (buffered: Feature<Polygon | MultiPolygon>) {
                        if (buffered) results.push(buffered);
                    });
                }
            });
            return featureCollection(results);
    }
    return bufferFeature(geojson, radius, units, steps, endCapStyle);
}

/**
 * Buffer single Feature/Geometry
 *
 * @private
 * @param {Feature<any>} geojson input to be buffered
 * @param {number} radius distance to draw the buffer
 * @param {Units} [units='kilometers'] Supports all valid Turf {@link https://turfjs.org/docs/api/types/Units Units}.
 * @param {number} [steps=8] number of steps
 * @returns {Feature<Polygon|MultiPolygon>} buffered feature
 */
function bufferFeature(
    geojson: Feature | Geometry,
    radius: number,
    units: Units,
    steps: number,
    endCapStyle: string = "round"
): Feature<Polygon | MultiPolygon> | FeatureCollection<Polygon | MultiPolygon> | undefined {
    const properties = (geojson as Feature).properties || {};
    const geometry: Geometry = geojson.type === "Feature" ? (geojson as Feature).geometry : geojson as Geometry;

    // Geometry Types faster than jsts
    if (geometry.type === "GeometryCollection") {
        const results: Feature<Polygon | MultiPolygon>[] = [];
        geomEach(geojson as GeometryCollection, function (geometry: Geometry) {
            const buffered = bufferFeature(geometry, radius, units, steps);
            if (buffered) results.push(buffered as Feature<Polygon | MultiPolygon>);
        });
        return featureCollection(results);
    }

    // Project GeoJSON to Azimuthal Equidistant projection (convert to Meters)
    const projection: any = defineProjection(geometry);
    const projected = {
        type: geometry.type,
        coordinates: projectCoords(geometry.coordinates, projection),
    };

    // JSTS buffer operation
    const reader = new GeoJSONReader();
    const geom = reader.read(projected);
    const distance: number = radiansToLength(lengthToRadians(radius, units), "meters");

    let endCapNum = 1;
    switch (endCapStyle) {
        case "round":
            endCapNum = 1;
            break;
        case "flat":
            endCapNum = 2;
            break;
        case "square":
            endCapNum = 3;
            break;
        default:
            throw new Error("endCapStyle must be 'flat', 'round' or 'square'");
    }

    let buffered = BufferOp.bufferOp(geom, distance, steps, endCapNum);
    
    const writer = new GeoJSONWriter();
    let bufferedGeoJson: Polygon = writer.write(buffered) as Polygon;

    // Detect if empty geometries
    if (coordsIsNaN(bufferedGeoJson.coordinates)) return undefined;

    // Unproject coordinates (convert to Degrees)
    const result = {
        type: bufferedGeoJson.type,
        coordinates: unprojectCoords(bufferedGeoJson.coordinates, projection),
    };

    return feature(result as Polygon | MultiPolygon, properties);
}

/**
 * Coordinates isNaN
 *
 * @private
 * @param {Array<any>} coords GeoJSON Coordinates
 * @returns {boolean} if NaN exists
 */
function coordsIsNaN(coords: any[]): boolean {
    if (Array.isArray(coords[0])) return coordsIsNaN(coords[0]);
    return isNaN(coords[0]);
}

/**
 * Project coordinates to projection
 *
 * @private
 * @param {Array<any>} coords to project
 * @param {GeoProjection} proj D3 Geo Projection
 * @returns {Array<any>} projected coordinates
 */
function projectCoords(coords: any, proj: any): any {
    if (typeof coords[0] !== "object") return proj(coords);
    return coords.map(function (coord: any) {
        return projectCoords(coord, proj);
    });
}

/**
 * Un-Project coordinates to projection
 *
 * @private
 * @param {Array<any>} coords to un-project
 * @param {GeoProjection} proj D3 Geo Projection
 * @returns {Array<any>} un-projected coordinates
 */
function unprojectCoords(coords: any, proj: any): any {
    if (typeof coords[0] !== "object") return proj.invert(coords);
    return coords.map(function (coord: any) {
        return unprojectCoords(coord, proj);
    });
}

/**
 * Define Azimuthal Equidistant projection
 *
 * @private
 * @param {Geometry|Feature<any>} geojson Base projection on center of GeoJSON
 * @returns {GeoProjection} D3 Geo Azimuthal Equidistant Projection
 */
function defineProjection(geojson: Geometry | Feature): any {
    const coords: Position = center(geojson).geometry.coordinates;
    const rotation: [number, number] = [-coords[0], -coords[1]];
    return geoAzimuthalEquidistant().rotate(rotation).scale(earthRadius);
}
