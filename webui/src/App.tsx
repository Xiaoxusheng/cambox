import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { MonitorPage } from './pages/MonitorPage'
import { PlaybackPage } from './pages/PlaybackPage'
import { DashboardPage } from './pages/DashboardPage'
import { EventsPage } from './pages/EventsPage'
import { RecordingsPage } from './pages/RecordingsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LogsPage } from './pages/LogsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* v1.2：监控是默认路由；/live 并入监控视图 */}
        <Route path="/" element={<MonitorPage />} />
        <Route path="/playback" element={<PlaybackPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/live" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
