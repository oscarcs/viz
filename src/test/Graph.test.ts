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

    graph.addLineString(street1);
    graph.addLineString(street2);

    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    expect(Object.keys(nodes).length).toBe(5);
    expect(edges.length).toBe(8);

    expect(nodes).toHaveProperty('0,0');
    expect(nodes).toHaveProperty('0,1');
    expect(nodes).toHaveProperty('1,1');
    expect(nodes).toHaveProperty('1,0');
    expect(nodes).toHaveProperty('0.5,0.5');

    const hasEdge = (from: string, to: string) => {
        return edges.some(edge => 
            edge.from.id === from && edge.to.id === to
        );
    };

    // From (0,0) to center and back
    expect(hasEdge('0,0', '0.5,0.5')).toBe(true);
    expect(hasEdge('0.5,0.5', '0,0')).toBe(true);

    // From (1,1) to center and back
    expect(hasEdge('1,1', '0.5,0.5')).toBe(true);
    expect(hasEdge('0.5,0.5', '1,1')).toBe(true);

    // From (0,1) to center and back
    expect(hasEdge('0,1', '0.5,0.5')).toBe(true);
    expect(hasEdge('0.5,0.5', '0,1')).toBe(true);

    // From (1,0) to center and back
    expect(hasEdge('1,0', '0.5,0.5')).toBe(true);
    expect(hasEdge('0.5,0.5', '1,0')).toBe(true);
});

test('Adding a grid of line strings should create the correct number of nodes and edges', () => {
    const graph = new Graph();
    
    const street1: LineString = {
        type: 'LineString',
        coordinates: [
            [0, -0.1],
            [0, 1.1]
        ]
    };

    const street2: LineString = {
        type: 'LineString',
        coordinates: [
            [1, -0.1],
            [1, 1.1]
        ]
    };

    const street3: LineString = {
        type: 'LineString',
        coordinates: [
            [-0.1, 0],
            [1.1, 0]
        ]
    };
    
    const street4: LineString = {
        type: 'LineString',
        coordinates: [
            [-0.1, 1],
            [1.1, 1]
        ]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);
    graph.addLineString(street3);
    graph.addLineString(street4);
    
    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    expect(Object.keys(nodes).length).toBe(12);
    expect(edges.length).toBe(24);
});
