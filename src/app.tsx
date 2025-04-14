import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { CompassWidget } from '@deck.gl/react';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer } from '@deck.gl-community/editable-layers';
import { FeatureCollection } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './editors/draw-street-mode';
import { GeoJsonLayer } from 'deck.gl';
import Graph from './ds/Graph';
import { MapData } from './editors/map-data-edit-mode';

const INITIAL_VIEW_STATE = {
    latitude: 0,
    longitude: 0,
    zoom: 10,
    bearing: 0,
    pitch: 30
};

function Root() {
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [blocksData, setBlocksData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    
    React.useEffect(() => {
        try {
            setBlocksData({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { id: 1 },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [
                                [
                                    [0, 0],
                                    [0.1, 0],
                                    [0.1, 0.1],
                                    [0, 0.1],
                                    [0, 0]
                                ]
                            ]
                        }
                    }
                ]
            });
        }
        catch (error) {
            console.error('Error processing GeoJSON data:', error);
        }
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
            onEdit: (updatedData: MapData, editType) => {
                if (editType !== 'addTentativePosition') {

                    const streets = updatedData.streetGraph.toFeatureCollection();
                    setStreetsData(streets as FeatureCollection);
                    
                    // const blocks = ;
                    // setBlocksData(blocks);
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
            <CompassWidget />
        </DeckGL>
    );
}

/* global document */
const container = document.body.appendChild(document.createElement('div'));
createRoot(container).render(<Root />);

