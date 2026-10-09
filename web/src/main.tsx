import { createRoot } from "react-dom/client";
import { Player } from "./Player";
import { Results } from "./Results";

const isPlayer = location.pathname.startsWith("/player");
createRoot(document.getElementById("root")!).render(isPlayer ? <Player /> : <Results />);
