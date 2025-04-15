import React, { useMemo } from "react";
import type { Widget } from "@deck.gl/core";
import { useWidget } from "@deck.gl/react";
import { createPortal } from "react-dom";
import { GitBranchPlus } from "lucide-react";


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
        <div className="deck-widget-button-group vertical">
            <div className="deck-widget-button">
                <GitBranchPlus></GitBranchPlus>
            </div>
            <div className="deck-widget-button !bg-blue-500">
                B
            </div>
        </div>,
        element
    );
}