import {
    EditAction,
    ClickEvent,
    PointerMoveEvent,
    StartDraggingEvent,
    StopDraggingEvent,
    DraggingEvent,
    Pick,
    Tooltip,
    ModeProps,
    GuideFeatureCollection,
    FeatureCollection,
    Geometry,
    Position,
    EditMode,
    FeatureWithProps,
    Point,
} from '@deck.gl-community/editable-layers';
import Graph from '../ds/Graph';
export type MapDataEditAction = EditAction<MapData>;

type TentativeFeature = FeatureWithProps<
    Geometry,
    {
        guideType: 'tentative';
        shape?: string;
    }
>;

type EditHandleType =
  | 'existing'
  | 'intermediate'
  | 'snap-source'
  | 'snap-target'
  | 'scale'
  | 'rotate';

type EditHandleFeature = FeatureWithProps<
  Point,
  {
    guideType: 'editHandle';
    editHandleType: EditHandleType;
    featureIndex: number;
    positionIndexes?: number[];
    shape?: string;
  }
>;

const DEFAULT_GUIDES: GuideFeatureCollection = {
    type: 'FeatureCollection',
    features: []
};
const DEFAULT_TOOLTIPS: Tooltip[] = [];

export interface MapData {
    streetGraph: Graph;
}

export class MapDataEditMode implements EditMode<MapData, GuideFeatureCollection> {
    _clickSequence: Position[] = [];

    getGuides(props: ModeProps<MapData>): GuideFeatureCollection {
        return DEFAULT_GUIDES;
    }

    getTooltips(props: ModeProps<MapData>): Tooltip[] {
        return DEFAULT_TOOLTIPS;
    }

    getClickSequence(): Position[] {
        return this._clickSequence;
    }

    addClickSequence({ mapCoords }: ClickEvent): void {
        this._clickSequence.push(mapCoords);
    }

    resetClickSequence(): void {
        this._clickSequence = [];
    }

    getTentativeGuide(props: ModeProps<MapData>): TentativeFeature | null | undefined {
        const guides = this.getGuides(props);
        return guides.features.find(
            (f) => f.properties && f.properties.guideType === 'tentative'
        ) as TentativeFeature;
    }

    getNonGuidePicks(picks: Pick[]): Pick[] {
        return picks && picks.filter((pick) => !pick.isGuide);
    }

    getPickedEditHandles(picks: Pick[] | null | undefined): EditHandleFeature[] {
        const handles =
          (picks &&
            picks
              .filter((pick) => pick.isGuide && pick.object.properties.guideType === 'editHandle')
              .map((pick) => pick.object)) ||
          [];
      
        return handles;
    }

    isSelectionPicked(picks: Pick[], props: ModeProps<MapData>): boolean {
        if (!picks.length) return false;
        const pickedFeatures = this.getNonGuidePicks(picks).map(({ index }) => index);
        const pickedHandles = this.getPickedEditHandles(picks).map(
            ({ properties }) => properties.featureIndex
        );
        const pickedIndexes = new Set([...pickedFeatures, ...pickedHandles]);
        return props.selectedIndexes.some((index) => pickedIndexes.has(index));
    }

    createTentativeFeature(props: ModeProps<MapData>): TentativeFeature | null {
        return null;
    }

    handleClick(event: ClickEvent, props: ModeProps<MapData>): void { }
    handlePointerMove(event: PointerMoveEvent, props: ModeProps<MapData>): void {
        const tentativeFeature = this.createTentativeFeature(props);
        if (tentativeFeature) {
            props.onEdit({
                updatedData: props.data,
                editType: 'updateTentativeFeature',
                editContext: {
                    feature: tentativeFeature
                }
            });
        }
    }
    handleStartDragging(event: StartDraggingEvent, props: ModeProps<MapData>): void { }
    handleStopDragging(event: StopDraggingEvent, props: ModeProps<MapData>): void { }
    handleDragging(event: DraggingEvent, props: ModeProps<MapData>): void { }

    handleKeyUp(event: KeyboardEvent, props: ModeProps<MapData>): void {
        if (event.key === 'Escape') {
            this.resetClickSequence();
            props.onEdit({
                // Because the new drawing feature is dropped, so the data will keep as the same.
                updatedData: props.data,
                editType: 'cancelFeature',
                editContext: {}
            });
        }
    }

    /**
     * Adds a street (sequence of points) to the Graph
     */
    addStreetToGraph(props: ModeProps<MapData>, points: Position[]): void {
        if (!props.data.streetGraph || points.length < 2) {
            return;
        }

        // Add each segment as an edge in the graph
        for (let i = 0; i < points.length - 1; i++) {
            const fromNode = props.data.streetGraph.getNode(points[i]);
            const toNode = props.data.streetGraph.getNode(points[i + 1]);
            
            // Check if this edge already exists
            const existingEdges = fromNode.getOuterEdges();
            const edgeExists = existingEdges.some(edge => 
                this.isSamePoint(edge.to.coordinates, toNode.coordinates)
            );

            // Only add new edges
            if (!edgeExists) {
                props.data.streetGraph.addEdge(fromNode, toNode);
            }
        }
    }
    
    /**
     * Utility method to check if two points are the same
     */
    isSamePoint(a: Position, b: Position): boolean {
        return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
    }
}

export function getIntermediatePosition(position1: Position, position2: Position): Position {
    const intermediatePosition: Position = [
        (position1[0] + position2[0]) / 2.0,
        (position1[1] + position2[1]) / 2.0
    ];

    return intermediatePosition;
}
