import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { PickingInfo } from '@deck.gl/core';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './editors/DrawStreetMode';
import { GeoJsonLayer, PolygonLayer, COORDINATE_SYSTEM } from 'deck.gl';
import StreetGraph from './ds/StreetGraph';
import { ToolbarWidget, ToolType } from './widget/ToolbarWidget';
import { CustomCompassWidget } from './widget/CustomCompassWidget';
import { InfoTooltip } from './widget/InfoTooltip';
import { KeyboardShortcutsWidget } from './widget/KeyboardShortcutsWidget';
import { Building } from './procgen/Building';
import { generateStripsFromBlock, Strip } from './procgen/Strips';
import { SelectMode } from './editors/SelectMode';
import { generateLotsFromStrips, Lot } from './procgen/Lots';
import { DebugGeometry, debugStore } from './debug/DebugStore';
import { FeatureCollection } from 'geojson';
import FlatMapView from './projections/flat-map-view';

const INITIAL_VIEW_STATE = {
    locX: 0,
    locY: 0,
    zoom: 1,
    maxZoom: 5,
    minZoom: 0.001,
    bearing: 0,
    pitch: 0
};

function Root() {
    const [streetGraph] = React.useState<StreetGraph>(new StreetGraph());
    const [drawMode] = React.useState(() => new DrawStreetMode(streetGraph));
    const [selectMode] = React.useState(() => new SelectMode(streetGraph));
    const [activeTool, setActiveTool] = React.useState<ToolType>('draw');
    const [hoverInfo, setHoverInfo] = React.useState<PickingInfo | null>(null);
    
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [lotsData, setLotsData] = React.useState<Lot[]>([]);
    const [buildingData] = React.useState<Building[]>([]);
    const [debugGeometry, setDebugGeometry] = React.useState<DebugGeometry[]>([]);

    const currentMode = activeTool === 'draw' ? drawMode : selectMode;

    React.useEffect(() => {
        const unsubscribe = debugStore.subscribe((geometries) => {
            setDebugGeometry(geometries);
        });
        return unsubscribe;
    }, []);

    React.useEffect(() => {
        drawMode.setGraph(streetGraph);
    }, [streetGraph, drawMode]);

    React.useEffect(() => {
        return () => {
            drawMode.cleanup();
        };
    }, [drawMode]);

    const updateHoverInfo = React.useCallback((info: PickingInfo) => {
        if (activeTool === 'select') {
            setHoverInfo(info.object ? info : null);
        }
        else {
            setHoverInfo(null);
        }
    }, [activeTool, setHoverInfo]);

    const handleToolChange = React.useCallback((newTool: ToolType) => {
        if (activeTool === 'draw' && newTool !== 'draw') {
            drawMode.resetClickSequence();
        }
        
        setActiveTool(newTool);
    }, [activeTool, drawMode]);

    const layers = [
        new PolygonLayer<Lot>({
            id: "lots",
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: lotsData,
            filled: true,
            stroked: true,
            getPolygon: (lot: Lot) => lot.geometry.coordinates[0],
            getLineColor: (lot: Lot) => lot.color,
            getFillColor: (lot: Lot) => [lot.color[0], lot.color[1], lot.color[2], 50],
            pickable: true,
            onHover: updateHoverInfo,
            updateTriggers: {
                updateHoverInfo: [activeTool]
            },
        }),
        new PolygonLayer<Building>({
            id: "buildings",
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: buildingData,
            extruded: true,
            getElevation: f => f.height,
            getPolygon: f => f.polygon.coordinates[0],
            opacity: 0.6,
            getFillColor: [74, 80, 87],
            material: {
                ambient: 0.1,
                diffuse: 0.6,
                shininess: 32,
                specularColor: [60, 64, 70]
            },
        }),
        new EditableGeoJsonLayer({
            id: "streets",
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: streetsData as any,
            mode: currentMode,
            filled: true,
            getLineWidth: 3,
            getFillColor: [200, 0, 80, 180],
            getLineColor: (feature: any, _isSelected: any, _mode: any): Color => {
                return feature.properties?.color || [255, 0, 0, 255];
            },
            pickable: true,
            selectedFeatureIndexes: [],
            editHandleType: 'point',
            onHover: updateHoverInfo,
            updateTriggers: {
                mode: activeTool
            },
            onEdit: ({updatedData, editType}) => {
                if (activeTool === 'draw' && editType !== 'addTentativePosition') {

                    if (updatedData.features.length === 0) return;

                    console.log(updatedData.features);

                    debugStore.clear();

                    streetGraph.endCommit();

                    streetGraph.addLineString(updatedData.features[0].geometry, { 
                        pointSnapping: drawMode.getPointSnappingStates()
                    });
                    
                    const streets = streetGraph.getStreetFeatureCollection();
                    setStreetsData(streets as any);

                    return;

                    // const blocks = StreetGraph.polygonizeToBlocks(streetGraph);
                    
                    // const strips: Map<string, Strip[]> = new Map();
                    // for (const block of blocks) {
                    //     const generatedStrips = generateStripsFromBlock(block);
                    //     for (const [key, strip] of generatedStrips) {
                    //         if (!strips.has(key)) strips.set(key, []);
                    //         strips.get(key)!.push(strip);
                    //     }
                    // }

                    // const lots: Lot[] = [];
                    // for (const streetId of strips.keys()) {
                    //     const street = streetGraph.getStreet(streetId);
                    //     if (street) {
                    //         const generatedLots = generateLotsFromStrips(street, strips.get(streetId)!);
                    //         lots.push(...generatedLots);
                    //     }
                    // }

                    // setLotsData(lots);

                    // console.log(streetGraph.getChangesSinceLastCommit());
                    // console.log('Street graph updated:', streetGraph.getChangeStatistics());
                }
            }
        }),
        new GeoJsonLayer({
            id: "debug",
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [0, 0, 0],
            data: {
                type: 'FeatureCollection',
                features: debugGeometry.map((debug, index) => ({
                    type: 'Feature' as const,
                    geometry: debug.geometry,
                    properties: {
                        label: debug.label || `Debug ${index}`,
                        color: debug.color || [255, 255, 0, 255],
                        lineColor: debug.lineColor || [0, 0, 255, 255],
                        radius: debug.radius || 5,
                        width: debug.width || 0.5
                    }
                }))
            },
            filled: true,
            stroked: true,
            extruded: false,
            pointRadiusMinPixels: 5,
            pointRadiusMaxPixels: 10,
            getLineWidth: (feature: any) => feature.properties.width,
            getPointRadius: (feature: any) => feature.properties.radius,
            getFillColor: (feature: any) => feature.properties.color,
            getLineColor: (feature: any) => feature.properties.lineColor,
            pickable: false
        })
    ];

    return (
        <DeckGL
            controller={{ doubleClickZoom: false }}
            initialViewState={INITIAL_VIEW_STATE}
            layers={layers}
            views={new FlatMapView()}
        >
            <CustomCompassWidget />
            <ToolbarWidget 
                activeTool={activeTool}
                onToolChange={handleToolChange}
            />
            <KeyboardShortcutsWidget activeTool={activeTool} />
            {hoverInfo && activeTool === 'select' && (
                <InfoTooltip hoverInfo={hoverInfo} streetGraph={streetGraph} />
            )}
        </DeckGL>
    );
}

/* global document */
const container = document.body.appendChild(document.createElement('div'));
createRoot(container).render(<Root />);

