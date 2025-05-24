import {
    ClickEvent,
    FeatureCollection,
    GeoJsonEditMode,
    getPickedEditHandle,
    GuideFeatureCollection,
    LineString,
    ModeProps,
    PointerMoveEvent,
    Position,
    Tooltip
} from "@deck.gl-community/editable-layers";
import { distance } from '@turf/turf';
import Graph from '../ds/Graph';

export class DrawStreetMode extends GeoJsonEditMode {
    dist = 0;
    position: Position = null!;
    elems: Position[] = [];
    
    // Snapping properties
    private shiftPressed = false;
    private snapThreshold = 0.0002; // Distance threshold for snapping in map units
    private snapTarget: { point: Position; type: 'node' | 'edge' } | null = null;
    private graph: Graph | null = null;
    
    // Track snap-to-edge/snap-to-vertex state for each point in the current line string
    private pointSnappingStates: boolean[] = [];

    constructor(graph?: Graph) {
        super();
        this.graph = graph || null;
        
        // Bind keyboard event handlers
        this.handleKeyDownGlobal = this.handleKeyDownGlobal.bind(this);
        this.handleKeyUpGlobal = this.handleKeyUpGlobal.bind(this);
        
        // Add keyboard event listeners
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', this.handleKeyDownGlobal);
            window.addEventListener('keyup', this.handleKeyUpGlobal);
        }
    }

    cleanup() {
        // Remove keyboard event listeners
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.handleKeyDownGlobal);
            window.removeEventListener('keyup', this.handleKeyUpGlobal);
        }
    }

    setGraph(graph: Graph) {
        this.graph = graph;
    }

    resetClickSequence() {
        super.resetClickSequence();
        this.pointSnappingStates = [];
    }

    private handleKeyDownGlobal(event: KeyboardEvent) {
        if (event.key === 'Shift') {
            this.shiftPressed = true;
        }
    }

    private handleKeyUpGlobal(event: KeyboardEvent) {
        if (event.key === 'Shift') {
            this.shiftPressed = false;
        }
    }

    handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
        const { picks } = event;
        const clickedEditHandle = getPickedEditHandle(picks);

        let positionAdded = false;
        let snappedPosition = event.mapCoords;
        let wasSnappingEnabled = false;
        
        if (!clickedEditHandle) {
            // Record whether snapping was enabled for this point
            wasSnappingEnabled = !this.shiftPressed;
            
            // Get the snapped position if snapping is enabled
            snappedPosition = this.graph ? this.getSnappedPosition(event.mapCoords, this.graph) : event.mapCoords;
            
            // Don't add another point right next to an existing one
            this.addClickSequence({ ...event, mapCoords: snappedPosition });
            
            // Track the snapping state for this point
            this.pointSnappingStates.push(wasSnappingEnabled);
            
            positionAdded = true;
        }
        const clickSequence = this.getClickSequence();

        // If the pointer is in an editable state, recalculate the info draw
        if (!clickedEditHandle) {
            this.calculateInfoDraw(clickSequence);
        }

        if (
            clickSequence.length > 1 &&
            clickedEditHandle &&
            Array.isArray(clickedEditHandle.properties.positionIndexes) &&
            clickedEditHandle.properties.positionIndexes[0] === clickSequence.length - 1
        ) {
            this.handleNewStreet(props, clickSequence);
        }
        else if (positionAdded) {
            // new tentative point - use the same snapped position we calculated above
            props.onEdit({
                updatedData: props.data,
                editType: 'addTentativePosition',
                editContext: {
                    position: snappedPosition
                }
            });
        }
    }

    handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
        const { key } = event;
        
        if (key === 'Enter') {
            this.handleNewStreet(props, this.getClickSequence());
        }
        else if (key === 'Escape') {
            this.resetClickSequence();
            props.onEdit({
                updatedData: props.data,
                editType: 'cancelFeature',
                editContext: {}
            });
        }
    }

    handleNewStreet(props: ModeProps<FeatureCollection>, clickSequence: Position[]) {
        // Reset tooltip distance
        this.dist = 0;

        if (clickSequence.length < 2) {
            this.resetClickSequence();
            return;
        }

        // Create a LineString from the click sequence
        const newStreetGeometry: LineString = {
            type: 'LineString',
            coordinates: clickSequence
        };
        
        this.resetClickSequence();

        const editAction = this.getAddFeatureAction(newStreetGeometry, {
            type: 'FeatureCollection',
            features: []
        });

        if (editAction) {
            props.onEdit(editAction);
        }
    }

    getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
        const { lastPointerMoveEvent } = props;
        const clickSequence = this.getClickSequence();

        const lastCoords = lastPointerMoveEvent ? [lastPointerMoveEvent.mapCoords] : [];

        const guides: GuideFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        let tentativeFeature;
        if (clickSequence.length > 0) {
            // Use snapped position for the tentative line if snapping is active
            let finalCoords = lastCoords;
            if (lastPointerMoveEvent && this.graph && this.snapTarget && !this.shiftPressed) {
                finalCoords = [this.snapTarget.point];
            }
            
            tentativeFeature = {
                type: 'Feature',
                properties: {
                    guideType: 'tentative'
                },
                geometry: {
                    type: 'LineString',
                    coordinates: [...clickSequence, ...finalCoords]
                }
            };
        }

        if (tentativeFeature) {
            guides.features.push(tentativeFeature as any);
        }

        const editHandles: any[] = clickSequence.map((clickedCoord, index) => ({
            type: 'Feature',
            properties: {
                guideType: 'editHandle',
                editHandleType: 'existing',
                featureIndex: -1,
                positionIndexes: [index]
            },
            geometry: {
                type: 'Point',
                coordinates: clickedCoord
            }
        }));

        guides.features.push(...editHandles);
        return guides;
    }

    handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
        // Update snap target for visual feedback
        if (this.graph) {
            this.snapTarget = this.findSnapTarget(event.mapCoords, this.graph);
        }
        
        props.onUpdateCursor('cell');
    }

    calculateInfoDraw(clickSequence: string | any[]) {
        if (clickSequence.length > 1) {
            this.position = clickSequence[clickSequence.length - 1];

            this.dist = distance(
                clickSequence[clickSequence.length - 2],
                clickSequence[clickSequence.length - 1]
            );
        }
    }

    getTooltips(props: ModeProps<FeatureCollection>): Tooltip[] {
        return this._getTooltips({
            modeConfig: props.modeConfig,
            dist: this.dist
        });
    }

    _getTooltips = this.memoize((args: { modeConfig?: any, dist: number }): Tooltip[] => {
        let tooltips: Tooltip[] = [];
        const { formatTooltip } = args.modeConfig || {};
        let text;
        if (args.dist) {
            if (formatTooltip) {
                text = formatTooltip(args.dist);
            }
            else {
                // Distance between the last two tentative points
                text = `${(args.dist * 1000).toFixed(2)} m`;
            }

            tooltips = [
                {
                    position: [...this.position, 100],
                    text
                }
            ];
        }
        return tooltips;
    });
    
    private isEqual(a: any, b: any) {
        if (a === b) {
            return true;
        }
        if (Array.isArray(a)) {
            // Special treatment for arrays: compare 1-level deep
            // This is to support equality of matrix/coordinate props
            const len = a.length;
            if (!b || b.length !== len) {
                return false;
            }
    
            for (let i = 0; i < len; i++) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    
    private memoize(compute: Function) {
        let cachedArgs: Record<string, any> = {};
        let cachedResult: any;
    
        return (args: any) => {
            for (const key in args) {
                if (!this.isEqual(args[key], cachedArgs[key])) {
                    cachedResult = compute(args);
                    cachedArgs = args;
                    break;
                }
            }
            return cachedResult;
        };
    }

    /**
     * Find snap targets near the given position
     * @param position - The position to check for snap targets
     * @param graph - The street graph to search in
     * @returns Snap target information or null
     */
    private findSnapTarget(position: Position, graph: Graph): { point: Position; type: 'node' | 'edge' } | null {
        if (!graph) return null;

        // First check for nearby nodes (endpoints have higher priority)
        const nearestNode = graph.findNearestNode(position, this.snapThreshold);
        if (nearestNode) {
            return {
                point: nearestNode.node.coordinates as Position,
                type: 'node'
            };
        }

        // Then check for nearby edges
        const nearestEdgePoint = graph.findNearestPointOnEdge(position, this.snapThreshold);
        if (nearestEdgePoint) {
            return {
                point: nearestEdgePoint.point as Position,
                type: 'edge'
            };
        }

        return null;
    }

    /**
     * Get the effective click position, accounting for snapping
     * @param originalPosition - The original click position
     * @param graph - The street graph to snap to
     * @returns The final position to use (snapped or original)
     */
    private getSnappedPosition(originalPosition: Position, graph: Graph): Position {
        // Don't snap if Shift is held down
        if (this.shiftPressed) {
            this.snapTarget = null;
            return originalPosition;
        }

        const snapTarget = this.findSnapTarget(originalPosition, graph);
        this.snapTarget = snapTarget;
        
        return snapTarget ? snapTarget.point : originalPosition;
    }

    /**
     * Get the per-point snapping states for the current line string
     * @returns Array of boolean values indicating snapping state for each point
     */
    public getPointSnappingStates(): boolean[] {
        return [...this.pointSnappingStates];
    }
}