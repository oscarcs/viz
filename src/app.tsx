import React from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { CompassWidget } from '@deck.gl/react';
import '@deck.gl/widgets/stylesheet.css';
import { Color, EditableGeoJsonLayer } from '@deck.gl-community/editable-layers';
import { FeatureCollection } from '@deck.gl-community/editable-layers';
import { DrawStreetMode } from './draw-street-mode';
import { polygonize } from '@turf/turf';
import { GeoJsonLayer } from 'deck.gl';
import tallinn from './tallinn.json';
import { FeatureCollection as OGFeatureCollection, LineString } from 'geojson';

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
        try {
            const data = tallinn as FeatureCollection;
            setStreetsData(data);
            setBlocksData(polygonize(data as OGFeatureCollection<LineString>) as FeatureCollection);
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
            pointRadiusMinPixels: 5,
            pointRadiusScale: 2000,
            getFillColor: [200, 0, 80, 180],
            getLineColor: (feature: any, _0: any, _1: any): Color => {
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

