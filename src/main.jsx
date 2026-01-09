import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import * as ort from 'onnxruntime-web';

// Manually set wasm paths to root, where we copied them
ort.env.wasm.wasmPaths = '/';


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
