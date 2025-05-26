import { expect, test } from 'vitest';
import StreetGraph from '../ds/StreetGraph';
import { LineString } from 'geojson';

test('Intersecting two streets should calculate the correct intersection point', () => {
    const graph = new StreetGraph();

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
    const graph = new StreetGraph();
    
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
    const graph = new StreetGraph();

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
    const polygons = StreetGraph.polygonize(graph.copy());
    
    expect(polygons.features.length).toBe(1);
    expect(polygons.features[0].geometry.type).toBe('Polygon');
});

test('Splitting existing polygon two ways should produce 4 polygons', () => {
    const graph = new StreetGraph();

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
    const polygons = StreetGraph.polygonize(graph);        
    expect(polygons.features.length).equals(4);
});

test('Should handle floating-point precision issues when snapping coordinates', () => {
    const graph = new StreetGraph();

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
    const graph = new StreetGraph();

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

test('Splitting a handcrafted quadrilateral vertically should result in two polygons', () => {
    const graph = new StreetGraph();
    
    const square: LineString = {
        type: 'LineString',
        coordinates: [
            [-0.0016334652900811277, 0.0009629130362344393],
            [0.0012499094007866265, 0.001032650470501268],
            [0.0012579560278262222, -0.0010541081427849672],
            [-0.0015905499460226178, -0.0011131167412152792],
            [-0.0016334652900811277, 0.0009629130362344393]
        ]
    };
    
    graph.addLineString(square);

    const verticalLine: LineString = {
        type: 'LineString',
        coordinates: [
            [-0.0002952419571248901, 0.0009952793679539862],
            [-0.00028186017235688234, -0.0010860064068740263]
        ]
    };
    
    graph.addLineString(verticalLine);

    const polygons = StreetGraph.polygonize(graph.copy());    
    expect(polygons.features.length).toBe(2);
});

test('addLineString should respect per-point snapping states', () => {
    const graph = new StreetGraph();
    
    const horizontalLine: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };
    graph.addLineString(horizontalLine);
    
    // Add a three-point line where only the middle point should snap
    const threePointLine: LineString = {
        type: 'LineString',
        coordinates: [
            [0.2, 0.5],         // Point 0: Should NOT snap (far from any edge)
            [0.5, 0.0001],      // Point 1: Should snap to horizontal edge at (0.5, 0)
            [0.8, 0.5]          // Point 2: Should NOT snap (far from any edge)
        ]
    };
    
    // Test with per-point snapping: [false, true, false]
    // Point 0: no snapping, Point 1: snapping enabled, Point 2: no snapping
    graph.addLineString(threePointLine, { 
        pointSnapping: [false, true, false] 
    });
    
    const nodes = graph.getNodes();
    
    // Point 0 should remain at original position (0.2, 0.5)
    expect(nodes).toHaveProperty('0.2,0.5');
    
    // Point 1 should have snapped to the horizontal edge at (0.5, 0)
    expect(nodes).toHaveProperty('0.5,0');
    expect(nodes).not.toHaveProperty('0.5,0.0001');
    
    // Point 2 should remain at original position (0.8, 0.5)
    expect(nodes).toHaveProperty('0.8,0.5');
});

test('Creating a street with two line strings should produce one logical street', () => {
    const graph = new StreetGraph();
    
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };
    
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0.2]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);

    const logicalStreets = graph.getLogicalStreets();
    expect(logicalStreets.length).toBe(1);
});

test('Creating a t-junction with two line strings should produce two logical streets', () => {
    const graph = new StreetGraph();
    
    // Horizontal road
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [2, 0]]
    };
    
    // Road with a 90-degree angle
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [1, 1]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);

    const logicalStreets = graph.getLogicalStreets();
    
    // Due to the 90-degree angle, these should be separate logical streets
    expect(logicalStreets.length).toBe(2);
});

test('Creating a t-junction with three line strings should produce two logical streets', () => {
    const graph = new StreetGraph();
    
    // Create a straight road from point A to B
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };
    
    // Create another road that continues straight from B to C
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0]]
    };
    
    // Create a perpendicular road at point B
    const street3: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [1, 1]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);
    graph.addLineString(street3);

    const logicalStreets = graph.getLogicalStreets();
    
    // Should have 2 logical streets:
    // 1. The straight horizontal road (A-B-C)
    // 2. The perpendicular road (B to north)
    expect(logicalStreets.length).toBe(2);
    
    // Check that each logical street has the expected number of edges
    const streetSizes = logicalStreets.map(street => street.edges.size).sort();
    expect(streetSizes).toEqual([2, 4]); // One street with 1 edge pair, one with 2 edge pairs
});

test('Creating a 4-way cross junction using two line strings should produce two logical streets', () => {
    const graph = new StreetGraph();
    
    // Add a straight street first
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [2, 0]]
    };
    graph.addLineString(street1);
    
    // Get the initial logical streets - should have 1 street with 2 edges
    let logicalStreets = graph.getLogicalStreets();
    expect(logicalStreets.length).toBe(1);
    expect(logicalStreets[0].edges.size).toBe(2); // Edge and its symmetric
    
    // Store the street ID for later comparison
    const originalStreetId = logicalStreets[0].id;
    
    // Add an intersecting street that will split the original street
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, -1], [1, 1]]
    };
    graph.addLineString(street2);
    
    // Check that logical streets are preserved correctly
    logicalStreets = graph.getLogicalStreets();
    
    // Should still have 2 logical streets (the original split street and the new intersecting street)
    expect(logicalStreets.length).toBe(2);
    
    // Find the original street (it should still exist with the same ID)
    const originalStreet = logicalStreets.find(s => s.id === originalStreetId);
    expect(originalStreet).toBeDefined();
    
    // The original street should now have 4 edges (two segments split from the original, each with symmetric)
    expect(originalStreet!.edges.size).toBe(4);
    
    // The intersecting street should have 4 edges (two segments from the split, each with symmetric)
    const intersectingStreet = logicalStreets.find(s => s.id !== originalStreetId);
    expect(intersectingStreet).toBeDefined();
    expect(intersectingStreet!.edges.size).toBe(4);
    
    // Verify that all edges are properly assigned to logical streets
    const allEdges = graph.getEdges();
    let assignedEdgesCount = 0;
    for (const edge of allEdges) {
        const street = graph.findLogicalStreetForEdge(edge);
        if (street) {
            assignedEdgesCount++;
        }
    }
    expect(assignedEdgesCount).toBe(allEdges.length);
});

test('Creating a 4-way cross junction with four line strings should produce two logical streets', () => {
const graph = new StreetGraph();
    
    const street1a: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };

    const street2a: LineString = {
        type: 'LineString',
        coordinates: [[1, -1], [1, 0]]
    };

    const street1b: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0]]
    };

    const street2b: LineString = {
        type: 'LineString',
        coordinates: [[1, 1], [1, 0]]
    };

    graph.addLineString(street1a);
    graph.addLineString(street2a);

    // Get the initial logical streets - should have 2 streets with 2 edges
    let logicalStreets = graph.getLogicalStreets();
    expect(logicalStreets.length).toBe(2);
    
    // Store the street IDs for later comparison
    const originalStreet1Id = logicalStreets[0].id;
    const originalStreet2Id = logicalStreets[1].id;

    graph.addLineString(street1b);
    graph.addLineString(street2b);
    
    // Check that logical streets are preserved correctly
    logicalStreets = graph.getLogicalStreets();
    
    expect(logicalStreets.length).toBe(2);
    
    // Find the original streets (they should still exist and have 4 edges)
    const originalStreet1 = logicalStreets.find(s => s.id === originalStreet1Id);
    expect(originalStreet1).toBeDefined();
    expect(originalStreet1!.edges.size).toBe(4);

    const originalStreet2 = logicalStreets.find(s => s.id === originalStreet2Id);
    expect(originalStreet2).toBeDefined();
    expect(originalStreet2!.edges.size).toBe(4);
    
    // Verify that all edges are properly assigned to logical streets
    const allEdges = graph.getEdges();
    let assignedEdgesCount = 0;
    for (const edge of allEdges) {
        const street = graph.findLogicalStreetForEdge(edge);
        if (street) {
            assignedEdgesCount++;
        }
    }
    expect(assignedEdgesCount).toBe(allEdges.length);
});

test('Creating a 3-way y-junction with two line strings should produce two logical streets', () => {
    const graph = new StreetGraph();

    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [2, 0]]
    };
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0.2]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);

    const logicalStreets = graph.getLogicalStreets();

    // Should have 2 logical streets, the main road and the branch
    expect(logicalStreets.length).toBe(2);

    // Check that each logical street has the expected number of edges
    const streetSizes = logicalStreets.map(street => street.edges.size).sort();
    expect(streetSizes).toEqual([2, 4]); // One street with 1 edge pair (branch), one with 2 edge pairs (main road)
    
    // Verify that all edges are properly assigned to logical streets
    const allEdges = graph.getEdges();
    let assignedEdgesCount = 0;
    for (const edge of allEdges) {
        const street = graph.findLogicalStreetForEdge(edge);
        if (street) {
            assignedEdgesCount++;
        }
    }
    expect(assignedEdgesCount).toBe(allEdges.length);
});

test('Creating a 3-way y-junction with three line strings should produce two logical streets', () => {
    const graph = new StreetGraph();
    
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [1, 0]]
    };

    // The upper and lower branches of the y-junction
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, -0.2]]
    };
    const street3: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0.2]]
    };

    graph.addLineString(street1);
    graph.addLineString(street2);
    graph.addLineString(street3);

    const logicalStreets = graph.getLogicalStreets();
    
    // Should have 2 logical streets:
    // 1. The main road (street1 + street2), because they were added first.
    // 2. The branching road (street3)
    expect(logicalStreets.length).toBe(2);
    
    // Check that each logical street has the expected number of edges
    const streetSizes = logicalStreets.map(street => street.edges.size).sort();
    expect(streetSizes).toEqual([2, 4]); // One street with 1 edge pair (branch), one with 2 edge pairs (main road)
    
    // Verify that all edges are properly assigned to logical streets
    const allEdges = graph.getEdges();
    let assignedEdgesCount = 0;
    for (const edge of allEdges) {
        const street = graph.findLogicalStreetForEdge(edge);
        if (street) {
            assignedEdgesCount++;
        }
    }
    expect(assignedEdgesCount).toBe(allEdges.length);
});

test('Adding a fifth line string to a 4-way cross junction should create a new logical street', () => {
    const graph = new StreetGraph();
    
    // Create a 4-way cross junction first
    const street1: LineString = {
        type: 'LineString',
        coordinates: [[0, 0], [2, 0]]  // Horizontal street
    };
    const street2: LineString = {
        type: 'LineString',
        coordinates: [[1, -1], [1, 1]]  // Vertical street
    };
    
    graph.addLineString(street1);
    graph.addLineString(street2);
    
    // Should have 2 logical streets
    let logicalStreets = graph.getLogicalStreets();
    expect(logicalStreets.length).toBe(2);
    
    // Now add a fifth line string at a small angle to the horizontal street
    const street5: LineString = {
        type: 'LineString',
        coordinates: [[1, 0], [2, 0.1]]  // Small angle (~5.7 degrees) from horizontal
    };
    
    graph.addLineString(street5);
    
    // Should now have 3 logical streets (not 2) - the fifth street should not be added to the horizontal street
    logicalStreets = graph.getLogicalStreets();
    expect(logicalStreets.length).toBe(3);
    
    // Verify that all edges are properly assigned
    const allEdges = graph.getEdges();
    let assignedEdgesCount = 0;
    for (const edge of allEdges) {
        const street = graph.findLogicalStreetForEdge(edge);
        if (street) {
            assignedEdgesCount++;
        }
    }
    expect(assignedEdgesCount).toBe(allEdges.length);
});