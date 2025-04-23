import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer } from '@deck.gl-community/editable-layers';
import { FeatureCollection } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './editors/draw-street-mode';
import { GeoJsonLayer, PolygonLayer } from 'deck.gl';
import Graph from './ds/Graph';
import { ToolbarWidget } from './widget/ToolbarWidget';
import { CustomCompassWidget } from './widget/CustomCompassWidget';
import { buffer } from '@turf/turf';
import { Building, generateBuildingFromFloorplan, generateFloorplanFromLot, generateLotsFromBlock } from './procgen/Building';

const INITIAL_VIEW_STATE = {
    latitude: 0,
    longitude: 0,
    zoom: 17,
    bearing: 0,
    pitch: 0
};

function Root() {
    const [streetGraph] = React.useState<Graph>(new Graph());
    
    // GeoJSON data to visualise streets and blocks
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [blocksData, setBlocksData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [buildingData, setBuildingData] = React.useState<Building[]>([]);

    React.useEffect(() => {

    }, []);

    const layers = [
        new GeoJsonLayer({
            id: "blocks",
            data: blocksData as any,
            filled: true,
            stroked: false,
            getFillColor: (_: any) => [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255],
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
            mode: new DrawStreetMode(),
            filled: true,
            getLineWidth: 5,
            getFillColor: [200, 0, 80, 180],
            getLineColor: (_feature: any, _isSelected: any, _mode: any): Color => {
                return [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255];
            },
            pickable: true,
            selectedFeatureIndexes: [],
            editHandleType: 'point',
            onEdit: ({updatedData, editType}) => {
                if (editType !== 'addTentativePosition') {

                    streetGraph.addStreet(updatedData.features[0].geometry);
                    setStreetsData(streetGraph.getStreetFeatureCollection() as any);

                    const polygonization = Graph.polygonize(streetGraph.copy());
                    const blocks = buffer(polygonization, -3, { units: 'meters' });
                    
                    if (blocks) {
                        const buildings: Building[] = [];

                        for (const block of blocks.features) {
                            const lots = generateLotsFromBlock(block.geometry as any);
                            const b = lots
                                .map(lot => generateFloorplanFromLot(lot))
                                .filter(floorplan => floorplan !== null)
                                .map(floorplan => generateBuildingFromFloorplan(floorplan, 10, 50))
                                .filter(building => building !== null);
                            buildings.push(...b);
                        }

                        setBuildingData(buildings);
                        setBlocksData(blocks as any);
                    }
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
            <ToolbarWidget />
        </DeckGL>
    );
}

/* global document */
const container = document.body.appendChild(document.createElement('div'));
createRoot(container).render(<Root />);

