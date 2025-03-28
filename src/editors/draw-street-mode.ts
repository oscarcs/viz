import {
    ClickEvent,
    FeatureCollection,
    GeoJsonEditMode,
    getPickedEditHandle,
    GuideFeatureCollection,
    EditAction,
    LineString,
    ModeProps,
    PointerMoveEvent,
    Position,
    Tooltip
} from "@deck.gl-community/editable-layers";
import { distance, lineIntersect } from '@turf/turf';

interface Intersection {
    point: Position;
    distance: number;
}
export class DrawStreetMode extends GeoJsonEditMode {
    dist = 0;
    position: Position = null!;
    
    elems: Position[] = [];
    
    handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
        const { picks } = event;
        const clickedEditHandle = getPickedEditHandle(picks);

        let positionAdded = false;
        if (!clickedEditHandle) {
            // Don't add another point right next to an existing one
            this.addClickSequence(event);
            positionAdded = true;
        }
        const clickSequence = this.getClickSequence();

        // check if the pointer is on editable state calculate the distance of new point
        if (!clickedEditHandle) {
            this.calculateInfoDraw(clickSequence);
        }

        if (
            clickSequence.length > 1 &&
            clickedEditHandle &&
            Array.isArray(clickedEditHandle.properties.positionIndexes) &&
            clickedEditHandle.properties.positionIndexes[0] === clickSequence.length - 1
        ) {
            // They clicked the last point (or double-clicked), so add the LineString
            // reset distance
            this.dist = 0;
            const lineStringToAdd: LineString = {
                type: 'LineString',
                coordinates: [...clickSequence]
            };

            this.resetClickSequence();

            // Process street intersections
            const streetSegments = this.processStreetIntersections(lineStringToAdd, props.data);
            const featuresToAdd: FeatureCollection = {
                type: 'FeatureCollection',
                features: streetSegments.map(segment => ({
                    type: 'Feature',
                    properties: {},
                    geometry: segment
                }))
            }
            
            let currentData = props.data;
            const editAction = this.getAddManyFeaturesAction(featuresToAdd, currentData);
            if (editAction) {
                props.onEdit(editAction);
                currentData = editAction.updatedData;
            }
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

    handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
        const { key } = event;
        if (key === 'Enter') {
            const clickSequence = this.getClickSequence();
            if (clickSequence.length > 1) {
                const lineStringToAdd: LineString = {
                    type: 'LineString',
                    coordinates: [...clickSequence]
                };

                this.resetClickSequence();
                
                // Process street intersections
                const streetSegments = this.processStreetIntersections(lineStringToAdd, props.data);
                const featuresToAdd: FeatureCollection = {
                    type: 'FeatureCollection',
                    features: streetSegments.map(segment => ({
                        type: 'Feature',
                        properties: {},
                        geometry: segment
                    }))
                }
                
                let currentData = props.data;
                const editAction = this.getAddManyFeaturesAction(featuresToAdd, currentData);
                if (editAction) {
                    props.onEdit(editAction);
                    currentData = editAction.updatedData;
                }
            }
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

    handlePointerMove(_: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
        props.onUpdateCursor('cell');
    }

    getTooltips(props: ModeProps<FeatureCollection>): Tooltip[] {
        return this._getTooltips({
            modeConfig: props.modeConfig,
            dist: this.dist
        });
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

    private getModifyExistingFeaturesAction(updatedData: FeatureCollection): EditAction<FeatureCollection> {
        return {
            updatedData,
            editType: 'addFeature',
            editContext: null
        };
    }

    private processStreetIntersections(newStreet: LineString, existingStreets: FeatureCollection): LineString[] {
        if (!existingStreets.features || existingStreets.features.length === 0) {
            return [newStreet];
        }

        const segmentStart = newStreet.coordinates[0];
        const intersectionPoints: { point: Position, distance: number }[] = [];

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

        const segments = this.splitLineStringAtIntersections(newStreet, intersectionPoints);

        return segments;
    }

    private splitLineStringAtIntersections(lineString: LineString, intersections: Intersection[]): LineString[] {
        if (intersections.length === 0) {
            return [lineString];
        }

        // Sort intersections by distance from the start of the line
        intersections.sort((a, b) => a.distance - b.distance);

        const coordinates = lineString.coordinates;
        const segments: LineString[] = [];
        
        // Start with the first point of the linestring
        let currentSegment: Position[] = [coordinates[0]];
        let lastIntersection: Position | null = null;

        // Process each segment in the original linestring
        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            
            // Find intersections on this segment
            const segmentIntersections = intersections
                .filter(ip => {
                    // Check if the intersection falls on this line segment
                    const d1 = distance(start, ip.point);
                    const d2 = distance(ip.point, end);
                    const segmentLength = distance(start, end);
                    
                    // Allow small error due to floating point precision
                    return Math.abs(d1 + d2 - segmentLength) < 0.000001;
                })
                .sort((a, b) => distance(start, a.point) - distance(start, b.point));
   
            // Process each intersection on this segment
            for (const intersection of segmentIntersections) {
                // Skip if this is the same as our last point
                if (lastIntersection && this.isSamePoint(lastIntersection, intersection.point)) {
                    continue;
                }
                
                // Add intersection to current segment
                currentSegment.push(intersection.point);
                
                // Create segment and start a new one
                segments.push({
                    type: 'LineString',
                    coordinates: [...currentSegment]
                });
                
                currentSegment = [intersection.point];
                lastIntersection = intersection.point;
            }
            
            // Add the endpoint of this segment
            if (!lastIntersection || !this.isSamePoint(lastIntersection, end)) {
                currentSegment.push(end);
                lastIntersection = null;
            }
        }

        // Add the final segment if it has at least 2 points
        if (currentSegment.length >= 2) {
            segments.push({
                type: 'LineString',
                coordinates: [...currentSegment]
            });
        }

        return segments;
    }

    private isSamePoint = (a: Position, b: Position): boolean => {
        return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
    };
    
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
}

