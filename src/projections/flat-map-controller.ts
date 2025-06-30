import { LinearInterpolator } from "deck.gl";
import { assert, Controller, ControllerProps, Viewport } from "@deck.gl/core";
import ViewState from "./view-state";
import { clamp } from '@math.gl/core';

const PITCH_MOUSE_THRESHOLD = 5;
const PITCH_ACCEL = 1.2;

export type FlatMapStateProps = {
    width: number;
    height: number;
    locX: number;
    locY: number;
    zoom: number;
    bearing?: number;
    pitch?: number;
    altitude?: number;

    position?: [number, number, number];

    maxZoom?: number;
    minZoom?: number;
    maxPitch?: number;
    minPitch?: number;
};

type FlatMapStateInternal = {
    /** The point on the map being grabbed when the operation first started */
    startPanLoc?: [number, number];
    /** Center of the zoom when the operation first started */
    startZoomLoc?: [number, number];
    /** Pointer position when rotation started */
    startRotatePos?: [number, number];
    /** Bearing when current perspective rotate operation started */
    startBearing?: number;
    /** Pitch when current perspective rotate operation started */
    startPitch?: number;
    /** Zoom when current zoom operation started */
    startZoom?: number;
};

export class FlatMapState extends ViewState<FlatMapState, FlatMapStateProps, FlatMapStateInternal> {
    makeViewport: (props: Record<string, any>) => Viewport;

    constructor(
        options: FlatMapStateProps &
            FlatMapStateInternal & {
                makeViewport: (props: Record<string, any>) => Viewport;
            }
    ) {
        const {
            width,
            height,
            locX,
            locY,
            zoom,
            bearing = 0,
            pitch = 0,
            altitude = 1.5,
            position = [0, 0, 0],
            maxZoom = 20,
            minZoom = 0,
            maxPitch = 60,
            minPitch = 0,

            startPanLoc,
            startZoomLoc,
            startRotatePos,
            startBearing,
            startPitch,
            startZoom,
        } = options;

        assert(Number.isFinite(options.locX));
        assert(Number.isFinite(options.locY));
        assert(Number.isFinite(options.zoom));

        super({
            width,
            height,
            locX,
            locY,
            zoom,
            bearing,
            pitch,
            altitude,
            maxZoom,
            minZoom,
            maxPitch,
            minPitch,
            position
        },
        {
            startPanLoc,
            startZoomLoc,
            startRotatePos,
            startBearing,
            startPitch,
            startZoom
        });

        this.makeViewport = options.makeViewport;
    }

    panStart({pos}: {pos: [number, number]}): FlatMapState {
        return this._getUpdatedState({
            startPanLoc: this._unproject(pos)
        });
    }

    pan({pos, startPos}: { pos: [number, number]; startPos?: [number, number]; }): FlatMapState {
        const startPanLoc = this.getState().startPanLoc || this._unproject(startPos);

        if (!startPanLoc) {
            return this;
        }

        const viewport = this.makeViewport(this.getViewportProps());
        const newProps = viewport.panByPosition(startPanLoc, pos);

        return this._getUpdatedState(newProps);
    }

    panEnd(): FlatMapState {
        return this._getUpdatedState({
            startPanLoc: undefined
        });
    }

    rotateStart({pos}: {pos: [number, number]}): FlatMapState {
        return this._getUpdatedState({
            startRotatePos: pos,
            startBearing: this.getViewportProps().bearing,
            startPitch: this.getViewportProps().pitch
        });
    }

    rotate({pos, deltaAngleX = 0, deltaAngleY = 0}: { pos?: [number, number]; deltaAngleX?: number; deltaAngleY?: number; }): FlatMapState {
        const {startRotatePos, startBearing, startPitch} = this.getState();

        if (!startRotatePos || startBearing === undefined || startPitch === undefined) {
            return this;
        }
    
        let newRotation;
        if (pos) {
            newRotation = this._getNewRotation(pos, startRotatePos, startPitch, startBearing);
        }
        else {
            newRotation = {
                bearing: startBearing + deltaAngleX,
                pitch: startPitch + deltaAngleY
            };
        }
        return this._getUpdatedState(newRotation);
    }

    rotateEnd(): FlatMapState {
        return this._getUpdatedState({
            startBearing: undefined,
            startPitch: undefined
        });
    }

    zoomStart({pos}: { pos: [number, number]; }): FlatMapState {
        return this._getUpdatedState({
            startZoomLoc: this._unproject(pos),
            startZoom: this.getViewportProps().zoom
        });
    }

    zoom({pos, startPos, scale}: { pos: [number, number]; startPos?: [number, number]; scale: number; }): FlatMapState {
        // Make sure we zoom around the current mouse position rather than map center
        let {startZoom, startZoomLoc} = this.getState();

        if (!startZoomLoc) {
            // We have two modes of zoom:
            // scroll zoom that are discrete events (transform from the current zoom level),
            // and pinch zoom that are continuous events (transform from the zoom level when
            // pinch started).
            // If startZoom state is defined, then use the startZoom state;
            // otherwise assume discrete zooming
            startZoom = this.getViewportProps().zoom;
            startZoomLoc = this._unproject(startPos) || this._unproject(pos);
        }
        if (!startZoomLoc) {
            return this;
        }

        const {maxZoom, minZoom} = this.getViewportProps();
        let zoom = (startZoom as number) + Math.log2(scale);
        zoom = clamp(zoom, minZoom, maxZoom);

        const zoomedViewport = this.makeViewport({...this.getViewportProps(), zoom});

        return this._getUpdatedState({
            zoom,
            ...zoomedViewport.panByPosition(startZoomLoc, pos)
        });
    }

    zoomEnd(): FlatMapState {
        return this._getUpdatedState({
            startZoomLoc: undefined,
            startZoom: undefined
        });
    }

    zoomIn(speed: number = 2): FlatMapState {
        return this._zoomFromCenter(speed);
    }

    zoomOut(speed: number = 2): FlatMapState {
        return this._zoomFromCenter(1 / speed);
    }

    moveLeft(speed: number = 2): FlatMapState {
        return this._panFromCenter([speed, 0]);
    }

    moveRight(speed: number = 2): FlatMapState {
        return this._panFromCenter([-speed, 0]);
    }

    moveUp(speed: number = 2): FlatMapState {
        return this._panFromCenter([0, speed]);
    }

    moveDown(speed: number = 2): FlatMapState {
        return this._panFromCenter([0, -speed]);
    }

    rotateLeft(speed: number = 15): FlatMapState {
        return this._getUpdatedState({
            bearing: this.getViewportProps().bearing - speed
        });
    }

    rotateRight(speed: number = 15): FlatMapState {
        return this._getUpdatedState({
            bearing: this.getViewportProps().bearing + speed
        });
    }

    rotateUp(speed: number = 10): FlatMapState {
        return this._getUpdatedState({
            pitch: this.getViewportProps().pitch + speed
        });
    }

    rotateDown(speed: number = 10): FlatMapState {
        return this._getUpdatedState({
            pitch: this.getViewportProps().pitch - speed
        });
    }

    shortestPathFrom(viewState: FlatMapState): FlatMapStateProps {
        throw new Error("Method not implemented.");
    }

    applyConstraints(props: Required<FlatMapStateProps>): Required<FlatMapStateProps> {
        // Ensure zoom is within specified range
        const {maxZoom, minZoom, zoom} = props;
        props.zoom = clamp(zoom, minZoom, maxZoom);

        // Ensure pitch is within specified range
        const {maxPitch, minPitch, pitch} = props;
        props.pitch = clamp(pitch, minPitch, maxPitch);

        return props;
    }

    /* Private methods */

    _zoomFromCenter(scale: number) {
        const {width, height} = this.getViewportProps();
        return this.zoom({
            pos: [width / 2, height / 2],
            scale
        });
    }

    _panFromCenter(offset: [number, number]) {
        const {width, height} = this.getViewportProps();
        return this.pan({
            pos: [width / 2 + offset[0], height / 2 + offset[1]],
            startPos: [width / 2, height / 2]
        });
    }

    _getUpdatedState(newProps: Partial<FlatMapStateProps & FlatMapStateInternal & { makeViewport: (props: Record<string, any>) => Viewport }>): FlatMapState {
        // @ts-ignore
        return new this.constructor({
            makeViewport: this.makeViewport,
            ...this.getViewportProps(),
            ...this.getState(),
            ...newProps
        });
    }

    _unproject(pos?: [number, number]): [number, number] | undefined {
        const viewport = this.makeViewport(this.getViewportProps());
        return pos && viewport.unproject(pos) as [number, number];
    }

    _getNewRotation(
        pos: [number, number],
        startPos: [number, number],
        startPitch: number,
        startBearing: number
    ): { pitch: number; bearing: number } {
        const deltaX = pos[0] - startPos[0];
        const deltaY = pos[1] - startPos[1];
        const centerY = pos[1];
        const startY = startPos[1];
        const { width, height } = this.getViewportProps();

        const deltaScaleX = deltaX / width;
        let deltaScaleY = 0;

        if (deltaY > 0) {
            if (Math.abs(height - startY) > PITCH_MOUSE_THRESHOLD) {
                // Move from 0 to -1 as we drag upwards
                deltaScaleY = (deltaY / (startY - height)) * PITCH_ACCEL;
            }
        }
        else if (deltaY < 0) {
            if (startY > PITCH_MOUSE_THRESHOLD) {
                // Move from 0 to 1 as we drag upwards
                deltaScaleY = 1 - centerY / startY;
            }
        }
        // clamp deltaScaleY to [-1, 1] so that rotation is constrained between minPitch and maxPitch.
        // deltaScaleX does not need to be clamped as bearing does not have constraints.
        deltaScaleY = clamp(deltaScaleY, -1, 1);

        const { minPitch, maxPitch } = this.getViewportProps();

        const bearing = startBearing + 180 * deltaScaleX;
        let pitch = startPitch;
        if (deltaScaleY > 0) {
            // Gradually increase pitch
            pitch = startPitch + deltaScaleY * (maxPitch - startPitch);
        }
        else if (deltaScaleY < 0) {
            // Gradually decrease pitch
            pitch = startPitch - deltaScaleY * (minPitch - startPitch);
        }

        return {
            pitch,
            bearing
        };
    }

    
}

export default class FlatMapController extends Controller<FlatMapState> {
    ControllerState = FlatMapState;

    transition = {
        transitionDuration: 300,
        TransitionInterpolator: new LinearInterpolator({
            transitionProps: {
                compare: ['locX', 'locY', 'zoom', 'bearing', 'pitch', 'position'],
                required: ['locX', 'locY', 'zoom']
            }
        })
    };

    dragMode: 'pan' | 'rotate' = 'pan';
    
    setProps(props: ControllerProps & FlatMapStateProps) {
        props.position = props.position || [0, 0, 0];
        const oldProps = this.props;

        super.setProps(props);

        const dimensionChanged = !oldProps || oldProps.height !== props.height;
        if (dimensionChanged) {
            // Dimensions have changed, normalize the props
            this.updateViewport(
                new this.ControllerState({
                    makeViewport: this.makeViewport,
                    ...props,
                    ...this.state
                })
            );
        }
    }
}