import { useMemo, useState } from "react";
import type { Widget } from "@deck.gl/core";
import { useWidget } from "@deck.gl/react";
import { createPortal } from "react-dom";
import { Spline } from "lucide-react";


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
                icon={<Spline />}
                label="Add Street"
                onClick={() => {
                    props.onAddStreet();
                }}
            />
            <ToolbarButton
                icon={<p>B</p>}
                label="Add Block"
                onClick={() => {
                    props.onAddBlock();
                }}
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
            className="border border-gray-300 rounded-md bg-gray-100 p-2 relative flex items-center"
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="flex items-center justify-center">
                {icon}
            </div>
            {isHovered && (
                <span className="absolute left-full ml-2 whitespace-nowrap bg-gray-700 text-white px-2 py-1 rounded text-sm">
                    {label}
                </span>
            )}
        </button>
    );
};