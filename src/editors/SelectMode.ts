import {
    FeatureCollection,
    GeoJsonEditMode,
    ModeProps,
    PointerMoveEvent
} from "@deck.gl-community/editable-layers";
import StreetGraph from '../ds/StreetGraph';

export class SelectMode extends GeoJsonEditMode {
    private graph: StreetGraph | null = null;
    
    constructor(graph?: StreetGraph) {
        super();
        this.graph = graph || null;
    }
    
    setGraph(graph: StreetGraph) {
        this.graph = graph;
    }
    
    handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
        if (!this.graph) return;
        
        // Update cursor based on whether we're hovering over a street
        const nearestEdgePoint = this.graph.findNearestPointOnEdge(event.mapCoords, 0.001);
        
        if (nearestEdgePoint) {
            props.onUpdateCursor('pointer');
        }
        else {
            props.onUpdateCursor('default');
        }
    }
}
