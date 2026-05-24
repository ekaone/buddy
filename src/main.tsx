import React from "react"
import ReactDOM from "react-dom/client"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import App from "./App"
import Selector from "./Selector"
import "./index.css"

const label = getCurrentWebviewWindow().label

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {label === "selector" ? <Selector /> : <App />}
  </React.StrictMode>
)
