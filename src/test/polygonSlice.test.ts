import { expect, test } from 'vitest';
import polygonSlice from '../util/polygonSlice';
import type { Polygon, LineString } from 'geojson';

const square: Polygon = {
    type: 'Polygon',
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
};

test('Slicing a square horizontally should produce two Polygon features', () => {
    const sliceLine: LineString = { type: 'LineString', coordinates: [[0, 1], [2, 1]] };
    const result = polygonSlice(square, sliceLine);
    
    expect(result.features.length).toBe(2);
    result.features.forEach(feat => expect(feat.geometry.type).toBe('Polygon'));
    const horizCoords = result.features.map(f => f.geometry.coordinates);
    expect(horizCoords).toContainEqual([[[0,0],[2,0],[2,1],[0,1],[0,0]]]);
    expect(horizCoords).toContainEqual([[[0,1],[2,1],[2,2],[0,2],[0,1]]]);
});

test('Slicing a square vertically should produce two Polygon features', () => {
    const sliceLine: LineString = { type: 'LineString', coordinates: [[1, 0], [1, 2]] };
    const result = polygonSlice(square, sliceLine);
    
    expect(result.features.length).toBe(2);
    result.features.forEach(feat => expect(feat.geometry.type).toBe('Polygon'));
    const vertCoords = result.features.map(f => f.geometry.coordinates);
    expect(vertCoords).toContainEqual([[[0,0],[1,0],[1,2],[0,2],[0,0]]]);
    expect(vertCoords).toContainEqual([[[1,0],[2,0],[2,2],[1,2],[1,0]]]);
});

test('Slicing using a line outside the polygon returns the original polygon', () => {
    const sliceLine: LineString = { type: 'LineString', coordinates: [[3, 3], [4, 4]] };
    const result = polygonSlice(square, sliceLine);
    
    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry.coordinates).toEqual(square.coordinates);
});