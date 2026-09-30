import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/noto-serif-jp';
import './design-system/global.css';
import App from './app/App';
import { AppProvider } from './app/AppContext';

createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><App/></AppProvider></StrictMode>);
