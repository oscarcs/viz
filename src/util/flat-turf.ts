import {
    Coord,
    pointToLineDistance as pointToLineDistance_turf,
} from "@turf/turf";
import { Feature, GeoJsonProperties, LineString, Position } from "geojson";

export const pointToLineDistance = (point: Coord, line: LineString | Feature<LineString, GeoJsonProperties>) =>
    pointToLineDistance_turf(point, line, { units: 'degrees', method: 'planar' });

export const distance = (from: Coord, to: Coord) => {
    const getCoordinates = (coord: Coord): Position => {
        if (Array.isArray(coord)) {
            // It's a Position
            return coord;
        }
        else if (coord.type === 'Point') {
            // It's a Point
            return coord.coordinates;
        }
        else if (coord.type === 'Feature' && coord.geometry.type === 'Point') {
            // It's a Feature<Point>
            return coord.geometry.coordinates;
        }
        throw new Error('Invalid coordinate type');
    };

    const fromCoords = getCoordinates(from);
    const toCoords = getCoordinates(to);
    
    const dx = toCoords[0] - fromCoords[0];
    const dy = toCoords[1] - fromCoords[1];

    return Math.sqrt(dx * dx + dy * dy);
}