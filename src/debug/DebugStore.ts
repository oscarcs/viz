import { Geometry } from 'geojson';

export type DebugGeometry = {
    geometry: Geometry;
    color?: [number, number, number, number];
    lineColor?: [number, number, number, number];
    label?: string;
};

class DebugStore {
    private geometries: DebugGeometry[] = [];
    private listeners: Array<(geometries: DebugGeometry[]) => void> = [];

    addGeometry(geometry: DebugGeometry) {
        this.geometries.push(geometry);
        this.notifyListeners();
    }

    setGeometries(geometries: DebugGeometry[]) {
        this.geometries = geometries;
        this.notifyListeners();
    }

    clear() {
        this.geometries = [];
        this.notifyListeners();
    }

    getGeometries(): DebugGeometry[] {
        return [...this.geometries];
    }

    subscribe(callback: (geometries: DebugGeometry[]) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener(this.geometries));
    }
}

export const debugStore = new DebugStore();