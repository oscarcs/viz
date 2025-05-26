import React from "react";
import type { Widget, WidgetPlacement } from "@deck.gl/core";
import { useWidget } from "@deck.gl/react";
import { createRoot, Root } from "react-dom/client";
import { ToolType } from "./ToolbarWidget";

interface KeyboardShortcut {
    key: string;
    description: string;
}

interface KeyboardShortcutsWidgetProps {
    activeTool: ToolType;
    placement?: WidgetPlacement;
    className?: string;
    style?: React.CSSProperties;
}

const KeyboardShortcutsUI: React.FC<{
    shortcuts: KeyboardShortcut[];
    className?: string;
    style?: React.CSSProperties;
}> = ({ shortcuts, className, style }) => {
    if (shortcuts.length === 0) {
        return null;
    }

    return (
        <div
            className={`pointer-events-none bg-gray-100/70 border border-gray-300 rounded-md px-3 py-2 backdrop-blur-sm shadow-sm ${className || ''}`}
            style={style}
        >
            <div className="flex items-center gap-4 text-xs">
                {shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                        <kbd className="bg-white border border-gray-300 text-gray-700 px-1.5 py-0.5 rounded text-xs font-mono shadow-sm">
                            {shortcut.key}
                        </kbd>
                        <span className="text-gray-600">{shortcut.description}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const getShortcutsForTool = (tool: ToolType): KeyboardShortcut[] => {
    switch (tool) {
        case 'draw':
            return [
                { key: 'ENTER', description: 'Complete street' },
                { key: 'ESC', description: 'Cancel' },
                { key: 'SHIFT', description: 'Disable snapping' }
            ];
        case 'select':
            return [];
        default:
            return [];
    }
};

class KeyboardShortcutsWidgetClass implements Widget<KeyboardShortcutsWidgetProps> {
    id = 'keyboard-shortcuts';
    props: KeyboardShortcutsWidgetProps;
    placement: WidgetPlacement = 'bottom-right';
    element?: HTMLDivElement;
    root?: Root;

    constructor(props: KeyboardShortcutsWidgetProps) {
        this.placement = props.placement ?? this.placement;
        this.props = {
            ...props,
            style: props.style ?? {}
        };
    }

    setProps(props: Partial<KeyboardShortcutsWidgetProps>) {
        this.placement = props.placement ?? this.placement;
        Object.assign(this.props, props);
        this.update();
    }

    onAdd(): HTMLDivElement {
        const { style, className } = this.props;
        const element = document.createElement('div');
        element.classList.add('deck-widget', 'deck-widget-keyboard-shortcuts');
        
        if (className) element.classList.add(className);
        if (style) {
            Object.assign(element.style, style);
        }
        
        this.element = element;
        this.root = createRoot(element);
        this.update();
        
        return element;
    }

    private update() {
        const root = this.root;
        if (!root) {
            return;
        }

        const shortcuts = getShortcutsForTool(this.props.activeTool);

        root.render(
            <KeyboardShortcutsUI
                shortcuts={shortcuts}
                className={this.props.className}
                style={this.props.style as React.CSSProperties}
            />
        );
    }

    onRemove() {
        const root = this.root;
        // defer unmount to avoid sync unmount during React render
        setTimeout(() => root?.unmount());
        this.root = undefined;
        this.element = undefined;
    }
}

export const KeyboardShortcutsWidget = (props: KeyboardShortcutsWidgetProps) => {
    useWidget(KeyboardShortcutsWidgetClass, props);
    return null;
};
