import 'virtual:uno.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { ActivityBar } from './components/ActivityBar.js';
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
import { PRINT_FONT_FACE_CSS } from '@printerops/shared';

// The label print font: the canvas must measure the same glyphs the printer draws.
const printFontStyle = document.createElement('style');
printFontStyle.dataset.printopsFont = '';
printFontStyle.textContent = PRINT_FONT_FACE_CSS;
document.head.appendChild(printFontStyle);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ActivityBar />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
