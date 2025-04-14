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

        console.log(clickSequence.length);

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
}

