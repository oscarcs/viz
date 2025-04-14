import {
    ClickEvent,
    FeatureCollection,
    getPickedEditHandle,
    GuideFeatureCollection,
    LineString,
    ModeProps,
    PointerMoveEvent,
    Position,
    Tooltip
} from "@deck.gl-community/editable-layers";
import { distance, lineIntersect } from '@turf/turf';
import { MapData, MapDataEditMode } from "./map-data-edit-mode";

interface Intersection {
    point: Position;
    distance: number;
}

export class DrawStreetMode extends MapDataEditMode {
    dist = 0;
    position: Position = null!;
    elems: Position[] = [];

    handleClick(event: ClickEvent, props: ModeProps<MapData>) {
        const { picks } = event;
        const clickedEditHandle = getPickedEditHandle(picks);

        let positionAdded = false;
        if (!clickedEditHandle) {
            // Don't add another point right next to an existing one
            this.addClickSequence(event);
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
            // new tentative point
            props.onEdit({
                // data is the same
                updatedData: props.data,
                editType: 'addTentativePosition',
                editContext: {
                    position: event.mapCoords
                }
            });
        }
    }

    handleKeyUp(event: KeyboardEvent, props: ModeProps<MapData>) {
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

    handleNewStreet(props: ModeProps<MapData>, clickSequence: Position[]) {
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

        // Find intersections with existing streets
        // const existingStreets = props.data.streets || { type: 'FeatureCollection', features: [] };
        // const intersections = this.findIntersections(newStreetGeometry, existingStreets);
        
        // Add new points at intersections to the click sequence
        // const augmentedClickSequence = this.insertIntersectionPoints(clickSequence, intersections);
        
        // Add nodes and edges to the graph (using parent class method)
        this.addStreetToGraph(props, clickSequence);
        
        this.resetClickSequence();

        props.onEdit({
            updatedData: {
                streetGraph: props.data.streetGraph,
            },
            editType: 'addFeature',
            editContext: {
                // feature: {
                //     type: 'Feature',
                //     properties: {},
                //     geometry: newStreetGeometry
                // }
            }
        });
    }

    getGuides(props: ModeProps<MapData>): GuideFeatureCollection {
        const { lastPointerMoveEvent } = props;
        const clickSequence = this.getClickSequence();

        const lastCoords = lastPointerMoveEvent ? [lastPointerMoveEvent.mapCoords] : [];

        const guides: GuideFeatureCollection = {
            type: 'FeatureCollection',
            features: []
        };

        let tentativeFeature;
        if (clickSequence.length > 0) {
            tentativeFeature = {
                type: 'Feature',
                properties: {
                    guideType: 'tentative'
                },
                geometry: {
                    type: 'LineString',
                    coordinates: [...clickSequence, ...lastCoords]
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

    handlePointerMove(event: PointerMoveEvent, props: ModeProps<MapData>) {
        props.onUpdateCursor('crosshair');
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

    getTooltips(props: ModeProps<MapData>): Tooltip[] {
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
     * Finds all intersections between a new street and existing streets
     */
    private findIntersections(newStreet: LineString, existingStreets: FeatureCollection): Intersection[] {
        if (!existingStreets.features || existingStreets.features.length === 0) {
            return [];
        }

        const segmentStart = newStreet.coordinates[0];
        const intersectionPoints: Intersection[] = [];

        for (const feature of existingStreets.features) {
            if (feature.geometry.type !== 'LineString') {
                continue;
            }

            intersectionPoints.push(...lineIntersect(newStreet, feature.geometry as LineString).features.map((intersection: any) => {
                return {
                    point: intersection.geometry.coordinates,
                    distance: distance(segmentStart, intersection.geometry.coordinates)
                };
            }));
        }

        // Sort intersections by distance from start
        return intersectionPoints.sort((a, b) => a.distance - b.distance);
    }

    /**
     * Inserts intersection points into the click sequence
     */
    private insertIntersectionPoints(clickSequence: Position[], intersections: Intersection[]): Position[] {
        if (intersections.length === 0) {
            return clickSequence;
        }

        const result: Position[] = [];
        let lastPoint = clickSequence[0];
        result.push(lastPoint);

        for (let i = 1; i < clickSequence.length; i++) {
            const currentPoint = clickSequence[i];
            const segment = {
                type: 'LineString',
                coordinates: [lastPoint, currentPoint]
            } as LineString;

            // Find intersections on this segment
            const segmentIntersections = intersections.filter(ip => {
                // Check if the intersection falls on this line segment
                const d1 = distance(lastPoint, ip.point);
                const d2 = distance(ip.point, currentPoint);
                const segmentLength = distance(lastPoint, currentPoint);
                
                // Allow small error due to floating point precision
                return Math.abs(d1 + d2 - segmentLength) < 0.000001;
            }).sort((a, b) => distance(lastPoint, a.point) - distance(lastPoint, b.point));

            // Add intersection points
            for (const intersection of segmentIntersections) {
                if (!this.isSamePoint(result[result.length - 1], intersection.point)) {
                    result.push(intersection.point);
                }
            }

            // Add the endpoint
            if (!this.isSamePoint(result[result.length - 1], currentPoint)) {
                result.push(currentPoint);
            }

            lastPoint = currentPoint;
        }

        return result;
    }
}

