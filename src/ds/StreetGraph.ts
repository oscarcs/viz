import { Node } from "./Node";
import { Edge } from "./Edge";
import { EdgeRing } from "./EdgeRing";
import { LogicalStreet } from "./LogicalStreet";
import { flattenEach, coordReduce, featureOf, AllGeoJSON, featureCollection } from "@turf/turf";
import {
    FeatureCollection,
    LineString,
    MultiLineString,
    Feature,
    Polygon,
} from "geojson";
import { Block } from "../procgen/Strips";
import { randomFromArray } from "../util/random";
import { customBuffer } from "../util/CustomBuffer";

/**
 * Validates the geoJson.
 *
 * @param {GeoJSON} geoJson - input geoJson.
 * @throws {Error} if geoJson is invalid.
 */
function validateGeoJson(geoJson: AllGeoJSON) {
    if (!geoJson) throw new Error("No geojson passed");

    if (
        geoJson.type !== "FeatureCollection" &&
        geoJson.type !== "GeometryCollection" &&
        geoJson.type !== "MultiLineString" &&
        geoJson.type !== "LineString" &&
        geoJson.type !== "Feature"
    )
        throw new Error(
            `Invalid input type '${geoJson.type}'. Geojson must be FeatureCollection, GeometryCollection, LineString, MultiLineString or Feature`
        );
}

// Epsilon value for floating-point coordinate precision handling
// Small epsilon helps handle snapping precision issues while maintaining polygonization compatibility
const EPSILON = 1e-10;

/**
 * Tolerance for snapping endpoints to nearby edges in degrees.
 */
export const SNAP_TOLERANCE = 0.0002;

/**
 * Default street width of logical streets in meters.
 */
export const DEFAULT_STREET_WIDTH = 10;

/**
 * Represents a planar graph of edges and nodes that can be used to compute a polygonization.
 * This graph is directed (both directions are created)
 */
class StreetGraph {
    private nodes: { [id: string]: Node };
    private edges: Edge[];
    private logicalStreets: Map<string, LogicalStreet>;
    private streetIdCounter: number;

    /**
     * Creates a graph from a GeoJSON.
     *
     * @param {FeatureCollection<LineString>} geoJson - it must comply with the restrictions detailed in the index
     * @returns {StreetGraph} - The newly created graph
     * @throws {Error} if geoJson is invalid.
     */
    static fromGeoJson(
        geoJson:
            | FeatureCollection<LineString | MultiLineString>
            | LineString
            | MultiLineString
            | Feature<LineString | MultiLineString>
    ) {
        validateGeoJson(geoJson);

        const graph = new StreetGraph();
        flattenEach(geoJson, (feature) => {
            featureOf(feature, "LineString", "Graph::fromGeoJson");
            // When a LineString if formed by many segments, split them
            coordReduce<number[]>(feature, (prev, cur) => {
                if (prev) {
                    const start = graph.getNode(prev),
                        end = graph.getNode(cur);

                    graph.addEdge(start, end);
                }
                return cur;
            });
        });

        return graph;
    }

    getEdges() {
        return this.edges;
    }

    getNodes() {
        return this.nodes;
    }

    toFeatureCollection(): FeatureCollection<LineString> {
        const processedEdges = new Set<string>();
        const features: any[] = [];

        // Create a feature for each unique edge
        this.edges.forEach(edge => {
            const edgeId = `${edge.from.id}-${edge.to.id}`;
            const reverseEdgeId = `${edge.to.id}-${edge.from.id}`;
            
            // Only process one direction of each edge
            if (!processedEdges.has(edgeId) && !processedEdges.has(reverseEdgeId)) {
                processedEdges.add(edgeId);
                processedEdges.add(reverseEdgeId);
                
                features.push({
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: [edge.from.coordinates, edge.to.coordinates]
                    }
                });
            }
        });

        return featureCollection(features);
    }

    /**
     * Add a new line string to the graph.
     * It will split the line string and existing edges at intersections, and add new edges accordingly.
     * @param street LineString - The line string to add
     * @param options - Options for adding the line string
     * @param options.pointSnapping - Per-point snapping states
     */
    addLineString(street: LineString, options: { pointSnapping?: boolean[] } = {}) {
        if (!street || !street.coordinates || street.coordinates.length < 2) {
            return;
        }

        const { pointSnapping } = options;
        let newEdges: Edge[] = [];

        for (let i = 0; i < street.coordinates.length - 1; i++) {
            let start = street.coordinates[i];
            let end = street.coordinates[i + 1];
            
            let snapStart = false;
            let snapEnd = false;
            
            if (pointSnapping && pointSnapping.length === street.coordinates.length) {
                snapStart = pointSnapping[i];
                snapEnd = pointSnapping[i + 1];
            }
            
            // Snap endpoints to nearby edges if they're close enough and snapping is enabled for that point
            if (snapStart) {
                start = this.snapToNearbyEdge(start);
            }
            if (snapEnd) {
                end = this.snapToNearbyEdge(end);
            }
            
            // Find all intersection points (excluding endpoints)
            const intersections = this.findAllIntersections(start, end);
            intersections.sort((a, b) => a.distance - b.distance);

            // Collect all split points: start, intersections, end
            const splitPoints: number[][] = [start];
            for (const inter of intersections) {
                // Avoid duplicates (e.g., if intersection is at start/end)
                if (!splitPoints.some(pt => this.pointsEqual(pt, inter.point, EPSILON))) {
                    splitPoints.push(inter.point);
                }
            }
            if (!splitPoints.some(pt => this.pointsEqual(pt, end, EPSILON))) {
                splitPoints.push(end);
            }

            // Sort split points by distance from start
            splitPoints.sort((a, b) => this.distance(start, a) - this.distance(start, b));

            // Split existing edges at intersection points
            const edgesToRemoveFromNewEdges = new Set<Edge>();
            for (const inter of intersections) {
                const intersectionNode = this.getNode(inter.point);
                const splitEdges = this.splitEdgeAtIntersection(inter.edge, intersectionNode);
                
                // Add the edges created from splitting to our newEdges array for logical street assignment
                newEdges.push(...splitEdges);
                
                // Mark the original edge for removal from newEdges since it was split
                edgesToRemoveFromNewEdges.add(inter.edge);
            }
            
            // Remove the split edges from newEdges
            newEdges = newEdges.filter(edge => !edgesToRemoveFromNewEdges.has(edge));

            // Add edges between consecutive split points
            for (let j = 0; j < splitPoints.length - 1; j++) {
                const fromNode = this.getNode(splitPoints[j]);
                const toNode = this.getNode(splitPoints[j + 1]);
                
                if (!this.edgeExists(fromNode, toNode)) {
                    const newEdge = this.addEdge(fromNode, toNode);
                    if (newEdge) {
                        newEdges.push(newEdge);
                    }
                }
            }
        }
        
        // Assign new edges to logical streets
        this.assignNewEdgesToLogicalStreets(newEdges);
    }

    /**
     * Snap a point to a nearby edge if it's within the snap tolerance
     * @param point - The point to potentially snap
     * @returns The snapped point or the original point if no nearby edge
     */
    private snapToNearbyEdge(point: number[]): number[] {
        const nearestPointOnEdge = this.findNearestPointOnEdge(point, SNAP_TOLERANCE);
        if (nearestPointOnEdge) {
            // Only snap if the nearest point is not at an existing vertex (to avoid unwanted snapping to vertices)
            const isAtVertex = this.pointsEqual(nearestPointOnEdge.point, nearestPointOnEdge.edge.from.coordinates, EPSILON) ||
                this.pointsEqual(nearestPointOnEdge.point, nearestPointOnEdge.edge.to.coordinates, EPSILON);
            
            if (!isAtVertex) {
                return nearestPointOnEdge.point;
            }
        }
        return point;
    }

    // Check if an edge already exists between two nodes
    private edgeExists(fromNode: Node, toNode: Node): boolean {
        return fromNode.getOuterEdges().some(edge => edge.to.id === toNode.id);
    }

    // Find all intersections between a segment and existing edges
    private findAllIntersections(start: number[], end: number[]) {
        const intersections = [];
        
        for (const edge of this.edges) {
            // Skip if we're checking the same edge
            if ((this.pointsEqual(edge.from.coordinates, start, EPSILON) && 
                 this.pointsEqual(edge.to.coordinates, end, EPSILON)) ||
                (this.pointsEqual(edge.from.coordinates, end, EPSILON) && 
                 this.pointsEqual(edge.to.coordinates, start, EPSILON))) {
                continue;
            }
            
            const intersection = this.lineIntersection(
                start, end, edge.from.coordinates, edge.to.coordinates
            );
            
            if (intersection) {
                // Only skip if intersection is at an endpoint of the EXISTING edge
                // (We want to split existing edges even if intersection is at endpoints of the new line)
                if (this.pointsEqual(intersection, edge.from.coordinates, EPSILON) || 
                    this.pointsEqual(intersection, edge.to.coordinates, EPSILON)) {
                    continue;
                }
                
                intersections.push({
                    point: intersection,
                    edge: edge,
                    distance: this.distance(start, intersection)
                });
            }
        }
        
        return intersections;
    }

    private pointsEqual(p1: number[], p2: number[], epsilon = 0): boolean {
        if (epsilon === 0) {
            return p1[0] === p2[0] && p1[1] === p2[1];
        }
        else {
            return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
        }
    }

    // Split an existing edge at the intersection point
    private splitEdgeAtIntersection(edge: Edge, intersectionNode: Node): Edge[] {
        const fromNode = edge.from;
        const toNode = edge.to;
        
        // Skip if the edge already connects to this intersection
        if (fromNode.id === intersectionNode.id || toNode.id === intersectionNode.id) {
            return [];
        }
        
        // Find the logical street that contains this edge before removing it
        const logicalStreet = this.findLogicalStreetForEdge(edge);
        
        this.removeEdge(edge);
        this.removeEdge(edge.symmetric!);
        
        const newEdge1 = this.addEdge(fromNode, intersectionNode);
        const newEdge2 = this.addEdge(intersectionNode, toNode);
        
        const newEdges: Edge[] = [];
        
        // If the original edge was part of a logical street, add the new edges to the same street immediately
        // This preserves street continuity when existing streets are split by intersections
        if (logicalStreet && newEdge1 && newEdge2) {
            logicalStreet.addEdge(newEdge1);
            logicalStreet.addEdge(newEdge2);
        }
        else {
            // If not part of a logical street, return them for normal assignment
            if (newEdge1) newEdges.push(newEdge1);
            if (newEdge2) newEdges.push(newEdge2);
        }
        
        return newEdges;
    }

    private lineIntersection(line1Start: number[], line1End: number[], line2Start: number[], line2End: number[]): number[] | null {
        const x1 = line1Start[0], y1 = line1Start[1];
        const x2 = line1End[0], y2 = line1End[1];
        const x3 = line2Start[0], y3 = line2Start[1];
        const x4 = line2End[0], y4 = line2End[1];

        const denominator = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
        
        // Lines are parallel or coincident - use a more lenient tolerance
        if (Math.abs(denominator) < 1e-15) {
            return null;
        }
        
        const ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / denominator;
        const ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / denominator;
        
        // Check if intersection is within both line segments - use a small tolerance for floating point errors
        const tolerance = 1e-10;
        if (ua < -tolerance || ua > 1 + tolerance || ub < -tolerance || ub > 1 + tolerance) {
            return null;
        }
        
        // Calculate intersection point
        const x = x1 + ua * (x2 - x1);
        const y = y1 + ua * (y2 - y1);
        
        return [x, y];
    }

    private distance(point1: number[], point2: number[]): number {
        const dx = point2[0] - point1[0];
        const dy = point2[1] - point1[1];
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * Get all logical streets in the graph
     */
    getLogicalStreets(): LogicalStreet[] {
        return Array.from(this.logicalStreets.values());
    }

    getStreet(streetId: string): LogicalStreet | null {
        return this.logicalStreets.get(streetId) || null;
    }
    
    /**
     * Find the logical street that contains a given edge
     */
    findLogicalStreetForEdge(edge: Edge): LogicalStreet | null {
        for (const street of this.logicalStreets.values()) {
            if (street.hasEdge(edge)) {
                return street;
            }
        }
        return null;
    }
    
    /**
     * Create a new logical street
     */
    private createLogicalStreet(): LogicalStreet {
        const streetId = `street_${this.streetIdCounter++}`;
        //TODO: street widths should be configurable
        const street = new LogicalStreet(streetId, undefined, DEFAULT_STREET_WIDTH);
        this.logicalStreets.set(streetId, street);
        return street;
    }

    /**
     * Assign edges to logical streets based on connectivity and deflection angles
     */
    private assignNewEdgesToLogicalStreets(newEdges: Edge[]) {
        // Process edges in a way that avoids processing symmetric pairs multiple times
        const processedEdges = new Set<string>();
        
        for (const edge of newEdges) {
            const edgeKey = `${edge.from.id}-${edge.to.id}`;
            const reverseEdgeKey = `${edge.to.id}-${edge.from.id}`;
            
            // Skip if we've already processed this edge or its symmetric
            if (processedEdges.has(edgeKey) || processedEdges.has(reverseEdgeKey)) {
                continue;
            }
            
            processedEdges.add(edgeKey);
            processedEdges.add(reverseEdgeKey);
            
            this.assignEdgeToLogicalStreet(edge);
        }
    }

    /**
     * Assign a single edge to an appropriate logical street
     */
    private assignEdgeToLogicalStreet(edge: Edge) {
        // Check if this edge is already assigned to a logical street
        if (this.findLogicalStreetForEdge(edge)) {
            return;
        }

        // Try to find an existing logical street to continue from either end
        const fromContinuation = this.findLogicalStreetContinuation(edge, edge.from, true);
        const toContinuation = this.findLogicalStreetContinuation(edge, edge.to, false);

        if (fromContinuation && toContinuation && fromContinuation.street === toContinuation.street) {
            // Edge connects two parts of the same logical street - add it
            fromContinuation.street.addEdge(edge);
        }
        else if (fromContinuation && !toContinuation) {
            // Continue from the 'from' end
            fromContinuation.street.addEdge(edge);
        }
        else if (!fromContinuation && toContinuation) {
            // Continue from the 'to' end
            toContinuation.street.addEdge(edge);
        }
        else if (fromContinuation && toContinuation && fromContinuation.street !== toContinuation.street) {
            // Edge connects two different logical streets - merge them
            this.mergeLogicalStreets(fromContinuation.street, toContinuation.street);
            fromContinuation.street.addEdge(edge);
        }
        else {
            // No continuation found - create a new logical street
            const newStreet = this.createLogicalStreet();
            newStreet.addEdge(edge);
        }
    }

    /**
     * Find if a logical street can be continued from a given node
     */
    private findLogicalStreetContinuation(
        newEdge: Edge,
        node: Node,
        isFromNode: boolean
    ): { street: LogicalStreet; continuationEdge: Edge } | null {
        
        const nodeEdges = node.getOuterEdges().filter(e => 
            e !== newEdge && e !== newEdge.symmetric && e.symmetric !== newEdge
        );
        
        // Get the degree of the node (excluding the new edge we're adding)
        const nodeDegree = nodeEdges.length;

        if (nodeDegree === 0) {
            return null; // Dead end
        }

        // Find edges that are already part of logical streets
        const streetEdges = nodeEdges.filter(edge => {
            return this.findLogicalStreetForEdge(edge);
        });

        if (streetEdges.length === 0) {
            return null; // No existing streets to continue
        }

        // For degree 1 nodes (will become degree 2 with new edge) - simple continuation
        if (nodeDegree === 1) {
            const existingEdge = streetEdges[0];
            const existingStreet = this.findLogicalStreetForEdge(existingEdge);
            
            if (existingStreet && this.shouldContinueStreet(existingEdge, newEdge, node, isFromNode)) {
                return { street: existingStreet, continuationEdge: existingEdge };
            }
        }

        // For intersections (degree 2+), find the best continuation
        if (nodeDegree >= 2) {
            let bestContinuation: { street: LogicalStreet; continuationEdge: Edge; angle: number } | null = null;

            for (const streetEdge of streetEdges) {
                const street = this.findLogicalStreetForEdge(streetEdge);
                if (!street) continue;

                // Check if adding this edge would violate the "at most 2 edges per node" constraint
                if (this.wouldViolateLogicalStreetNodeConstraint(street, node)) {
                    continue; // Skip this potential continuation
                }

                const turnAngle = this.calculateTurnAngle(streetEdge, newEdge, node, isFromNode);
                
                // Use the final degree (after adding new edge) for determining max turn angle
                const finalDegree = nodeDegree + 1;
                let maxTurnAngle = this.getMaxTurnAngle(finalDegree);
                
                // Consider this a valid continuation if turn angle is reasonable
                if (turnAngle < maxTurnAngle) {
                    if (!bestContinuation || turnAngle < bestContinuation.angle) {
                        bestContinuation = { street, continuationEdge: streetEdge, angle: turnAngle };
                    }
                }
            }

            if (bestContinuation) {
                return { street: bestContinuation.street, continuationEdge: bestContinuation.continuationEdge };
            }
        }

        return null;
    }


    /**
     * Check if adding a new edge to a logical street would violate the constraint
     * that a logical street can have at most 2 edge pairs at any given node
     */
    private wouldViolateLogicalStreetNodeConstraint(street: LogicalStreet, node: Node): boolean {
        // Count unique edge pairs (not counting symmetric edges separately)
        const connectedEdges = new Set<string>();
        
        for (const edge of street.edges) {
            if (edge.from.id === node.id || edge.to.id === node.id) {
                // Create a normalized edge key that treats (A,B) and (B,A) as the same
                const edgeKey = [edge.from.id, edge.to.id].sort().join('-');
                connectedEdges.add(edgeKey);
            }
        }
        
        // If adding this new edge would result in more than 2 unique edge pairs at this node, 
        // it violates the constraint (a logical street should be a simple path through intersections)
        return connectedEdges.size >= 2;
    }

    /**
     * Calculate the turn angle between two edges at a shared node
     */
    private calculateTurnAngle(
        existingEdge: Edge,
        newEdge: Edge,
        sharedNode: Node,
        newEdgeIsFromNode: boolean
    ): number {
        // For street continuation, we need to calculate the turn angle:
        // - incomingDirection: the direction we came TO the shared node
        // - outgoingDirection: the direction we're going FROM the shared node
        
        let incomingDirection: number[];
        let outgoingDirection: number[];

        // Determine the incoming direction (how we arrived at the shared node)
        if (existingEdge.from.id === sharedNode.id) {
            // Existing edge starts at shared node, so we "came from" the 'to' node
            incomingDirection = [
                sharedNode.coordinates[0] - existingEdge.to.coordinates[0],
                sharedNode.coordinates[1] - existingEdge.to.coordinates[1]
            ];
        }
        else {
            // Existing edge ends at shared node, so we came from the 'from' node
            incomingDirection = [
                sharedNode.coordinates[0] - existingEdge.from.coordinates[0],
                sharedNode.coordinates[1] - existingEdge.from.coordinates[1]
            ];
        }

        // Determine the outgoing direction (where we're going from the shared node)
        if (newEdgeIsFromNode) {
            // New edge starts at shared node, so we're going to the 'to' node
            outgoingDirection = [
                newEdge.to.coordinates[0] - sharedNode.coordinates[0],
                newEdge.to.coordinates[1] - sharedNode.coordinates[1]
            ];
        }
        else {
            // New edge ends at shared node, so we're going to the 'from' node
            outgoingDirection = [
                newEdge.from.coordinates[0] - sharedNode.coordinates[0],
                newEdge.from.coordinates[1] - sharedNode.coordinates[1]
            ];
        }

        // Calculate the angle between the vectors
        const dot = incomingDirection[0] * outgoingDirection[0] + incomingDirection[1] * outgoingDirection[1];
        const incomingMag = Math.sqrt(incomingDirection[0] ** 2 + incomingDirection[1] ** 2);
        const outgoingMag = Math.sqrt(outgoingDirection[0] ** 2 + outgoingDirection[1] ** 2);
        
        if (incomingMag === 0 || outgoingMag === 0) {
            return Math.PI; // Invalid case
        }

        const cosAngle = dot / (incomingMag * outgoingMag);
        // Clamp to avoid numerical errors
        const clampedCos = Math.max(-1, Math.min(1, cosAngle));
        
        // The angle between vectors
        // For a straight continuation, vectors should be in same direction (angle = 0)
        // For a U-turn, vectors should be in opposite directions (angle = PI)
        const angle = Math.acos(clampedCos);
        
        return angle;
    }

    /**
     * Check if a street should continue based on turn angle
     */
    private shouldContinueStreet(
        existingEdge: Edge,
        newEdge: Edge,
        sharedNode: Node,
        newEdgeIsFromNode: boolean
    ): boolean {
        const turnAngle = this.calculateTurnAngle(existingEdge, newEdge, sharedNode, newEdgeIsFromNode);
        return turnAngle < Math.PI / 3; // 60 degrees maximum for continuation
    }

    /**
     * Get the maximum turn angle allowed for street continuation based on node degree
     */
    private getMaxTurnAngle(nodeDegree: number): number {
        if (nodeDegree <= 2) {
            return Math.PI / 3;
        }
        else if (nodeDegree === 3) {
            return Math.PI / 4;
        }
        else {
            return Math.PI / 6;
        }
    }

    private mergeLogicalStreets(street1: LogicalStreet, street2: LogicalStreet) {
        // Move all edges from street2 to street1
        for (const edge of street2.edges) {
            street1.addEdge(edge);
        }
        
        // Remove street2 from the map
        this.logicalStreets.delete(street2.id);
    }

    getStreetFeatureCollection(): FeatureCollection<LineString> {
        const processedEdges = new Set<string>();
        const features: Feature<LineString>[] = [];

        // Create a feature for each unique edge with logical street color
        this.edges.forEach(edge => {
            const edgeId = `${edge.from.id}-${edge.to.id}`;
            const reverseEdgeId = `${edge.to.id}-${edge.from.id}`;
            
            // Only process one direction of each edge
            if (!processedEdges.has(edgeId) && !processedEdges.has(reverseEdgeId)) {
                processedEdges.add(edgeId);
                processedEdges.add(reverseEdgeId);
                
                // Find the logical street for this edge
                const logicalStreet = this.findLogicalStreetForEdge(edge);
                
                features.push({
                    type: "Feature",
                    properties: {
                        logicalStreetId: logicalStreet?.id || null,
                        color: logicalStreet?.color || [255, 0, 0, 255]
                    },
                    geometry: {
                        type: "LineString",
                        coordinates: [edge.from.coordinates, edge.to.coordinates],
                    },
                });
            }
        });

        return featureCollection(features);
    }

    copy(): StreetGraph {
        const graphCopy = new StreetGraph();
        
        const processedEdges = new Set<string>();
        
        // We only need to process edges in one direction as addEdge creates both directions
        this.edges.forEach(edge => {
            const edgeKey = `${edge.from.id}-${edge.to.id}`;
            const reverseEdgeKey = `${edge.to.id}-${edge.from.id}`;
            
            // Skip if we've already processed this edge or its symmetric
            if (processedEdges.has(edgeKey) || processedEdges.has(reverseEdgeKey)) {
                return;
            }
            
            processedEdges.add(edgeKey);
            processedEdges.add(reverseEdgeKey);
            
            const fromNode = graphCopy.getNode(edge.from.coordinates);
            const toNode = graphCopy.getNode(edge.to.coordinates);
            graphCopy.addEdge(fromNode, toNode);
        });

        return graphCopy;
    }

    /**
     * Creates or get a Node.
     * If coordinates are very close to an existing node (within epsilon), returns the existing node.
     *
     * @param {number[]} coordinates - Coordinates of the node
     * @returns {Node} - The created or stored node
     */
    getNode(coordinates: number[]) {
        // First check for nearby nodes within epsilon
        for (const nodeId in this.nodes) {
            const existingNode = this.nodes[nodeId];
            if (this.pointsEqual(coordinates, existingNode.coordinates, EPSILON)) {
                return existingNode;
            }
        }

        // No nearby node found, create a new one
        const id = Node.buildId(coordinates);
        const node = this.nodes[id] = new Node(coordinates);
        return node;
    }

    /**
     * Adds an Edge.
     * Edges are added symmetrically, i.e. we add edge A->B and B->A.
     *
     * @param {Node} from - Node which starts the Edge
     * @param {Node} to - Node which ends the Edge
     */
    addEdge(from: Node, to: Node): Edge | undefined {
        if (this.edgeExists(from, to) || this.edgeExists(to, from)) {
            return undefined;
        }
        const edge = new Edge(from, to),
            symetricEdge = edge.getSymmetric();

        this.edges.push(edge);
        this.edges.push(symetricEdge);
        return edge;
    }

    constructor() {
        this.edges = []; //< {Edge[]} dirEdges

        // The key is the `id` of the Node (ie: coordinates.join(','))
        this.nodes = {};
        
        // Logical streets management
        this.logicalStreets = new Map();
        this.streetIdCounter = 0;
    }

    /**
     * Removes Dangle Nodes (nodes with grade 1).
     */
    deleteDangles() {
        Object.keys(this.nodes)
            .map((id) => this.nodes[id])
            .forEach((node) => this._removeIfDangle(node));
    }

    /**
     * Check if node is dangle, if so, remove it.
     *
     * It calls itself recursively, removing a dangling node might cause another dangling node
     *
     * @param {Node} node - Node to check if it's a dangle
     */
    _removeIfDangle(node: Node) {
        // As edges are directed and symetrical, we count only innerEdges
        if (node.innerEdges.length <= 1) {
            const outerNodes = node.getOuterEdges().map((e) => e.to);
            this.removeNode(node);
            outerNodes.forEach((n) => this._removeIfDangle(n));
        }
    }

    /**
     * Delete cut-edges (bridge edges).
     *
     * The graph will be traversed, all the edges will be labeled according the ring
     * in which they are. (The label is a number incremented by 1). Edges with the same
     * label are cut-edges.
     */
    deleteCutEdges() {
        this._computeNextCWEdges();
        this._findLabeledEdgeRings();

        // Cut-edges (bridges) are edges where both edges have the same label
        this.edges.forEach((edge) => {
            if (edge.label === edge.symmetric!.label) {
                this.removeEdge(edge.symmetric!);
                this.removeEdge(edge);
            }
        });
    }

    /**
     * Set the `next` property of each Edge.
     *
     * The graph will be transversed in a CW form, so, we set the next of the symetrical edge as the previous one.
     * OuterEdges are sorted CCW.
     *
     * @param {Node} [node] - If no node is passed, the function calls itself for every node in the Graph
     */
    _computeNextCWEdges(node?: Node) {
        if (typeof node === "undefined") {
            Object.keys(this.nodes).forEach((id) =>
                this._computeNextCWEdges(this.nodes[id])
            );
        }
        else {
            node.getOuterEdges().forEach((edge, i) => {
                node.getOuterEdge(
                    (i === 0 ? node.getOuterEdges().length : i) - 1
                ).symmetric!.next = edge;
            });
        }
    }

    /**
     * Computes the next edge pointers going CCW around the given node, for the given edgering label.
     *
     * This algorithm has the effect of converting maximal edgerings into minimal edgerings
     *
     * XXX: method literally transcribed from `geos::operation::polygonize::PolygonizeGraph::computeNextCCWEdges`,
     * could be written in a more javascript way.
     *
     * @param {Node} node - Node
     * @param {number} label - Ring's label
     */
    _computeNextCCWEdges(node: Node, label: number) {
        const edges = node.getOuterEdges();
        let firstOutDE, prevInDE;

        for (let i = edges.length - 1; i >= 0; --i) {
            let de = edges[i],
                sym = de.symmetric,
                outDE,
                inDE;

            if (de.label === label) outDE = de;

            if (sym!.label === label) inDE = sym;

            if (!outDE || !inDE)
                // This edge is not in edgering
                continue;

            if (inDE) prevInDE = inDE;

            if (outDE) {
                if (prevInDE) {
                    prevInDE.next = outDE;
                    prevInDE = undefined;
                }

                if (!firstOutDE) firstOutDE = outDE;
            }
        }

        if (prevInDE) prevInDE.next = firstOutDE;
    }

    /**
     * Finds rings and labels edges according to which rings are.
     *
     * The label is a number which is increased for each ring.
     *
     * @returns {Edge[]} edges that start rings
     */
    _findLabeledEdgeRings() {
        const edgeRingStarts: Edge[] = [];
        let label = 0;
        this.edges.forEach((edge) => {
            if (edge.label! >= 0) return;

            edgeRingStarts.push(edge);

            let e = edge;
            do {
                e.label = label;
                e = e.next!;
            } while (!edge.isEqual(e));

            label++;
        });

        return edgeRingStarts;
    }

    /**
     * Computes the EdgeRings formed by the edges in this graph.
     *
     * @returns {EdgeRing[]} - A list of all the EdgeRings in the graph.
     */
    getEdgeRings() {
        this._computeNextCWEdges();

        // Clear labels
        this.edges.forEach((edge) => {
            edge.label = undefined;
        });

        this._findLabeledEdgeRings().forEach((edge) => {
            // convertMaximalToMinimalEdgeRings
            this._findIntersectionNodes(edge).forEach((node) => {
                this._computeNextCCWEdges(node, edge.label!);
            });
        });

        const edgeRingList: EdgeRing[] = [];

        // find all edgerings
        this.edges.forEach((edge) => {
            if (edge.ring) return;
            edgeRingList.push(this._findEdgeRing(edge));
        });

        return edgeRingList;
    }

    /**
     * Find all nodes in a Maxima EdgeRing which are self-intersection nodes.
     *
     * @param {Node} startEdge - Start Edge of the Ring
     * @returns {Node[]} - intersection nodes
     */
    _findIntersectionNodes(startEdge: Edge) {
        const intersectionNodes = [];
        let edge = startEdge;
        do {
            // getDegree
            let degree = 0;
            edge.from.getOuterEdges().forEach((e) => {
                if (e.label === startEdge.label) ++degree;
            });

            if (degree > 1) intersectionNodes.push(edge.from);

            edge = edge.next!;
        } while (!startEdge.isEqual(edge));

        return intersectionNodes;
    }

    /**
     * Get the edge-ring which starts from the provided Edge.
     *
     * @param {Edge} startEdge - starting edge of the edge ring
     * @returns {EdgeRing} - EdgeRing which start Edge is the provided one.
     */
    _findEdgeRing(startEdge: Edge) {
        let edge = startEdge;
        const edgeRing = new EdgeRing();

        do {
            edgeRing.push(edge);
            edge.ring = edgeRing;
            edge = edge.next!;
        } while (!startEdge.isEqual(edge));

        return edgeRing;
    }

    /**
     * Removes a node from the Graph.
     *
     * It also removes edges asociated to that node
     * @param {Node} node - Node to be removed
     */
    removeNode(node: Node) {
        node.getOuterEdges().forEach((edge) => this.removeEdge(edge));
        node.innerEdges.forEach((edge) => this.removeEdge(edge));
        delete this.nodes[node.id];
    }

    /**
     * Remove edge from the graph and deletes the edge.
     *
     * @param {Edge} edge - Edge to be removed
     */
    removeEdge(edge: Edge) {
        // Remove edge from any logical street that contains it
        const logicalStreet = this.findLogicalStreetForEdge(edge);
        if (logicalStreet) {
            logicalStreet.removeEdge(edge);
        }
        
        this.edges = this.edges.filter((e) => !e.isEqual(edge));
        edge.deleteEdge();
    }

    /**
     * Returns the polygonization of a graph - the set of polygons enclosed by the edges.
     * @returns {FeatureCollection<Polygon>} - The polygonized graph
     */
    static polygonize(graph: StreetGraph): FeatureCollection<Polygon> {
        graph.deleteDangles();
        graph.deleteCutEdges();

        const holes: EdgeRing[] = [];
        const shells: EdgeRing[] = [];

        graph
            .getEdgeRings()
            .filter((edgeRing) => edgeRing.isValid())
            .forEach((edgeRing) => {
                if (edgeRing.isHole()) {
                    holes.push(edgeRing);
                }
                else {
                    shells.push(edgeRing);
                }
            });

        holes.forEach((hole) => {
            if (EdgeRing.findEdgeRingContaining(hole, shells)) {
                shells.push(hole);
            }
        });

        return featureCollection(shells.map((shell) => shell.toPolygon()));
    }

    /**
     * Returns blocks; polygons with information about which logical streets bound each polygon
     * @returns Blocks
     */
    static polygonizeToBlocks(graph: StreetGraph): Block[] {
        // Create a copy to avoid modifying the original graph
        // TODO: Figure out to handle cut edges and dangles in the original graph 
        const graphCopy = graph.copy();
        graphCopy.deleteDangles();
        graphCopy.deleteCutEdges();

        const holes: EdgeRing[] = [];
        const shells: EdgeRing[] = [];

        graphCopy
            .getEdgeRings()
            .filter((edgeRing) => edgeRing.isValid())
            .forEach((edgeRing) => {
                if (edgeRing.isHole()) {
                    holes.push(edgeRing);
                }
                else {
                    shells.push(edgeRing);
                }
            });

        holes.forEach((hole) => {
            if (EdgeRing.findEdgeRingContaining(hole, shells)) {
                shells.push(hole);
            }
        });

        // TODO: this is slow
        // For each shell, determine which logical streets bound it
        return shells.map((shell) => {
            const boundingStreets = new Set<LogicalStreet>();
            
            // Go through each edge in the ring and find its logical street
            shell.forEach((edge) => {
                // Find the corresponding edge in the original graph by coordinates
                const originalEdge = graph.edges.find(originalEdge => 
                    (originalEdge.from.id === edge.from.id && originalEdge.to.id === edge.to.id) ||
                    (originalEdge.from.id === edge.to.id && originalEdge.to.id === edge.from.id)
                );
                
                if (originalEdge) {
                    const logicalStreet = graph.findLogicalStreetForEdge(originalEdge);
                    if (logicalStreet) {
                        boundingStreets.add(logicalStreet);
                    }
                }
            });

            // Shrink to account for street widths
            // TODO: Properly handle variable street widths
            const blockPolygon = customBuffer(shell.toPolygon(), -(DEFAULT_STREET_WIDTH / 2), { units: 'meters' });

            return {
                polygon: blockPolygon! as Feature<Polygon>,
                boundingStreets: Array.from(boundingStreets),
                maxLotDepth: 60
            };
        });
    }

    /**
     * Find the nearest node within a given distance threshold
     * @param point - The point to search from
     * @param threshold - Maximum distance to consider
     * @returns The nearest node and distance, or null if none found
     */
    findNearestNode(point: number[], threshold: number): { node: Node; distance: number } | null {
        let nearestNode: Node | null = null;
        let minDistance = threshold;

        for (const nodeId in this.nodes) {
            const node = this.nodes[nodeId];
            const dist = this.distance(point, node.coordinates);
            if (dist < minDistance) {
                nearestNode = node;
                minDistance = dist;
            }
        }

        return nearestNode ? { node: nearestNode, distance: minDistance } : null;
    }

    /**
     * Find the nearest point on any edge within a given distance threshold
     * @param point - The point to search from
     * @param threshold - Maximum distance to consider
     * @returns The nearest point on an edge and distance, or null if none found
     */
    findNearestPointOnEdge(point: number[], threshold: number): { point: number[]; edge: Edge; distance: number } | null {
        let nearestPoint: number[] | null = null;
        let nearestEdge: Edge | null = null;
        let minDistance = threshold;

        // Check each unique edge (avoid duplicates from symmetric edges)
        const processedEdges = new Set<string>();

        for (const edge of this.edges) {
            const edgeKey = `${edge.from.id}-${edge.to.id}`;
            const reverseEdgeKey = `${edge.to.id}-${edge.from.id}`;
            
            if (processedEdges.has(edgeKey) || processedEdges.has(reverseEdgeKey)) {
                continue;
            }
            processedEdges.add(edgeKey);

            const closestPoint = this.pointToLineSegment(point, edge.from.coordinates, edge.to.coordinates);
            const dist = this.distance(point, closestPoint);
            
            if (dist < minDistance) {
                nearestPoint = closestPoint;
                nearestEdge = edge;
                minDistance = dist;
            }
        }

        return nearestPoint && nearestEdge ? { point: nearestPoint, edge: nearestEdge, distance: minDistance } : null;
    }

    /**
     * Find the closest point on a line segment to a given point
     * @param point - The point to project
     * @lineStart - Start of the line segment
     * @lineEnd - End of the line segment
     * @returns The closest point on the line segment
     */
    private pointToLineSegment(point: number[], lineStart: number[], lineEnd: number[]): number[] {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];
        
        if (dx === 0 && dy === 0) {
            // Line segment is actually a point
            return lineStart;
        }
        
        const t = Math.max(0, Math.min(1, 
            ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy)
        ));
        
        return [
            lineStart[0] + t * dx,
            lineStart[1] + t * dy
        ];
    }
}

export default StreetGraph;
