import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError('No browser wallet found. Install MetaMask or another EVM wallet extension.');
      return;
    }
    try {
      setConnecting(true);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const cid = await window.ethereum.request({ method: 'eth_chainId' });
      setAddress(accounts[0]);
      setChainId(cid);
    } catch (e) {
      setError(e?.message || 'Connection was rejected.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accs) => setAddress(accs[0] || null);
    const onChain = (cid) => setChainId(cid);
    window.ethereum.on?.('accountsChanged', onAccounts);
    window.ethereum.on?.('chainChanged', onChain);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccounts);
      window.ethereum.removeListener?.('chainChanged', onChain);
    };
  }, []);

  return (
    <WalletContext.Provider value={{ address, chainId, connecting, error, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
