import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import './styles.css';
import './paperProfilesClosure.css';
import './paperProfilesLayoutHotfix.css';
import './layoutSystem.css';
import './components/ui/ui.css';
import './components/ui/inputs.css';
import './components/ui/Card.css';
import './components/ui/CardDetail.css';
import './components/dialogClose.css';
import './experienceSystem.css';
import './templatesLibrary.css';
import './templatesEditor.css';
import './templatesRowMenu.css';
import './paperProfilesLibrary.css';
import './paperProfilesLibraryGeometryHotfix.css';
import './paperProfilesEditor.css';
import './paperProfilesCompletion.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
