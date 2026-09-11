import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/common/Toast'
import { DialogProvider } from './context/DialogContext'
import { DataProvider } from './context/DataContext'
import { AppLayout } from './components/layout/AppLayout'
import { LoginPage } from './pages/Login'
import { ProfilesPage } from './pages/Profiles'
import { ProvidersPage } from './pages/Providers'
import { BaseYamlPage } from './pages/BaseYaml'
import { LogsPage } from './pages/Logs'
import { getEntrancePrefix } from './services/api'

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <DialogProvider>
        <BrowserRouter basename={getEntrancePrefix()}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <DataProvider>
                <AppLayout />
              </DataProvider>
            }
          >
            <Route index element={<Navigate to="/profiles" replace />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/base-yaml" element={<BaseYamlPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/profiles" replace />} />
        </Routes>
      </BrowserRouter>
      </DialogProvider>
    </ToastProvider>
  )
}
