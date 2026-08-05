import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { NetworksProvider } from './context/NetworksContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Transactions from './pages/Transactions';
import TransactionDetail from './pages/TransactionDetail';
import Address from './pages/Address';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <NetworksProvider>
      <WalletProvider>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col font-sans">
            <Navbar />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/txs" element={<Transactions />} />
                <Route path="/tx/:hash" element={<TransactionDetail />} />
                <Route path="/address/:address" element={<Address />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </BrowserRouter>
      </WalletProvider>
    </NetworksProvider>
  );
}
