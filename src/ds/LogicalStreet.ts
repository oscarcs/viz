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
     * Calculate the turn angle between two edges at their shared node
     * @param incomingEdge - The edge coming into the node
     * @param outgoingEdge - The edge going out from the node
     * @returns Turn angle in radians (0 = straight through, π = U-turn)
     */
    static calculateTurnAngle(incomingEdge: Edge, outgoingEdge: Edge): number {
        const node = incomingEdge.to; // The shared node
        
        // Vector of incoming direction (pointing toward the node)
        const incomingVector = [
            node.coordinates[0] - incomingEdge.from.coordinates[0],
            node.coordinates[1] - incomingEdge.from.coordinates[1]
        ];
        
        // Vector of outgoing direction (pointing away from the node)
        const outgoingVector = [
            outgoingEdge.to.coordinates[0] - node.coordinates[0],
            outgoingEdge.to.coordinates[1] - node.coordinates[1]
        ];
        
        // Calculate angles
        const incomingAngle = Math.atan2(incomingVector[1], incomingVector[0]);
        const outgoingAngle = Math.atan2(outgoingVector[1], outgoingVector[0]);
        
        // Calculate turn angle (absolute difference)
        let turnAngle = Math.abs(outgoingAngle - incomingAngle);
        
        // Normalize to [0, π] - we want the smaller angle
        if (turnAngle > Math.PI) {
            turnAngle = 2 * Math.PI - turnAngle;
        }
        
        return turnAngle;
    }
    
    /**
     * Check if two edges should be considered part of the same logical street
     * Continue the street when the turn angle is less than 60° (straight enough)
     */
    static shouldContinueStreet(incomingEdge: Edge, outgoingEdge: Edge): boolean {
        const turnAngle = LogicalStreet.calculateTurnAngle(incomingEdge, outgoingEdge);
        const maxTurnAngle = Math.PI / 3; // 60 degrees
        return turnAngle < maxTurnAngle;
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
