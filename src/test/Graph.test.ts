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

test('Polygonization should work with epsilon handling', () => {
    const graph = new Graph();

    // Create a simple square
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [1, 1]]
    };
    const street3: LineString = {
        type: 'LineString',
        coordinates: [[1, 1], [0, 1]]
    };
    const street4: LineString = {
        type: 'LineString',
        coordinates: [[0, 1], [0, 0]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);
    graph.addLineString(street3);
    graph.addLineString(street4);

    // Test polygonization
    const polygons = Graph.polygonize(graph.copy());
    
    expect(polygons.features.length).toBe(1);
    expect(polygons.features[0].geometry.type).toBe('Polygon');
});

test('Splitting existing polygon two ways should produce 4 polygons', () => {
    const graph = new Graph();

    // Create a square by adding intersecting lines that should split at the middle
    const horizontalLine: LineString = {
        type: 'LineString',
        coordinates: [[0, 0.5], [1, 0.5]]
    };
    
    const verticalLine: LineString = {
        type: 'LineString',
        coordinates: [[0.5, 0], [0.5, 1]]
    };
    
    // Add box edges to form a complete square
    const topEdge: LineString = {
        type: 'LineString',
        coordinates: [[0, 1], [1, 1]]
    };
    
    const bottomEdge: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };
    
    const leftEdge: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [0, 1]]
    };
    
    const rightEdge: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [1, 1]]
    };
    
    // Add the box first
    graph.addLineString(topEdge);
    graph.addLineString(bottomEdge);
    graph.addLineString(leftEdge);
    graph.addLineString(rightEdge);
    
    // Now add the intersecting lines - this should split edges
    graph.addLineString(horizontalLine);
    graph.addLineString(verticalLine);
    
    // Check that intersection node exists
    const nodes = graph.getNodes();
    const intersectionNode = nodes['0.5,0.5'];
    expect(intersectionNode).toBeDefined();
        
    // Check correct number of polygons formed
    const polygons = Graph.polygonize(graph);        
    expect(polygons.features.length).equals(4);
});

test('Should handle floating-point precision issues when snapping coordinates', () => {
    const graph = new Graph();

    // Add a horizontal street
    const street1: LineString = {
        type: 'LineString',
        coordinates: [
            [0, 0],
            [1, 0]
        ]
    };

    graph.addLineString(street1);

    // Add a vertical street with slightly imprecise coordinates that should snap to existing points
    const street2: LineString = {
        type: 'LineString', 
        coordinates: [
            [0.5, -0.5],
            [0.50000000000000001, 0.50000000000000001]  // Very close to (0.5, 0.5) but not exact
        ]
    };

    graph.addLineString(street2);

    const nodes = graph.getNodes();

    // Should have created exactly 5 nodes: (0,0), (1,0), (0.5,0), (0.5,-0.5), (0.5,0.5)
    expect(Object.keys(nodes).length).toBe(5);
    
    // Should have an intersection node at (0.5, 0)
    expect(nodes).toHaveProperty('0.5,0');
    
    // Should not have created duplicate nodes for nearly-identical coordinates
    const nodeIds = Object.keys(nodes);
    const hasNearDuplicates = nodeIds.some(id1 => 
        nodeIds.some(id2 => {
            if (id1 === id2) return false;
            const coords1 = id1.split(',').map(Number);
            const coords2 = id2.split(',').map(Number);
            const distance = Math.sqrt(
                Math.pow(coords1[0] - coords2[0], 2) + 
                Math.pow(coords1[1] - coords2[1], 2)
            );
            return distance < 1e-10; // Very small distance indicates near-duplicate
        })
    );
    
    expect(hasNearDuplicates).toBe(false);
});

test('Should handle exact coordinate matching', () => {
    const graph = new Graph();

    // Add a horizontal street
    const street1: LineString = {
        type: 'LineString',
        coordinates: [
            [0, 0],
            [1, 0]
        ]
    };

    graph.addLineString(street1);

    // Add a vertical street with exact coordinates
    const street2: LineString = {
        type: 'LineString', 
        coordinates: [
            [0.5, -0.5],
            [0.5, 0],    // Exact intersection point
            [0.5, 0.5]
        ]
    };

    graph.addLineString(street2);

    const nodes = graph.getNodes();

    // Should have exactly 5 nodes with exact coordinates
    expect(Object.keys(nodes).length).toBe(5);
    expect(nodes).toHaveProperty('0.5,0');
});
