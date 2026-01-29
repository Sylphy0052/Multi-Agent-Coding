import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { InputPage } from "./pages/InputPage";
import { JobListPage } from "./pages/JobListPage";
import { JobDetailPage } from "./pages/JobDetailPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <nav className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center space-x-8">
                <Link
                  to="/"
                  className="text-xl font-bold text-indigo-600"
                >
                  Multi-Agent Orchestrator
                </Link>
                <Link
                  to="/jobs"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Jobs
                </Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<InputPage />} />
            <Route path="/jobs" element={<JobListPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
