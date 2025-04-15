import { useMemo, useState } from "react";
import type { Widget } from "@deck.gl/core";
import { useWidget } from "@deck.gl/react";
import { createPortal } from "react-dom";
import { Hand, Spline } from "lucide-react";


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

export const ToolbarWidget = (props: any) => {
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
                onClick={() => { }}
            />
            <ToolbarButton
                icon={<Spline size={20} />}
                label="Add Street"
                onClick={() => { }}
            />
        </div>,
        element
    );
}

interface ToolbarButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}

const ToolbarButton = ({ icon, label, onClick }: ToolbarButtonProps) => {
    const [isHovered, setIsHovered] = useState(false);
    
    return (
        <button 
            className="pointer-events-auto cursor-pointer w-full border border-gray-300 rounded-md bg-gray-100/70 p-3 relative flex items-center"
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