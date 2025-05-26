import React from 'react';
import { PickingInfo } from '@deck.gl/core';
import StreetGraph from '../ds/StreetGraph';

interface StreetTooltipProps {
    hoverInfo: PickingInfo;
    streetGraph: StreetGraph;
}

export const StreetTooltip: React.FC<StreetTooltipProps> = ({ hoverInfo, streetGraph }) => {
    if (!hoverInfo.object || !hoverInfo.object.properties?.logicalStreetId) {
        return null;
    }

    const logicalStreets = streetGraph.getLogicalStreets();
    const street = logicalStreets.find(s => s.id === hoverInfo.object.properties.logicalStreetId);
    
    if (!street) return null;

    const edgeCount = street.edges.size / 2;
    const nodeCount = street.getNodes().length;

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
                <div><strong>Segments:</strong> {edgeCount}</div>
                <div><strong>Intersections:</strong> {nodeCount}</div>
            </div>
        </div>
    );
};
