import { useMemo, useState } from "react";
import type { Widget } from "@deck.gl/core";
import { useWidget } from "@deck.gl/react";
import { createPortal } from "react-dom";
import { Hand, Spline } from "lucide-react";

export type ToolType = 'select' | 'draw';

interface ToolbarWidgetProps {
    activeTool: ToolType;
    onToolChange: (tool: ToolType) => void;
}

class ToolbarWidgetClass implements Widget {
    id = 'toolbar-widget';

    props: any;
    setProps: (props: Partial<any>) => void = () => { };

    constructor(props: any) {
        this.props = { ...props };
    }

    onAdd() {
        return this.props.element;
    }
}

export const ToolbarWidget = (props: ToolbarWidgetProps) => {
    const element = useMemo(() => {
        const el = document.createElement('div');
        el.className = 'deck-widget';
        return el;
    }, []);
    useWidget(ToolbarWidgetClass, { ...props, element });
    return createPortal(
        <div className="flex flex-col gap-2">
            <ToolbarButton
                icon={<Hand size={20} />}
                label="Select"
                isActive={props.activeTool === 'select'}
                onClick={() => props.onToolChange('select')}
            />
            <ToolbarButton
                icon={<Spline size={20} />}
                label="Add Street"
                isActive={props.activeTool === 'draw'}
                onClick={() => props.onToolChange('draw')}
            />
        </div>,
        element
    );
}

interface ToolbarButtonProps {
    icon: React.ReactNode;
    label: string;
    isActive?: boolean;
    onClick: () => void;
}

const ToolbarButton = ({ icon, label, isActive = false, onClick }: ToolbarButtonProps) => {
    const [isHovered, setIsHovered] = useState(false);
    
    return (
        <button 
            className={`pointer-events-auto cursor-pointer w-full border rounded-md p-3 relative flex items-center transition-colors ${
                isActive 
                    ? 'border-blue-500 bg-blue-100/70 text-blue-700' 
                    : 'border-gray-300 bg-gray-100/70 hover:bg-gray-200/70'
            }`}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="flex items-center justify-center">
                {icon}
            </div>
            {isHovered && (
                <span className="absolute left-full ml-2 whitespace-nowrap bg-gray-800/70 text-white px-2 py-1 rounded text-sm italic">
                    {label}
                </span>
            )}
        </button>
    );
};