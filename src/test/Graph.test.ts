import { expect, test } from 'vitest';
import { Graph } from '../ds/Graph';
import { LineString } from 'geojson';

test('Intersecting two streets should calculate the correct intersection point', () => {
    const graph = new Graph();

    const street1: LineString = {
        type: 'LineString',
        coordinates: [
            [0, 0],
            [1, 1]
        ]
    };

    const street2: LineString = {
        type: 'LineString',
        coordinates: [
            [0, 1],
            [1, 0]
        ]
    };

    graph.addStreet(street1);
    graph.addStreet(street2);

    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    expect(Object.keys(nodes).length).toBe(5);
    expect(edges.length).toBe(8);
});