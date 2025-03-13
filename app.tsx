import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { CompassWidget } from '@deck.gl/react';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer, Polygon } from '@deck.gl-community/editable-layers';
import { FeatureCollection } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './draw-street-mode';
import { polygonize } from '@turf/turf';
import { GeoJsonLayer } from 'deck.gl';

const INITIAL_VIEW_STATE = {
    latitude: 59.4370,  // Tallinn's latitude
    longitude: 24.7536, // Tallinn's longitude
    zoom: 14,          // Appropriate zoom level for city view
    bearing: 0,
    pitch: 30
};

function Root() {
    const [streetsData, setStreetsData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    const [blocksData, setBlocksData] = React.useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
    
    React.useEffect(() => {
        // Fetch the GeoJSON data from tallinn.geojson
        fetch('./tallinn.geojson')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                setStreetsData(data);
                setBlocksData(polygonize(data) as FeatureCollection);
            })
            .catch(error => {
                console.error('Error fetching GeoJSON data:', error);
            });
    }, []);

    const layers = [
        new GeoJsonLayer({
            id: "blocks",
            data: blocksData as any,
            filled: true,
            stroked: false,
            getFillColor: (feature: any) => [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255],
            pickable: true
        }),
        new EditableGeoJsonLayer({
            id: "streets",
            data: streetsData,
            mode: new DrawStreetMode(),
            filled: true,
            pointRadiusMinPixels: 5,
            pointRadiusScale: 2000,
            getFillColor: [200, 0, 80, 180],
            getLineColor: (feature: any, isSelected: any, mode: any): Color => {
                switch (feature.properties.highway) {
                    case 'residential':
                        return [0, 0, 0, 255];
                    case 'living_street':
                        return [100, 100, 100, 255];
                    case 'pedestrian':
                        return [200, 200, 200, 255];
                    case 'primary':
                        return [255, 0, 0, 255];
                    case 'secondary':
                        return [155, 0, 0, 255];
                    case 'tertiary':
                        return [100, 0, 0, 255];
                    case 'trunk':
                        return [125, 0, 0, 255];
                    default:
                        return [0, 0, 0, 255];
                }
            },
            pickable: true,
            selectedFeatureIndexes: [],
            editHandleType: 'point',
            onEdit: ({ updatedData, editType }) => {
                if (editType !== 'updateTentativeFeature') {
                    console.log('Edit event:', editType, updatedData);
                    setStreetsData(updatedData);
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

