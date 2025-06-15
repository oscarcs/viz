import { Edge } from "./Edge";
import { Node } from "./Node";
import { convertLength } from "@turf/turf";
import { LineString } from "geojson";
import { DEFAULT_STREET_WIDTH } from "./StreetGraph";
import { randomColor } from "../util/random";

/**
 * Represents a logical street - a collection of connected road segments
 * that form a continuous path
 */
export class LogicalStreet {
    public id: string;
    public name?: string;
    public color: [number, number, number, number];
    public edges: Set<Edge>;
    /**
     * Width of the street in meters
     */
    public width: number;

    private lineString?: LineString;
    
    constructor(id: string, color?: [number, number, number, number], width?: number) {
        this.id = id;
        this.color = color || randomColor();
        this.width = width || DEFAULT_STREET_WIDTH;
        this.edges = new Set();
    }
    
    /**
     * Add an edge to this logical street
     */
    addEdge(edge: Edge) {
        this.edges.add(edge);
        // Also add the symmetric edge
        if (edge.symmetric) {
            this.edges.add(edge.symmetric);
        }

        this.lineString = undefined; // Invalidate cached LineString
    }
    
    /**
     * Remove an edge from this logical street
     */
    removeEdge(edge: Edge) {
        this.edges.delete(edge);
        if (edge.symmetric) {
            this.edges.delete(edge.symmetric);
        }

        this.lineString = undefined; // Invalidate cached LineString
    }
    
    /**
     * Check if this logical street contains the given edge
     */
    hasEdge(edge: Edge): boolean {
        return this.edges.has(edge) || !!(edge.symmetric && this.edges.has(edge.symmetric));
    }
    
    /**
     * Get all unique nodes that are part of this logical street
     */
    getNodes(): Node[] {
        const nodes = new Set<Node>();
        this.edges.forEach(edge => {
            nodes.add(edge.from);
            nodes.add(edge.to);
        });
        return Array.from(nodes);
    }

    /**
     * Get the total length of this logical street by summing the lengths of all edges.
     * @returns {number} Total length in the same units as the coordinates (e.g., degrees for lat/lon)
     */
    getLength(): number {
        let totalLength = 0;
        this.edges.forEach(edge => {
            const dx = edge.to.coordinates[0] - edge.from.coordinates[0];
            const dy = edge.to.coordinates[1] - edge.from.coordinates[1];
            const edgeLength = Math.sqrt(dx * dx + dy * dy);
            totalLength += edgeLength;
        });

        // Divide by 2 since both edge and its symmetric are in the set
        return totalLength / 2;
    }

    /**
     * Get the total length of this logical street in meters using Turf.js
     * @returns {number} Length in meters
     */
    getLengthInMeters(): number {   
        return convertLength(this.getLength(), 'degrees', 'meters');
    }

    /**
     * Get the GeoJSON LineString representation of this logical street.
     * This will traverse the edges to create a continuous path.
     * @returns {LineString} GeoJSON LineString feature representing the street
     */
    getLineString(): LineString {
        if (this.lineString) {
            console.debug("Returning cached LineString for LogicalStreet", this.id);
            return this.lineString;
        }

        if (this.edges.size === 0) {
            return {
                type: "LineString",
                coordinates: []
            };
        }

        // Get unique edges (avoid symmetric duplicates)
        const uniqueEdges = new Set<Edge>();
        const processedIds = new Set<string>();
        
        for (const edge of this.edges) {
            const edgeId = `${edge.from.id}-${edge.to.id}`;
            const symmetricId = `${edge.to.id}-${edge.from.id}`;
            
            if (!processedIds.has(edgeId) && !processedIds.has(symmetricId)) {
                uniqueEdges.add(edge);
                processedIds.add(edgeId);
                processedIds.add(symmetricId);
            }
        }

        if (uniqueEdges.size === 0) {
            return {
                type: "LineString",
                coordinates: []
            };
        }

        // Build adjacency map
        const adjacency = new Map<string, Node[]>();
        for (const edge of uniqueEdges) {
            if (!adjacency.has(edge.from.id)) {
                adjacency.set(edge.from.id, []);
            }
            if (!adjacency.has(edge.to.id)) {
                adjacency.set(edge.to.id, []);
            }
            adjacency.get(edge.from.id)!.push(edge.to);
            adjacency.get(edge.to.id)!.push(edge.from);
        }

        // Find starting point (endpoint with degree 1, or any node if all have degree 2)
        let startNode: Node | null = null;
        for (const [nodeId, neighbors] of adjacency) {
            if (neighbors.length === 1) {
                startNode = neighbors[0]; // Get the actual node
                // Find the node with this ID from the edges
                for (const edge of uniqueEdges) {
                    if (edge.from.id === nodeId) {
                        startNode = edge.from;
                        break;
                    }
                    if (edge.to.id === nodeId) {
                        startNode = edge.to;
                        break;
                    }
                }
                break;
            }
        }

        // If no endpoint found, start with any node
        if (!startNode) {
            startNode = Array.from(uniqueEdges)[0].from;
        }

        // Traverse the path
        const coordinates: [number, number][] = [];
        const visited = new Set<string>();
        let currentNode = startNode;

        while (currentNode) {
            coordinates.push([currentNode.coordinates[0], currentNode.coordinates[1]]);
            
            const neighbors = adjacency.get(currentNode.id) || [];
            let nextNode: Node | null = null;
            
            for (const neighbor of neighbors) {
                const edgeKey = `${currentNode.id}-${neighbor.id}`;
                const reverseEdgeKey = `${neighbor.id}-${currentNode.id}`;
                
                if (!visited.has(edgeKey) && !visited.has(reverseEdgeKey)) {
                    visited.add(edgeKey);
                    visited.add(reverseEdgeKey);
                    nextNode = neighbor;
                    break;
                }
            }

            if (!nextNode) {
                break; // No unvisited neighbors left, exit loop
            }
            
            currentNode = nextNode;
        }

        const ls = {
            type: "LineString" as const,
            coordinates: coordinates
        };
        this.lineString = ls;
        return ls;
    }
}
