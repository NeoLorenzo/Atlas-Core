import "./App.css";
import { GameCanvas } from "../map/GameCanvas";

export function App() {
  return (
    <div className="app">
      <div className="app__title">Atlas Core: January 2025</div>
      <GameCanvas />
    </div>
  );
}
