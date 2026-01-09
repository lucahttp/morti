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
        "speech": new Array(MAX_HISTORY).fill(0),
        "frame budget": new Array(MAX_HISTORY).fill(0),
        ...WAKE_WORDS.reduce((acc, w) => ({ ...acc, [w]: new Array(MAX_HISTORY).fill(0) }), {})
    });

    useEffect(() => {
        setHistory(prev => {
            const next = { ...prev };
            // Speech
            // If probabilities is null/undefined (not listening), we push 0 or random noise?
            // User wants "always show". If not running, maybe flatline.
            const speechProb = probabilities?.["speech"] || 0;
            next["speech"] = [...prev["speech"].slice(1), speechProb];

            // Frame Budget
            next["frame budget"] = [...prev["frame budget"].slice(1), (frameBudget || 0) / 120.0];

            // Wake Words
            WAKE_WORDS.forEach(w => {
                const prob = probabilities?.[w] || 0;
                next[w] = [...prev[w].slice(1), prob];
            });
            return next;
        });
    }, [probabilities, frameBudget]);

    // Common layout config
    const layoutConfig = (title, height = 150) => ({
        width: null, // responsive
        height: height,
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        title: {
            text: title,
            font: { color: 'rgba(255,255,255,0.4)', size: 10, family: 'monospace' },
            x: 0,
            xanchor: 'left',
            y: 1,
            yanchor: 'top',
            pad: { l: 10 }
        },
        xaxis: { showgrid: false, zeroline: false, showticklabels: false, fixedrange: true },
        yaxis: { range: [0, 1.1], showgrid: true, gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, showticklabels: false, fixedrange: true },
        showlegend: false,
    });

    const createTrace = (name, data, isActive, colorOverride) => ({
        y: data,
        type: 'scatter',
        mode: 'lines',
        name: name,
        line: {
            color: colorOverride || COLORS[name] || 'white',
            width: 2,
            shape: 'spline',
            smoothing: 1.3
        },
        fill: 'tozeroy',
        fillcolor: (isActive && (probabilities?.[name] > 0.01)) ? (colorOverride || COLORS[name]).replace('rgb', 'rgba').replace(')', ', 0.2)') : 'rgba(0,0,0,0)',
        hoverinfo: 'none'
    });

    return (
        <div className="flex flex-col gap-4 w-full h-full p-4 overflow-hidden">
            {/* Main Viz: Speech & Models combined? Or separate for clarity? 
                User said "improve it". Stacking them looks like a dashboard.
            */}

            {/* Top: Wake Words Monitor */}
            <div className="glass-panel flex-1 relative flex flex-col justify-center overflow-hidden min-h-[120px]">
                <div className="absolute top-2 left-3 text-xs font-mono text-white/40 uppercase tracking-widest">Wake Word Detection</div>
                <div className="w-full h-full absolute inset-0">
                    <Plot
                        data={WAKE_WORDS.map(w => createTrace(w, history[w], active?.[w]))}
                        layout={{ ...layoutConfig('', 180), margin: { l: 0, r: 0, t: 0, b: 0 } }}
                        config={{ displayModeBar: false, staticPlot: true, responsive: true }}
                        style={{ width: "100%", height: "100%" }}
                        useResizeHandler={true}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 h-1/3 min-h-[100px]">
                {/* Speech Probability */}
                <div className="glass-panel relative overflow-hidden flex flex-col">
                    <div className="absolute top-2 left-3 text-xs font-mono text-white/40 uppercase tracking-widest">VAD Confidence</div>
                    <div className="w-full h-full absolute inset-0 top-4">
                        <Plot
                            data={[createTrace('speech', history['speech'], active?.['speech'], 'rgb(22, 200, 206)')]}
                            layout={{ ...layoutConfig('', 100), margin: { l: 0, r: 0, t: 0, b: 0 } }}
                            config={{ displayModeBar: false, staticPlot: true, responsive: true }}
                            style={{ width: "100%", height: "100%" }}
                            useResizeHandler={true}
                        />
                    </div>
                </div>

                {/* Frame Budget / Performance */}
                <div className="glass-panel relative overflow-hidden flex flex-col">
                    <div className="absolute top-2 left-3 text-xs font-mono text-white/40 uppercase tracking-widest">Inference Latency</div>
                    <div className="w-full h-full absolute inset-0 top-4">
                        <Plot
                            data={[createTrace('frame budget', history['frame budget'], true, 'rgb(50, 255, 100)')]}
                            layout={{ ...layoutConfig('', 100), margin: { l: 0, r: 0, t: 0, b: 0 } }}
                            config={{ displayModeBar: false, staticPlot: true, responsive: true }}
                            style={{ width: "100%", height: "100%" }}
                            useResizeHandler={true}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
