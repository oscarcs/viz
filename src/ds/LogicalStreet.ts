import { Edge } from "./Edge";
import { Node } from "./Node";

/**
 * Represents a logical street - a collection of connected road segments
 * that form a continuous path
 */
export class LogicalStreet {
    public id: string;
    public name?: string;
    public color: [number, number, number, number];
    public edges: Set<Edge>;
    
    constructor(id: string, color?: [number, number, number, number]) {
        this.id = id;
        this.color = color || this.generateRandomColor();
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
    }
    
    /**
     * Remove an edge from this logical street
     */
    removeEdge(edge: Edge) {
        this.edges.delete(edge);
        if (edge.symmetric) {
            this.edges.delete(edge.symmetric);
        }
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
     * Get the total length of this logical street by summing the lengths of all edges
     */
    getLength(): number {
        let totalLength = 0;
        this.edges.forEach(edge => {
            // Calculate distance between from and to nodes
            const dx = edge.to.coordinates[0] - edge.from.coordinates[0];
            const dy = edge.to.coordinates[1] - edge.from.coordinates[1];
            const edgeLength = Math.sqrt(dx * dx + dy * dy);
            totalLength += edgeLength;
        });

        // Divide by 2 since both edge and its symmetric are in the set
        return totalLength / 2;
    }
    
    /**
     * Generate a random color for this street
     */
    private generateRandomColor(): [number, number, number, number] {
        return [
            Math.random() * 255,
            Math.random() * 255,
            Math.random() * 255,
            255
        ];
    }
}
