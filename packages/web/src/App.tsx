import { NavLink, Route, Routes } from "react-router-dom";
import { NewResearchPage } from "./pages/NewResearchPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { ResearchDetailPage } from "./pages/ResearchDetailPage.js";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `navlink${isActive ? " navlink--active" : ""}`;

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="topbar__brand" aria-label="Udaan home">
          <span className="topbar__mark">U</span>
          <span className="topbar__name">Udaan</span>
          <span className="topbar__tag">Research Synthesis</span>
        </NavLink>
        <nav className="topbar__nav" aria-label="Primary">
          <NavLink to="/" end className={navClass}>
            New Research
          </NavLink>
          <NavLink to="/history" className={navClass}>
            History
          </NavLink>
        </nav>
      </header>

      <div className="main">
        <Routes>
          <Route path="/" element={<NewResearchPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/research/:id" element={<ResearchDetailPage />} />
        </Routes>
      </div>
    </div>
  );
}
