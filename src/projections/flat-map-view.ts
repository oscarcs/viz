import { Controller, TransitionInterpolator, View } from "deck.gl";
import FlatMapViewport from "./flat-map-viewport";
import { NumericArray } from "@math.gl/types";
import FlatMapController from "./flat-map-controller";

type TransitionProps = {
    /** Transition duration in milliseconds, default value 0, implies no transition. When using `FlyToInterpolator`, it can also be set to `'auto'`. */
    transitionDuration?: number | 'auto';
    /** An interpolator object that defines the transition behavior between two viewports. */
    transitionInterpolator?: TransitionInterpolator;
    /** Easing function that can be used to achieve effects like "Ease-In-Cubic", "Ease-Out-Cubic", etc. Default value performs Linear easing. */
    transitionEasing?: (t: number) => number;
    /** Controls how to process a new view state change that occurs during an existing transition. */
    transitionInterruption?: any;
    /** Callback fired when requested transition starts. */
    onTransitionStart?: (transition: any) => void;
    /** Callback fired when requested transition is interrupted. */
    onTransitionInterrupt?: (transition: any) => void;
    /** Callback fired when requested transition ends. */
    onTransitionEnd?: (transition: any) => void;
};

type ControllerOptions = {
    /** Enable zooming with mouse wheel. Default `true`. */
    scrollZoom?: boolean | {
        /** Scaler that translates wheel delta to the change of viewport scale. Default `0.01`. */
        speed?: number;
        /** Smoothly transition to the new zoom. If enabled, will provide a slightly lagged but smoother experience. Default `false`. */
        smooth?: boolean
    };
    /** Enable panning with pointer drag. Default `true` */
    dragPan?: boolean;
    /** Enable rotating with pointer drag. Default `true` */
    dragRotate?: boolean;
    /** Enable zooming with double click. Default `true` */
    doubleClickZoom?: boolean;
    /** Enable zooming with multi-touch. Default `true` */
    touchZoom?: boolean;
    /** Enable rotating with multi-touch. Use two-finger rotating gesture for horizontal and three-finger swiping gesture for vertical rotation. Default `false` */
    touchRotate?: boolean;
    /** Enable interaction with keyboard. Default `true`. */
    keyboard?:
    | boolean
    | {
        /** Speed of zoom using +/- keys. Default `2` */
        zoomSpeed?: number;
        /** Speed of movement using arrow keys, in pixels. */
        moveSpeed?: number;
        /** Speed of rotation using shift + left/right arrow keys, in degrees. Default 15. */
        rotateSpeedX?: number;
        /** Speed of rotation using shift + up/down arrow keys, in degrees. Default 10. */
        rotateSpeedY?: number;
    };
    /** Drag behavior without pressing function keys, one of `pan` and `rotate`. */
    dragMode?: 'pan' | 'rotate';
    /** Enable inertia after panning/pinching. If a number is provided, indicates the duration of time over which the velocity reduces to zero, in milliseconds. Default `false`. */
    inertia?: boolean | number;
};

interface ConstructorOf<T> {
    new(...args: any): T;
}

type CommonViewProps<ViewState> = {
    /** A unique id of the view. In a multi-view use case, this is important for matching view states and place contents into this view. */
    id?: string;
    /** A relative (e.g. `'50%'`) or absolute position. Default `0`. */
    x?: number | string;
    /** A relative (e.g. `'50%'`) or absolute position. Default `0`. */
    y?: number | string;
    /** A relative (e.g. `'50%'`) or absolute extent. Default `'100%'`. */
    width?: number | string;
    /** A relative (e.g. `'50%'`) or absolute extent. Default `'100%'`. */
    height?: number | string;
    /** Padding around the view, expressed in either relative (e.g. `'50%'`) or absolute pixels. Default `null`. */
    padding?: {
        left?: number | string;
        right?: number | string;
        top?: number | string;
        bottom?: number | string;
    } | null;
    /** When using multiple views, set this flag to wipe the pixels drawn by other overlaping views */
    clear?: boolean;
    /** State of the view */
    viewState?:
    | string
    | ({
        id?: string;
    } & Partial<ViewState>);
    /** Options for viewport interactivity. */
    controller?:
    | null
    | boolean
    | ConstructorOf<Controller<any>>
    | (ControllerOptions & {
        type?: ConstructorOf<Controller<any>>;
    });
};

export type FlatMapViewState = {
    locX: number;
    locY: number;
    
    /** Zoom level */
    zoom: number;
    /** Pitch (tilt) of the map, in degrees. `0` looks top down */
    pitch?: number;
    /** Bearing (rotation) of the map, in degrees. `0` is north up */
    bearing?: number;
    /** Min zoom, default `0` */
    minZoom?: number;
    /** Max zoom, default `20` */
    maxZoom?: number;
    /** Min pitch, default `0` */
    minPitch?: number;
    /** Max pitch, default `60` */
    maxPitch?: number;
    /** Viewport center offsets from lng, lat in meters */
    position?: number[];
    /** The near plane position */
    nearZ?: number;
    /** The far plane position */
    farZ?: number;
} & TransitionProps;

export type FlatMapViewProps = {
    /** Whether to render multiple copies of the map at low zoom levels. Default `false`. */
    repeat?: boolean;
    /** Scaler for the near plane, 1 unit equals to the height of the viewport. Default to `0.1`. Overwrites the `near` parameter. */
    nearZMultiplier?: number;
    /** Scaler for the far plane, 1 unit equals to the distance from the camera to the top edge of the screen. Default to `1.01`. Overwrites the `far` parameter. */
    farZMultiplier?: number;
    /** Custom projection matrix */
    projectionMatrix?: NumericArray;
    /** Field of view covered by the camera, in the perspective case. In degrees. If not supplied, will be calculated from `altitude`. */
    fovy?: number;
    /** Distance of the camera relative to viewport height. Default `1.5`. */
    altitude?: number;
} & CommonViewProps<FlatMapViewState>;

export default class FlatMapView extends View<FlatMapViewState, FlatMapViewProps> {
    static displayName = 'FlatMapView';

    constructor(props: FlatMapViewProps = {}) {
        super(props);
    }

    getViewportType() {
        return FlatMapViewport;
    }

    get ControllerType() {
        return FlatMapController;
    }
}