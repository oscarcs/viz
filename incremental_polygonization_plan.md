The following is an analysis of how to make `StreetGraph.PolygonizeToBlocks()` incremental.

## Current Performance Bottlenecks

The current polygonizeToBlocks() method has several expensive operations that are performed from scratch every time:

1. Graph copying (`graph.copy()`) - Creates a complete copy of all nodes and edges
2. Dangle and cut-edge deletion - Modifies the copied graph structure
3. Edge ring computation - Computes all polygonal rings from the modified graph
4. Polygon generation - Creates polygon features for each ring
5. Logical street mapping - For each edge in each ring, finds the corresponding edge in the original graph
6. Buffering - Applies street width buffering to each polygon

## Key Insights for Incremental Implementation

### 1. Change Detection Requirements
To make this incremental, we need to track:
- Added edges/nodes: New streets or intersections
- Removed edges/nodes: Deleted streets or intersections
- Modified logical streets: Changes to street assignments
- Topology changes: Any change that affects the ring structure

### 2. Impact Analysis
When edges are added/removed/modified:
- Local impact: Only rings that contain the modified edges are affected
- Cascading impact: Changes can affect neighboring rings due to:
    - Dangle deletion (can cause chain reactions)
    - Cut-edge deletion (can split or merge rings)
    - New intersections (can split existing rings)

### 3. Caching Opportunities
- EdgeRing caching: Store computed rings with their constituent edges
- Block caching: Cache computed blocks with their bounding edges
- Dependency tracking: Map which blocks depend on which edges

## Proposed Incremental Strategy

### Phase 1: Change Tracking
Add change tracking to StreetGraph:
```ts
interface GraphChange {
  type: 'edge_added' | 'edge_removed' | 'node_added' | 'node_removed';
  edge?: Edge;
  node?: Node;
  timestamp: number;
}

class StreetGraph {
  private changes: GraphChange[] = [];
  private lastPolygonizationTimestamp: number = 0;
  
  // Track all changes since last polygonization
}
```

### Phase 2: Affected Region Detection
```ts
interface AffectedRegion {
  nodes: Set<Node>;
  edges: Set<Edge>;  
  rings: Set<EdgeRing>; // Previously computed rings that may be invalid
}

private computeAffectedRegion(changes: GraphChange[]): AffectedRegion {
  // Analyze changes and compute the minimal region that needs recomputation
  // Include neighbors due to dangle/cut-edge propagation
}
```

### Phase 3: Incremental Ring Computation
```ts
interface CachedBlock {
  block: Block;
  contributingEdges: Set<string>; // Edge IDs that form this block
  lastUpdated: number;
}

private cachedBlocks: Map<string, CachedBlock> = new Map();

static polygonizeToBlocksIncremental(
  graph: StreetGraph, 
  previousBlocks?: Block[]
): { blocks: Block[], changedBlocks: Block[], removedBlocks: Block[] } {
  // 1. Get changes since last call
  // 2. Compute affected region
  // 3. Invalidate cached blocks in affected region
  // 4. Recompute only affected blocks
  // 5. Return full block list + change delta
}
```

### Phase 4: Optimization Strategies
1. Spatial Indexing: Use spatial index to quickly find which blocks are affected by changes in a region
2. Incremental Dangle/Cut-edge Handling: Instead of global deletion, only process changes in affected regions
3. Ring Stability: Maintain stable ring IDs so unchanged rings can be reused
4. Buffering Cache: Cache buffered polygons since they're expensive to compute

## Implementation Complexity

### High Priority (Essential):
- Change tracking in graph modification methods
- Affected region computation
- Incremental ring invalidation

### Medium Priority (Performance):
- Cached block storage with dependency tracking
- Spatial indexing for fast affected region queries

### Low Priority (Optimization):
- Incremental dangle/cut-edge processing
- Buffering result caching