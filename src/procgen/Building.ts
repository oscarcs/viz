import { Polygon } from "geojson";
import { Lot } from "./Lots";

export type Building = {
    polygon: Polygon;
    height: number;
}

export type FloorPlan = {
    geometry: Polygon;
};

export function generateFloorplanFromLot(lot: Lot): FloorPlan {
    return {
        geometry: lot.geometry
    };
}

export function generateBuildingFromFloorplan(floorPlan: FloorPlan, minHeight: number, maxHeight: number): Building | null {
    return {
        polygon: floorPlan.geometry,
        height: Math.random() * (maxHeight - minHeight) + minHeight
    };
}