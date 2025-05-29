import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { PickingInfo } from '@deck.gl/core';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer } from '@deck.gl-community/editable-layers';
import { FeatureCollection } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './editors/DrawStreetMode';
import { SelectMode } from './editors/SelectMode';
import { PolygonLayer } from 'deck.gl';
import StreetGraph from './ds/StreetGraph';
import { ToolbarWidget, ToolType } from './widget/ToolbarWidget';
import { CustomCompassWidget } from './widget/CustomCompassWidget';
import { StreetTooltip } from './widget/StreetTooltip';
import { KeyboardShortcutsWidget } from './widget/KeyboardShortcutsWidget';
import { Building } from './procgen/Building';
import { generateLotsFromBlock, Lot } from './procgen/Lots';

const INITIAL_VIEW_STATE = {
    latitude: 0,
    longitude: 0,
    zoom: 17,
    bearing: 0,
    pitch: 0
};

function Root() {
    const [streetGraph] = React.useState<StreetGraph>(new StreetGraph());
    const [drawMode] = React.useState(() => new DrawStreetMode(streetGraph));
    const [selectMode] = React.useState(() => new SelectMode(streetGraph));
    const [activeTool, setActiveTool] = React.useState<ToolType>('draw');
    const [hoverInfo, setHoverInfo] = React.useState<PickingInfo | null>(null);
    
    // GeoJSON data to visualise streets and blocks
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [lotsData, setLotsData] = React.useState<Lot[]>([]);
    const [buildingData] = React.useState<Building[]>([]);

    // Get the current mode based on active tool
    const currentMode = activeTool === 'draw' ? drawMode : selectMode;

    React.useEffect(() => {
        drawMode.setGraph(streetGraph);
        selectMode.setGraph(streetGraph);
    }, [streetGraph, drawMode, selectMode]);

    React.useEffect(() => {
        return () => {
            drawMode.cleanup();
        };
    }, [drawMode]);

    const layers = [
        new PolygonLayer<Lot>({
            id: "lots",
            data: lotsData,
            filled: true,
            stroked: false,
            getPolygon: (lot: Lot) => lot.geometry.coordinates[0],
            getFillColor: (lot: Lot) => lot.color,
            pickable: true
        }),
        new PolygonLayer<Building>({
            id: "buildings",
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
            data: streetsData,
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
            onHover: (info: PickingInfo) => {
                if (activeTool === 'select') {
                    setHoverInfo(info.object ? info : null);
                }
                else {
                    setHoverInfo(null);
                }
            },
            onEdit: ({updatedData, editType}) => {
                if (activeTool === 'draw' && editType !== 'addTentativePosition') {
                    streetGraph.addLineString(updatedData.features[0].geometry, { 
                        pointSnapping: drawMode.getPointSnappingStates()
                    });
                    setStreetsData(streetGraph.getStreetFeatureCollection() as any);

                    const blocks = StreetGraph.polygonize(streetGraph.copy());
                    const lots: Lot[] = [];
                    
                    if (blocks) {
                        for (const block of blocks.features) {
                            const generatedLots = generateLotsFromBlock(block.geometry);
                            lots.push(...generatedLots);
                        }
                    }

                    setLotsData(lots);
                }
            }
        })
    ];

    return (
        <DeckGL
            controller={{ doubleClickZoom: false }}
            initialViewState={INITIAL_VIEW_STATE}
            layers={layers}
        >
            <CustomCompassWidget />
            <ToolbarWidget 
                activeTool={activeTool}
                onToolChange={setActiveTool}
            />
            <KeyboardShortcutsWidget activeTool={activeTool} />
            {hoverInfo && activeTool === 'select' && (
                <StreetTooltip hoverInfo={hoverInfo} streetGraph={streetGraph} />
            )}
        </DeckGL>
    );
}

/* global document */
const container = document.body.appendChild(document.createElement('div'));
createRoot(container).render(<Root />);

