import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { LivePage } from './pages/LivePage'
import { PlaybackPage } from './pages/PlaybackPage'
import { EventsPage } from './pages/EventsPage'
import { RecordingsPage } from './pages/RecordingsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LogsPage } from './pages/LogsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/playback" element={<PlaybackPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/logs" element={<LogsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
