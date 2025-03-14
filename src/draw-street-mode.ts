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
// @ts-ignore: Missing type definitions
import distance from '@turf/distance';

export class DrawStreetMode extends GeoJsonEditMode {
    // declaration of variables for the calculation of the distance of linestring
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
            // reset distance to new calculate
            this.dist = 0;
            const lineStringToAdd: LineString = {
                type: 'LineString',
                coordinates: [...clickSequence]
            };

            this.resetClickSequence();

            const editAction = this.getAddFeatureAction(lineStringToAdd, props.data);
            if (editAction) {
                props.onEdit(editAction);
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
                const editAction = this.getAddFeatureAction(lineStringToAdd, props.data);
                if (editAction) {
                    props.onEdit(editAction);
                }
            }
        }
        else if (key === 'Escape') {
            this.resetClickSequence();
            props.onEdit({
                // Because the new drawing feature is dropped, so the data will keep as the same.
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

    // utility function
    calculateInfoDraw(clickSequence: string | any[]) {
        // check if the selected points are at least 2
        if (clickSequence.length > 1) {
            // setting the last point
            this.position = clickSequence[clickSequence.length - 1];
            // calculate the new distance by adding the
            // distance of the new drawn linestring
            this.dist = distance(
                clickSequence[clickSequence.length - 2],
                clickSequence[clickSequence.length - 1]
            );
        }
    }

    _getTooltips = memoize((args: { modeConfig?: any, dist: number }): Tooltip[] => {
        let tooltips: Tooltip[] = [];
        const { formatTooltip } = args.modeConfig || {};
        let text;
        if (args.dist) {
            if (formatTooltip) {
                text = formatTooltip(args.dist);
            }
            else {
                // By default, round to 2 decimal places and append units
                text = `${(args.dist * 1000).toFixed(2)} m`;
            }

            tooltips = [
                {
                    position: this.position,
                    text
                }
            ];
        }
        return tooltips;
    });
}

function isEqual(a: any, b: any) {
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

function memoize(compute: Function) {
    let cachedArgs: Record<string, any> = {};
    let cachedResult: any;

    return (args: any) => {
        for (const key in args) {
            if (!isEqual(args[key], cachedArgs[key])) {
                cachedResult = compute(args);
                cachedArgs = args;
                break;
            }
        }
        return cachedResult;
    };
}
