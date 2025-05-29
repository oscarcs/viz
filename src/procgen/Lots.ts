import { area } from "@turf/turf";
import { Polygon } from "geojson";
import { StraightSkeletonBuilder } from "straight-skeleton-geojson";
import { multipolygonDifference } from "../ds/util";
import { Color } from "deck.gl";

export type Lot = {
    geometry: Polygon;
    color: Color;
    id: string;
};

export function generateLotsFromBlock(polygon: Polygon): Lot[] {
    // Step 1: Calculate the offset straight skeleton of the block
    // Create a multipolygon from the polygon to match the example in app.tsx
    const multiPoly = {
        type: 'MultiPolygon',
        coordinates: [polygon.coordinates]
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

    return faces.map((geometry, index) => ({
        geometry,
        color: [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255] as Color,
        id: `lot-${index}`
    }));
}