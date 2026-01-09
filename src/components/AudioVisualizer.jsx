import React, { useState, useEffect, useRef } from 'react';
import Plot from 'react-plotly.js';

const COLORS = {
    "buddy": "rgb(0,119,187)",
    "hey buddy": "rgb(0,153,136)",
    "hi buddy": "rgb(51,227,138)",
    "sup buddy": "rgb(238,119,51)",
    "yo buddy": "rgb(204,51,217)",
    "okay buddy": "rgb(238,51,119)",
    "hello buddy": "rgb(184,62,104)",
    "speech": "rgb(22,200,206)",
    "frame budget": "rgb(25,255,25)"
};

const WAKE_WORDS = ["buddy", "hey buddy", "hi buddy", "sup buddy", "yo buddy", "okay buddy", "hello buddy"];
const MAX_HISTORY = 100;

export const AudioVisualizer = ({ probabilities, active, frameBudget }) => {
    // History state for all traces
    const [history, setHistory] = useState({
        "speech": [],
        "frame budget": [],
        ...WAKE_WORDS.reduce((acc, w) => ({ ...acc, [w]: [] }), {})
    });

    const requestRef = useRef();

    useEffect(() => {
        // We update history whenever props change (which frame by frame)
        // Actually, props change IS the tick.
        setHistory(prev => {
            const next = { ...prev };
            // Speech
            next["speech"] = [...prev["speech"], probabilities["speech"] || 0].slice(-MAX_HISTORY);

            // Frame Budget (normalized to 120ms?? Legacy did / 120.0)
            next["frame budget"] = [...prev["frame budget"], (frameBudget || 0) / 120.0].slice(-MAX_HISTORY);

            // Wake Words
            WAKE_WORDS.forEach(w => {
                next[w] = [...(prev[w] || []), probabilities[w] || 0].slice(-MAX_HISTORY);
            });
            return next;
        });
    }, [probabilities, frameBudget]);

    // Common layout config
    const layoutConfig = (title) => ({
        width: 640,
        height: 120, // slightly taller to fit title
        margin: { l: 30, r: 30, t: 30, b: 20 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        title: {
            text: title,
            font: { color: 'rgba(255,255,255,0.7)', size: 12, family: 'monospace' },
            x: 0.98,
            xanchor: 'right',
            y: 0.9,
            yanchor: 'top'
        },
        xaxis: { showgrid: false, zeroline: false, showticklabels: false, fixedrange: true },
        yaxis: { range: [0, 1.1], showgrid: true, gridcolor: 'rgba(255,255,255,0.1)', zeroline: false, showticklabels: false, fixedrange: true },
        showlegend: title === 'WAKE WORDS',
        legend: { x: 0, y: 1, orientation: 'h', font: { color: 'white', size: 9 } }
    });

    // Helper to create trace
    const createTrace = (name, data, isActive) => ({
        y: data,
        type: 'scatter',
        mode: 'lines',
        name: name,
        line: {
            color: COLORS[name] || 'white',
            width: 2
        },
        fill: 'tozeroy',
        fillcolor: isActive ? COLORS[name].replace('rgb', 'rgba').replace(')', ', 0.5)') : 'rgba(0,0,0,0)'
        // Legacy opacity logic: isFrameBudget || active ? 1.0 : 0.5 (for line?)
        // Legacy: strokeStyle alpha = opacity. fillStyle alpha = opacity/2.
    });

    return (
        <div id="graphs">
            {/* Wake Words Graph */}
            <div className="graph-container">
                <Plot
                    data={WAKE_WORDS.map(w => createTrace(w, history[w], active[w]))}
                    layout={layoutConfig('WAKE WORDS')}
                    config={{ displayModeBar: false, staticPlot: true }}
                />
            </div>

            {/* Speech Graph */}
            <div className="graph-container">
                <Plot
                    data={[createTrace('speech', history['speech'], active['speech'])]}
                    layout={layoutConfig('SPEECH')}
                    config={{ displayModeBar: false, staticPlot: true }}
                />
            </div>

            {/* Frame Budget Graph */}
            <div className="graph-container">
                <Plot
                    data={[createTrace('frame budget', history['frame budget'], true)]}
                    layout={layoutConfig('FRAME BUDGET')}
                    config={{ displayModeBar: false, staticPlot: true }}
                />
            </div>
        </div>
    );
};
