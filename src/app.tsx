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
import { area, feature } from '@turf/turf';
import { Polygon } from 'geojson';
import { Building, generateLotsFromBlock } from './procgen/Building';

const INITIAL_VIEW_STATE = {
    latitude: 0,
    longitude: 0,
    zoom: 17,
    bearing: 0,
    pitch: 0
};

function Root() {
    const [streetGraph] = React.useState<Graph>(new Graph());
    const [drawMode] = React.useState(() => new DrawStreetMode(streetGraph));
    
    // GeoJSON data to visualise streets and blocks
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [blocksData, setBlocksData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [skeletonsData, setSkeletonsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [buildingData, setBuildingData] = React.useState<Building[]>([]);

    React.useEffect(() => {
        // Update the draw mode with the current graph whenever it changes
        drawMode.setGraph(streetGraph);
    }, [streetGraph, drawMode]);

    React.useEffect(() => {
        return () => {
            drawMode.cleanup();
        };
    }, [drawMode]);

    const layers = [
        new GeoJsonLayer({
            id: "skeletons",
            data: skeletonsData as any,
            filled: false,
            stroked: true,
            getFillColor: (_: any) => [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255],
            pickable: true
        }),
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
            mode: drawMode,
            filled: true,
            getLineWidth: 0.1,
            getFillColor: [200, 0, 80, 180],
            getLineColor: (_feature: any, _isSelected: any, _mode: any): Color => {
                return [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255];
            },
            pickable: true,
            selectedFeatureIndexes: [],
            editHandleType: 'point',
            onEdit: ({updatedData, editType}) => {
                if (editType !== 'addTentativePosition') {

                    streetGraph.addLineString(updatedData.features[0].geometry);
                    setStreetsData(streetGraph.getStreetFeatureCollection() as any);

                    const polygonization = Graph.polygonize(streetGraph.copy());
                    const blocks = polygonization;//buffer(polygonization, -3, { units: 'meters' });

                    if (blocks) {
                        // hack: remove small polygons. we need to fix the tolerances of the polygonizer
                        blocks.features = blocks.features.filter((block) => area(block) > 0.1);

                        const newBlocks = blocks.features.map(b => feature(generateLotsFromBlock(b.geometry as Polygon)))
                        setBlocksData(newBlocks as any);

                        // const buildings: Building[] = [];

                        // for (const block of blocks.features) {
                        //     const lots = generateLotsFromBlock(block.geometry as any);
                        //     const b = lots
                        //         .map((lot: Polygon) => generateFloorplanFromLot(lot))
                        //         .filter((floorplan: Polygon | null) => floorplan !== null)
                        //         .map((floorplan: Polygon) => generateBuildingFromFloorplan(floorplan, 10, 50))
                        //         .filter((building: Building | null) => building !== null) as Building[];
                        //     buildings.push(...b);
                        // }

                        // setBuildingData(buildings);
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

