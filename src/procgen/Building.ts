import { feature, bbox, lineString, along, featureCollection, point, voronoi, intersect, length, area } from "@turf/turf";
import { Polygon, Position } from "geojson";

export type Building = {
    polygon: Polygon;
    height: number;
}

// helper: normal random via Box–Muller
function normalRandom(mean: number, stdDev: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdDev + mean;
}

/**
 * Generate building lots inside a given polygon (usually a street block).
 * Based on the lot generation technique from 'Interactive Example-Based Urban Layout Synthesis' (Aliaga et al. 2008).
 * https://www.cs.purdue.edu/cgvlab/papers/aliaga/urban-sigasia-2008.pdf 
 * @param polygon 
 * @param minSize 
 * @param maxSize 
 * @returns 
 */
export function generateLotsFromBlock(polygon: Polygon): Polygon[] {
    // 1) get bbox
    const [minX, minY, maxX, maxY] = bbox(polygon);

    // 2) main (longest) axis
    const width = maxX - minX;
    const height = maxY - minY;
    const isHorizontal = width > height;
    const start: Position = isHorizontal
        ? [minX, (minY + maxY) / 2]
        : [(minX + maxX) / 2, minY];
    const end: Position = isHorizontal
        ? [maxX, (minY + maxY) / 2]
        : [(minX + maxX) / 2, maxY];
    const axis = lineString([start, end]);

    // 3) stochastic samples along axis
    const axisLen = length(axis, { units: "meters" });
    const avgSize = 30;
    const stdDevSize = 10;
    const stdDevDist = Math.sqrt(stdDevSize);

    const samples: Position[] = [];
    let sumDist = 0;
    while (true) {
        const d = Math.max(0, normalRandom(avgSize, stdDevDist));
        if (sumDist + d > axisLen) break;
        sumDist += d;
        
        samples.push(
            along(axis, sumDist, { units: "meters" }).geometry.coordinates as Position
        );
    }

    // 4) mirror each sample to both sides
    const offsetDist = (isHorizontal ? height : width) * 0.45;
    const seeds: Position[] = [];
    samples.forEach(([x, y]) => {
        if (isHorizontal) {
            seeds.push([x, y + offsetDist], [x, y - offsetDist]);
        }
        else {
            seeds.push([x + offsetDist, y], [x - offsetDist, y]);
        }
    });

    // 5) voronoi + clip + area filter
    const ptsFC = featureCollection(seeds.map((c) => point(c)));
    const vor = voronoi(ptsFC, { bbox: [minX, minY, maxX, maxY] });
    const cells: Polygon[] = [];

    vor.features.forEach((cell) => {
        const intersection = intersect(featureCollection([feature(polygon), cell]));
        if (intersection) {
            cells.push(intersection.geometry as Polygon);
        }
    });

    return cells;
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