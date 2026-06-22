import { NavLink, Route, Routes } from "react-router-dom";
import { NewResearchPage } from "./pages/NewResearchPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { ResearchDetailPage } from "./pages/ResearchDetailPage.js";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `nav__link${isActive ? " nav__link--active" : ""}`;

export function App() {
  return (
    <div className="app">
      <header className="masthead">
        <NavLink to="/" className="masthead__brand">
          <span className="masthead__mark">Udaan</span>
          <span className="masthead__tag">Research Synthesis Engine</span>
        </NavLink>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end className={navClass}>
            New Research
          </NavLink>
          <NavLink to="/history" className={navClass}>
            History
          </NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<NewResearchPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/research/:id" element={<ResearchDetailPage />} />
      </Routes>

      <footer className="foot">
        <span>Udaan Research Agent</span>
        <span className="foot__note">Claims you can click through to the source.</span>
      </footer>
    </div>
  );
}
