import React from 'react';
import { PickingInfo } from '@deck.gl/core';
import StreetGraph from '../ds/StreetGraph';
import { Lot } from '../procgen/Lots';
import { area } from '@turf/turf';

interface InfoTooltipProps {
    hoverInfo: PickingInfo;
    streetGraph: StreetGraph;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ hoverInfo, streetGraph }) => {    
    if (!hoverInfo.object) {
        return null;
    }

    if (hoverInfo.object.properties?.logicalStreetId) {
        return renderStreetTooltip(hoverInfo, streetGraph);
    }

    if (hoverInfo.object.geometry && hoverInfo.object.id && hoverInfo.object.color) {
        return renderLotTooltip(hoverInfo.object as Lot, hoverInfo);
    }

    return null;
};

const renderStreetTooltip = (hoverInfo: PickingInfo, streetGraph: StreetGraph) => {
    const logicalStreets = streetGraph.getLogicalStreets();
    const street = logicalStreets.find(s => s.id === hoverInfo.object.properties.logicalStreetId);
    
    if (!street) return null;

    const edgeCount = street.edges.size / 2;
    const nodeCount = street.getNodes().length;
    const length = street.getLengthInMeters();

    const tooltipStyle: React.CSSProperties = {
        position: 'absolute',
        left: hoverInfo.x + 15,
        top: hoverInfo.y - 10,
        zIndex: 1000,
        pointerEvents: 'none',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        padding: '12px 16px',
        fontSize: '13px',
        lineHeight: '1.5',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        maxWidth: '240px',
        minWidth: '180px',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
    };

    return (
        <div style={tooltipStyle}>
            <div style={{ fontWeight: '600', marginBottom: '4px', color: '#374151' }}>
                Street
            </div>
            <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '6px' }}></div>
            <div style={{ color: '#6b7280' }}>
                <div><strong>ID:</strong> {street.id}</div>
                <div><strong>Name:</strong> {street.name || 'Unnamed'}</div>
                <div><strong>Length:</strong> {length.toFixed(2)} m</div>
                <div><strong>Segments:</strong> {edgeCount}</div>
                <div><strong>Intersections:</strong> {nodeCount}</div>
            </div>
        </div>
    );
};

const renderLotTooltip = (lot: Lot, hoverInfo: PickingInfo) => {
    const coordinates = lot.geometry.coordinates[0];
    const lotArea = area(lot.geometry);

    const tooltipStyle: React.CSSProperties = {
        position: 'absolute',
        left: hoverInfo.x + 15,
        top: hoverInfo.y - 10,
        zIndex: 1000,
        pointerEvents: 'none',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        padding: '12px 16px',
        fontSize: '13px',
        lineHeight: '1.5',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        maxWidth: '240px',
        minWidth: '180px',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
    };

    return (
        <div style={tooltipStyle}>
            <div style={{ fontWeight: '600', marginBottom: '4px', color: '#374151' }}>
                Lot
            </div>
            <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '6px' }}></div>
            <div style={{ color: '#6b7280' }}>
                <div><strong>ID:</strong> {lot.id}</div>
                <div><strong>Vertices:</strong> {coordinates.length - 1}</div>
                <div><strong>Area:</strong> {(lotArea).toFixed(2)} m²</div>
            </div>
        </div>
    );
};