import { Viewport } from "deck.gl";
import { Matrix4 } from '@math.gl/core';

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
            nearZ,
            farZ
        } = opts;

        let {width, height} = opts;
        
        // Calculate scale for flat coordinates
        // We want zoom level 1 to show roughly 100 units across the screen
        // Smaller scale values = larger world coordinates
        const scale = Math.pow(2, zoom) * 0.01; // Makes coordinates 100x larger than default

        width = width || 1;
        height = height || 1;

        let altitude = 1.5; // Simple fixed altitude for flat coordinates

        // Create a proper perspective projection matrix for flat coordinates
        const fovyRadians = fovy * Math.PI / 180;
        const aspect = width / height;
        const near = nearZ || 0.1;
        const far = farZ || 1000;
        
        const projectionMatrix = new Matrix4().perspective({
            fovy: fovyRadians,
            aspect,
            near,
            far
        });

        // Create a proper view matrix for flat coordinates that handles rotation
        const viewMatrix = new Matrix4()
            .identity()
            .translate([0, 0, -altitude])
            .rotateX(-pitch * Math.PI / 180)  // Apply pitch rotation
            .rotateZ(-bearing * Math.PI / 180)  // Apply bearing rotation
            .scale([scale, scale, 1]);  // Apply zoom scale

        super({
            longitude: undefined,
            latitude: undefined,

            ...opts,
            
            width,
            height,

            viewMatrix: Array.from(viewMatrix.toArray()),
            projectionMatrix: Array.from(projectionMatrix.toArray()),
            zoom,
            fovy,
            focalDistance: altitude,
            
            // Override position to set our flat coordinates
            position: [locX, locY, 0]
        });

        this.locX = locX;
        this.locY = locY;
        this.pitch = pitch;
        this.bearing = bearing;
        this.fovy = fovy;

        Object.freeze(this);
    }

    panByPosition(coords: number[], pixel: number[]): FlatMapViewportOptions {
        // We want to move the viewport so that the world position 'coords' 
        // appears at the pixel position 'pixel'
        
        // First, find what world position is currently at the pixel position
        const currentWorldPosAtPixel = this.unproject(pixel);
        
        // The difference between where we want to be and where we are
        const deltaX = coords[0] - currentWorldPosAtPixel[0];
        const deltaY = coords[1] - currentWorldPosAtPixel[1];
        
        // Update the viewport center by this delta
        const newLocX = this.locX + deltaX;
        const newLocY = this.locY + deltaY;
        
        return {locX: newLocX, locY: newLocY};
    }
}