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

test('Slicing a polygon where line starts on vertex should produce expected results', () => {
    const poly: Polygon = {
        "type": "Polygon",
        "coordinates": [
            [
                [-0.0013142824174087247, -0.001038014888476776],
                [0.0010755658148523888, -0.001013875007345267],
                [0.0007676599797855964, -0.0007157490480706565],
                [0.00076766, -0.00071575],
                [-0.0010345165319078477, -0.0007339499649761527],
                [-0.0013142824174087247, -0.001038014888476776]
            ]
        ]
    };

    // Line starts exactly on polygon vertex at index 2
    const line: LineString = {
        "type": "LineString",
        "coordinates": [
            [0.0007676599797855964, -0.0007157490480706565],
            [0.0007707024585283832, -0.001016954435285667]
        ]
    };

    const result = polygonSlice(poly, line);
    
    expect(result).toBeDefined();
    expect(result.features.length).toBe(2);
    result.features.forEach(feat => expect(feat.geometry.type).toBe('Polygon'));
});