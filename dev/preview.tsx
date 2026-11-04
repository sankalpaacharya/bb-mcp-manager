import { createRoot } from "react-dom/client";
import { useState } from "react";
import { InventoryView } from "../src/inventory-view";
import { sampleInventory } from "./sample-data";
import "../src/library.css";
function Preview() {
  const [inventory, setInventory] = useState(sampleInventory);
  const [light, setLight] = useState(false);
  return (
    <div className={`preview-app ${light ? "preview-light" : ""}`}>
      <div className="preview-note">
        <span>Design preview · Sample configurations</span>
        <button onClick={() => setLight(!light)}>
          {light ? "Dark appearance" : "Light appearance"}
        </button>
      </div>
      <InventoryView
        inventory={inventory}
        actions={{
          authenticate: async () => ({
            state: "manual",
            message: "Preview only",
            taskId: null,
            url: null,
            command: null,
          }),
          poll: async () => {
            throw new Error("Preview only");
          },
          cancel: async () => {
            throw new Error("Preview only");
          },
        }}
        pending={false}
        error={null}
        onRefresh={() =>
          setInventory({ ...inventory, scannedAt: new Date().toISOString() })
        }
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
