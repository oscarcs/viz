import {
    FlyToInterpolator,
    WebMercatorViewport,
    _GlobeViewport,
    _deepEqual as deepEqual,
    _applyStyles as applyStyles,
    _removeStyles as removeStyles
} from '@deck.gl/core';
import type { Deck, Viewport, Widget, WidgetPlacement } from '@deck.gl/core';
import { CompassWidgetProps } from 'deck.gl';
import { createRoot, Root } from 'react-dom/client';
import { useWidget } from "@deck.gl/react";

class CustomCompassWidgetClass implements Widget<CompassWidgetProps> {
    id = 'compass';
    props: CompassWidgetProps;
    placement: WidgetPlacement = 'bottom-left';
    viewId?: string | null = null;
    viewports: { [id: string]: Viewport } = {};
    deck?: Deck<any>;
    element?: HTMLDivElement;
    root?: Root;

    constructor(props: CompassWidgetProps) {
        this.id = props.id ?? this.id;
        this.viewId = props.viewId ?? this.viewId;
        this.placement = props.placement ?? this.placement;

        this.props = {
            ...props,
            transitionDuration: props.transitionDuration ?? 200,
            label: props.label ?? 'Reset Compass',
            style: props.style ?? {}
        };
    }

    setProps(props: Partial<CompassWidgetProps>) {
        this.placement = props.placement ?? this.placement;
        this.viewId = props.viewId ?? this.viewId;
        const oldProps = this.props;
        const el = this.element;
        if (el) {
            if (oldProps.className !== props.className) {
                if (oldProps.className) el.classList.remove(oldProps.className);
                if (props.className) el.classList.add(props.className);
            }

            if (!deepEqual(oldProps.style, props.style, 1)) {
                removeStyles(el, oldProps.style);
                applyStyles(el, props.style);
            }
        }

        Object.assign(this.props, props);
        this.update();
    }

    onViewportChange(viewport: Viewport) {
        // no need to update if viewport is the same
        if (!viewport.equals(this.viewports[viewport.id])) {
            this.viewports[viewport.id] = viewport;
            this.update();
        }
    }

    onAdd({ deck }: { deck: Deck<any> }): HTMLDivElement {
        const { style, className } = this.props;
        const element = document.createElement('div');
        element.classList.add('deck-widget', 'deck-widget-custom-compass');
        
        if (className) element.classList.add(className);
        applyStyles(element, style);
        
        this.deck = deck;
        this.element = element;
        this.root = createRoot(element);
        this.update();
        
        return element;
    }

    getRotation(viewport?: Viewport) {
        if (viewport instanceof WebMercatorViewport) {
            return [-viewport.bearing, viewport.pitch];
        }
        else if (viewport instanceof _GlobeViewport) {
            return [0, Math.max(-80, Math.min(80, viewport.latitude))];
        }
        return [0, 0];
    }

    private update() {
        const viewId = this.viewId || Object.values(this.viewports)[0]?.id || 'default-view';
        const viewport = this.viewports[viewId];
        const [rz] = this.getRotation(viewport);
        const root = this.root;
        if (!root) {
            return;
        }
        const ui = (
            <div>
                <button
                    type="button"
                    className="pointer-events-auto cursor-pointer w-full border border-gray-300 rounded-md bg-gray-100/70 p-1 relative flex items-center justify-center"
                    onClick={() => {
                        for (const viewport of Object.values(this.viewports)) {
                            this.handleCompassReset(viewport);
                        }
                    }}
                >
                    <svg fill="none" width="30" height="30" viewBox="0 0 26 26">
                        <g transform={`rotate(${rz},13,13)`}>
                            <path
                                d="M10 13.0001L12.9999 5L15.9997 13.0001H10Z"
                                fill="var(--icon-compass-north-color, #F05C44)"
                            />
                            <path
                                d="M16.0002 12.9999L13.0004 21L10.0005 12.9999H16.0002Z"
                                fill="var(--icon-compass-south-color, #C2C2CC)"
                            />
                        </g>
                    </svg>
                </button>
            </div>
        );
        root.render(ui);
    }

    onRemove() {
        this.root?.unmount();
        this.root = undefined;
        this.deck = undefined;
        this.element = undefined;
    }

    handleCompassReset(viewport: Viewport) {
        const viewId = this.viewId || viewport.id || 'default-view';
        if (viewport instanceof WebMercatorViewport) {
            const nextViewState = {
                ...viewport,
                bearing: 0,
                ...(this.getRotation(viewport)[0] === 0 ? { pitch: 0 } : {}),
                transitionDuration: this.props.transitionDuration,
                transitionInterpolator: new FlyToInterpolator()
            };
            // @ts-ignore Using private method temporary until there's a public one
            this.deck._onViewStateChange({ viewId, viewState: nextViewState, interactionState: {} });
        }
    }
}

export const CustomCompassWidget = (props: CompassWidgetProps = {}) => {
    useWidget(CustomCompassWidgetClass, props);
    return null;
  };
