import { Viewport } from "deck.gl";
import {
  getViewMatrix,
  getProjectionParameters,
  fovyToAltitude,
  pixelsToWorld
} from '@math.gl/web-mercator';
import {vec2} from '@math.gl/core';

type Padding = {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
};


export type FlatMapViewportOptions = {
    /** Name of the viewport */
    id?: string;
    /** Left offset from the canvas edge, in pixels */
    x?: number;
    /** Top offset from the canvas edge, in pixels */
    y?: number;
    /** Viewport width in pixels */
    width?: number;
    /** Viewport height in pixels */
    height?: number;

    locX?: number;
    locY?: number;

    pitch?: number;
    bearing?: number;
    fovy?: number;
    position?: number[];
    zoom?: number;
    padding?: Padding | null;
    modelMatrix?: number[] | null;
    nearZMultiplier?: number;
    farZMultiplier?: number;
    nearZ?: number;
    farZ?: number;
};

export default class FlatMapViewport extends Viewport {
    static displayName = 'FlatMapViewport';

    locX: number;
    locY: number;
    pitch: number;
    bearing: number;
    fovy: number;

    constructor(opts: FlatMapViewportOptions = {}) {
        const {
            locX = 0,
            locY = 0,
            zoom = 0,
            pitch = 0,
            bearing = 0,
            fovy = 80,
            nearZMultiplier = 0.1,
            farZMultiplier = 1.01,
            nearZ,
            farZ
        } = opts;

        let {width, height} = opts;
        const scale = Math.pow(2, zoom);

        width = width || 1;
        height = height || 1;

        let altitude = fovyToAltitude(fovy);

        let projectionParameters = getProjectionParameters({
            width,
            height,
            scale,
            center: undefined,
            offset: undefined,
            pitch,
            fovy,
            nearZMultiplier,
            farZMultiplier
        });

        if (nearZ && Number.isFinite(nearZ)) {
            projectionParameters.near = nearZ;
        }
        if (farZ && Number.isFinite(farZ)) {
            projectionParameters.far = farZ;
        }

        let viewMatrixUncentered = getViewMatrix({
            height,
            pitch,
            bearing,
            scale,
            altitude
        });

        super({
            longitude: undefined,
            latitude: undefined,

            ...opts,
            
            width,
            height,

            viewMatrix: viewMatrixUncentered,
            zoom,

            ...projectionParameters,
            fovy,
            focalDistance: altitude
        });

        this.locX = locX;
        this.locY = locY;
        this.pitch = pitch;
        this.bearing = bearing;
        this.fovy = fovy;

        Object.freeze(this);
    }

    panByPosition(coords: number[], pixel: number[]): FlatMapViewportOptions {

        console.log('panByPosition', coords, pixel);

        const fromLocation = pixelsToWorld(pixel, this.pixelUnprojectionMatrix);
        const toLocation = this.projectFlat(coords);

        const translate = vec2.add([], toLocation, vec2.negate([], fromLocation));
        const newCenter = vec2.add([], this.center, translate);

        const [locX, locY] = this.unprojectFlat(newCenter);
        console.log(locX, locY);
        return {locX, locY};
    }
}