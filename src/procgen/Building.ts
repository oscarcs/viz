import { feature, bbox, lineString, along, featureCollection, point, voronoi, intersect, length, area } from "@turf/turf";
import { Polygon, Position } from "geojson";

export type Building = {
    polygon: Polygon;
    height: number;
}

export function generateLotsFromBlock(polygon: Polygon): Polygon[] {
    return [];
}

export function generateFloorplanFromLot(polygon: Polygon): Polygon | null {
    return polygon;
}

export function generateBuildingFromFloorplan(polygon: Polygon, minHeight: number, maxHeight: number): Building | null {
    if (area(polygon) < 100) {
        return null;
    }
    
    const height = Math.floor(Math.random() * (maxHeight - minHeight) + minHeight);
    return {
        polygon,
        height
    };
}