import { Node } from "./Node";
import { Edge } from "./Edge";
import { EdgeRing } from "./EdgeRing";
import { flattenEach, coordReduce, featureOf, AllGeoJSON, featureCollection } from "@turf/turf";
import {
    FeatureCollection,
    LineString,
    MultiLineString,
    Feature,
    Polygon,
} from "geojson";

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
 * Represents a planar graph of edges and nodes that can be used to compute a polygonization.
 * This graph is directed (both directions are created)
 */
class Graph {
    private nodes: { [id: string]: Node };
    private edges: Edge[];

    /**
     * Creates a graph from a GeoJSON.
     *
     * @param {FeatureCollection<LineString>} geoJson - it must comply with the restrictions detailed in the index
     * @returns {Graph} - The newly created graph
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

        const graph = new Graph();
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
     */
    addLineString(street: LineString) {
        if (!street || !street.coordinates || street.coordinates.length < 2) {
            return;
        }

        for (let i = 0; i < street.coordinates.length - 1; i++) {
            const start = street.coordinates[i];
            const end = street.coordinates[i + 1];
            
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
            for (const inter of intersections) {
                const intersectionNode = this.getNode(inter.point);
                this.splitEdgeAtIntersection(inter.edge, intersectionNode);
            }

            // Add edges between consecutive split points
            for (let j = 0; j < splitPoints.length - 1; j++) {
                const fromNode = this.getNode(splitPoints[j]);
                const toNode = this.getNode(splitPoints[j + 1]);
                
                if (!this.edgeExists(fromNode, toNode)) {
                    this.addEdge(fromNode, toNode);
                }
            }
        }
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
    private splitEdgeAtIntersection(edge: Edge, intersectionNode: Node) {
        const fromNode = edge.from;
        const toNode = edge.to;
        
        // Skip if the edge already connects to this intersection
        if (fromNode.id === intersectionNode.id || toNode.id === intersectionNode.id) {
            return;
        }
        
        this.removeEdge(edge);
        this.removeEdge(edge.symmetric!);
        
        this.addEdge(fromNode, intersectionNode);
        this.addEdge(intersectionNode, toNode);
    }

    private lineIntersection(line1Start: number[], line1End: number[], line2Start: number[], line2End: number[]): number[] | null {
        const x1 = line1Start[0], y1 = line1Start[1];
        const x2 = line1End[0], y2 = line1End[1];
        const x3 = line2Start[0], y3 = line2Start[1];
        const x4 = line2End[0], y4 = line2End[1];

        const denominator = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
        
        // Lines are parallel or coincident
        if (Math.abs(denominator) < 1e-10) {
            return null;
        }
        
        const ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / denominator;
        const ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / denominator;
        
        // Check if intersection is within both line segments
        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) {
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

    getStreetFeatureCollection(): FeatureCollection<LineString> {
        const features: Feature<LineString>[] = this.edges.map((edge) => ({
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [edge.from.coordinates, edge.to.coordinates],
            },
        }));
        return featureCollection(features);
    }

    copy(): Graph {
        const graphCopy = new Graph();
        
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
    addEdge(from: Node, to: Node) {
        if (this.edgeExists(from, to) || this.edgeExists(to, from)) {
            return;
        }
        const edge = new Edge(from, to),
            symetricEdge = edge.getSymmetric();

        this.edges.push(edge);
        this.edges.push(symetricEdge);
    }

    constructor() {
        this.edges = []; //< {Edge[]} dirEdges

        // The key is the `id` of the Node (ie: coordinates.join(','))
        this.nodes = {};
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
        } else {
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
        this.edges = this.edges.filter((e) => !e.isEqual(edge));
        edge.deleteEdge();
    }

    /**
     * Returns the polygonization of a graph - the set of polygons enclosed by the edges.
     * Note that this operation is destructive on the graph - it will remove dangles and cut edges.
     * @returns {FeatureCollection<Polygon>} - The polygonized graph
     */
    static polygonize(graph: Graph): FeatureCollection<Polygon> {
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

export { Graph };
export default Graph;
