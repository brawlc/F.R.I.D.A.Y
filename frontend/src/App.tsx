/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Terminal } from './components/Terminal';
import { useEffect, useState } from 'react';
import { getStorageWarning } from './services/storage';
import { AppErrorBoundary } from './components/AppErrorBoundary';

export default function App() {
  const [storageWarning, setStorageWarning] = useState(getStorageWarning);
  useEffect(() => {
    const update = () => setStorageWarning(getStorageWarning());
    update();
    window.addEventListener('friday:storage-warning', update);
    return () => window.removeEventListener('friday:storage-warning', update);
  }, []);
  return (
    <main className="w-full h-screen">
      {storageWarning && <div role="alert" className="fixed bottom-0 left-0 right-0 z-[9999] bg-amber-950 p-3 text-sm text-amber-100">{storageWarning}</div>}
      <AppErrorBoundary><Terminal /></AppErrorBoundary>
    </main>
  );
}

