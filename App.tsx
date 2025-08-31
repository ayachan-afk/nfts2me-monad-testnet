
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ethers, Log } from "ethers";
import { TokenType, MintItem, CollSummary, ContractMeta } from './types';
// FIX: import ZERO_TOPIC to resolve "Cannot find name" errors.
import { HTTP_URL, WS_URL, ZERO_ADDR, ZERO_TOPIC, TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC, METADATA_ABI, MINT_CONTRACT_WHITELIST, CHAIN_ID } from './constants';

const shortenAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const SpinnerIcon: React.FC<{ className: string }> = ({ className }) => (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);


export default function App() {
  const [httpProvider, setHttpProvider] = useState<ethers.JsonRpcProvider | null>(null);
  const [wsProvider, setWsProvider] = useState<ethers.WebSocketProvider | null>(null);
  const [latestBlock, setLatestBlock] = useState<number | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mints, setMints] = useState<MintItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CollSummary>>({});
  const metaCache = useRef<Map<string, ContractMeta>>(new Map());
  const [modalContract, setModalContract] = useState<string | null>(null);

  // Init providers
  useEffect(() => {
    const http = new ethers.JsonRpcProvider(HTTP_URL);
    setHttpProvider(http);
    try {
        const ws = new ethers.WebSocketProvider(WS_URL);
        setWsProvider(ws);
        return () => {
            ws.destroy().catch(console.error);
        };
    } catch (e) {
        console.error("WebSocket provider connection failed:", e);
        setWsProvider(null);
    }
  }, []);

  // Keep latest block for default range
  useEffect(() => {
    if (!httpProvider) return;
    let alive = true;
    const fetchBlockNumber = async () => {
        try {
            const n = await httpProvider.getBlockNumber();
            if (!alive) return;
            setLatestBlock(Number(n));
        } catch (e) {
            if (alive) console.error("Failed to fetch latest block:", e);
        }
    };
    
    fetchBlockNumber();
    const int = setInterval(fetchBlockNumber, 5000);
    return () => {
      alive = false;
      clearInterval(int);
    };
  }, [httpProvider]);

  const logFilter = useMemo(
    () => ({
      topics: [[TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]],
    }),
    []
  );

  const allowedMintContracts = useMemo(() => new Set(MINT_CONTRACT_WHITELIST.map(a => a.toLowerCase())), []);

  const processLog = useCallback((log: Log): MintItem[] => {
    const results: MintItem[] = [];
    const baseItem = {
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.index,
      contract: ethers.getAddress(log.address),
    };

    try {
      switch (log.topics[0]) {
        case TRANSFER_TOPIC: // ERC-20 or ERC-721
          if (log.topics[1] === ZERO_TOPIC) {
            const to = ethers.getAddress(`0x${log.topics[2].slice(26)}`);
            if (log.topics.length === 4) { // ERC-721
              results.push({
                ...baseItem,
                to,
                type: TokenType.ERC721,
                tokenId: ethers.toBigInt(log.topics[3]).toString(),
              });
            } else { // ERC-20
              const amount = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data)[0];
              results.push({
                ...baseItem,
                to,
                type: TokenType.ERC20,
                amount: amount.toString(),
              });
            }
          }
          break;
        case TRANSFER_SINGLE_TOPIC: // ERC-1155 Single
          if (log.topics[2] === ZERO_TOPIC) {
            const to = ethers.getAddress(`0x${log.topics[3].slice(26)}`);
            const [id, value] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data);
            results.push({
              ...baseItem,
              to,
              type: TokenType.ERC1155,
              tokenId: id.toString(),
              amount: value.toString(),
            });
          }
          break;
        case TRANSFER_BATCH_TOPIC: // ERC-1155 Batch
          if (log.topics[2] === ZERO_TOPIC) {
            const to = ethers.getAddress(`0x${log.topics[3].slice(26)}`);
            const [ids, values] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256[]'], log.data);
            for (let i = 0; i < ids.length; i++) {
              results.push({
                ...baseItem,
                logIndex: baseItem.logIndex + i * 0.001, // pseudo-unique index for keys
                to,
                type: TokenType.ERC1155,
                tokenId: ids[i].toString(),
                amount: values[i].toString(),
              });
            }
          }
          break;
      }
    } catch (e) {
      console.error("Error processing log:", log, e);
    }
    return results;
  }, []);

  const fetchTimestamp = useCallback(async (blockNumber: number): Promise<number | undefined> => {
    if (!httpProvider) return undefined;
    try {
      const blk = await httpProvider.getBlock(blockNumber);
      return blk?.timestamp ? Number(blk.timestamp) : undefined;
    } catch {
      return undefined;
    }
  }, [httpProvider]);

  const enrichCollection = useCallback(async (addr: string, type: TokenType) => {
    if (!httpProvider || metaCache.current.has(addr)) return;
    
    metaCache.current.set(addr, {});

    try {
      const c = new ethers.Contract(addr, METADATA_ABI, httpProvider);
      const promises: Promise<any>[] = [c.name(), c.symbol()];
      if (type === TokenType.ERC20) {
        promises.push(c.decimals());
      }
      const [nameRes, symbolRes, decimalsRes] = await Promise.allSettled(promises);
      
      const meta: ContractMeta = {
        name: nameRes.status === "fulfilled" ? nameRes.value : undefined,
        symbol: symbolRes.status === "fulfilled" ? symbolRes.value : undefined,
        decimals: decimalsRes?.status === "fulfilled" ? Number(decimalsRes.value) : undefined,
      };
      
      metaCache.current.set(addr, meta);

      setSummaries((prev) => {
        const cur = prev[addr];
        if (!cur) return prev;
        return { ...prev, [addr]: { ...cur, ...meta } };
      });
    } catch (e) {
      // ignore metadata errors
    }
  }, [httpProvider]);

  const upsertSummary = useCallback((item: MintItem) => {
    setSummaries((prev) => {
      const addr = item.contract;
      const cur = prev[addr] || {
        address: addr,
        type: item.type,
        name: metaCache.current.get(addr)?.name,
        symbol: metaCache.current.get(addr)?.symbol,
        decimals: metaCache.current.get(addr)?.decimals,
        totalMintEvents: 0,
        uniqueTokens: 0,
        tokenIds: new Set<string>(),
      };
      const tokenIds = new Set(cur.tokenIds);
      if (item.tokenId) {
        tokenIds.add(item.tokenId);
      }
      const next: CollSummary = {
        ...cur,
        tokenIds,
        uniqueTokens: tokenIds.size,
        totalMintEvents: cur.totalMintEvents + 1,
      };
      return { ...prev, [addr]: next };
    });
  }, []);
  
  const processNewItems = useCallback(async (newItems: MintItem[]) => {
      if (newItems.length === 0) return;
      const byBlock = new Map<number, MintItem[]>();
      for (const it of newItems) {
        upsertSummary(it);
        if (!metaCache.current.has(it.contract)) {
          enrichCollection(it.contract, it.type);
        }
        const arr = byBlock.get(it.blockNumber) || [];
        arr.push(it);
        byBlock.set(it.blockNumber, arr);
      }
      
      for (const [bn, arr] of byBlock) {
        const ts = await fetchTimestamp(bn);
        arr.forEach((it) => (it.timestamp = ts));
      }
      
      setMints(prev => [...newItems, ...prev].sort((a,b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex));

  }, [upsertSummary, enrichCollection, fetchTimestamp]);
  
  const startLive = useCallback(() => {
    if (!wsProvider || !httpProvider || subscribing) {
        if (!wsProvider) {
            setError("WebSocket provider not available. Cannot start live feed.");
        }
        return;
    }

    setMints([]);
    setSummaries({});
    metaCache.current.clear();
    setError(null);
    setSubscribing(true);

    const listener = async (log: Log) => {
        try {
            const tx = await httpProvider.getTransaction(log.transactionHash);
            if (tx && tx.to && allowedMintContracts.has(tx.to.toLowerCase())) {
                const newItems = processLog(log);
                if (newItems.length > 0) {
                    await processNewItems(newItems);
                }
            }
        } catch (e) {
            console.error("Error processing live log:", e);
        }
    };

    wsProvider.on(logFilter, listener);

  }, [wsProvider, httpProvider, subscribing, logFilter, allowedMintContracts, processLog, processNewItems]);

  const stopLive = useCallback(() => {
    if (!wsProvider) return;
    wsProvider.removeAllListeners();
    setSubscribing(false);
  }, [wsProvider]);
  
  const summaryList = useMemo(() => Object.values(summaries).sort((a, b) => b.totalMintEvents - a.totalMintEvents), [summaries]);

  const formatAmount = (amountStr?: string, decimals?: number) => {
    if (!amountStr) return 'N/A';
    try {
      return ethers.formatUnits(amountStr, decimals ?? 18);
    } catch {
      return amountStr;
    }
  };

  const fmtTime = (ts?: number) => {
    if (!ts) return "-";
    return new Date(ts * 1000).toLocaleString();
  };

  const getTypePill = (type: TokenType) => {
    const colors: Record<TokenType, string> = {
      [TokenType.ERC20]: "bg-blue-500/20 text-blue-300",
      [TokenType.ERC721]: "bg-purple-500/20 text-purple-300",
      [TokenType.ERC1155]: "bg-teal-500/20 text-teal-300",
    };
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[type]}`}>
            {type}
        </span>
    );
  };
  
  const handleRowClick = (item: MintItem) => {
    if (item.type === TokenType.ERC721 || item.type === TokenType.ERC1155) {
        setModalContract(item.contract);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex items-center justify-between gap-4">
            <div className="flex items-center">
                <img src="https://app.nfts2me.com/assets/images/logo.svg" alt="NFTS2Me Logo" className="h-8 w-8 sm:h-10 sm:w-10 mr-3" />
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white">NFTS2Me Mint Tracker</h1>
            </div>
        </header>

        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-4 shadow-lg">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-400">Latest Block:</span>
                <span className="font-mono text-emerald-400">{latestBlock ?? "..."}</span>
            </div>
            <div className="flex gap-2">
                {!subscribing ? (
                    <button onClick={startLive} disabled={!wsProvider} className="px-6 py-2 rounded-lg bg-amber-600 text-white font-semibold shadow-md hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                      Live
                    </button>
                ) : (
                    <button onClick={stopLive} className="px-6 py-2 rounded-lg bg-red-600 text-white font-semibold shadow-md hover:bg-red-500 transition-all flex items-center gap-2">
                       <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                       </span>
                      Stop
                    </button>
                )}
            </div>
          </div>
          {error && <div className="mt-4 p-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm">{error}</div>}
        </div>
        
        <div className="space-y-8">
            <section>
                <h2 className="text-xl font-semibold mb-3 text-gray-200">Contract Summary</h2>
                <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/50">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-900/70">
                            <tr className="text-left text-gray-400">
                                <th className="px-4 py-3 font-medium">Contract</th>
                                <th className="px-4 py-3 font-medium">Type</th>
                                <th className="px-4 py-3 font-medium hidden md:table-cell">Address</th>
                                <th className="px-4 py-3 font-medium text-right">Mints</th>
                                <th className="px-4 py-3 font-medium text-right">Unique Tokens</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {summaryList.length === 0 ? (
                                <tr><td className="px-4 py-4 text-center text-gray-500" colSpan={5}>No data yet. Click "Live" to start.</td></tr>
                            ) : (
                                summaryList.map(s => (
                                    <tr key={s.address} className="hover:bg-gray-800/60">
                                        <td className="px-4 py-3 font-semibold text-white">{s.name || "Unknown"} {s.symbol ? `(${s.symbol})` : ""}</td>
                                        <td className="px-4 py-3">{getTypePill(s.type)}</td>
                                        <td className="px-4 py-3 font-mono text-gray-400 hidden md:table-cell">{shortenAddress(s.address)}</td>
                                        <td className="px-4 py-3 font-mono text-right text-white">{s.totalMintEvents}</td>
                                        <td className="px-4 py-3 font-mono text-right text-white">{s.type === TokenType.ERC20 ? 'N/A' : s.uniqueTokens}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section>
                <h2 className="text-xl font-semibold mb-3 text-gray-200">All Mint Details</h2>
                <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/50">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-900/70">
                            <tr className="text-left text-gray-400">
                                <th className="px-4 py-3 font-medium">Time</th>
                                <th className="px-4 py-3 font-medium">Type</th>
                                <th className="px-4 py-3 font-medium">Contract</th>
                                <th className="px-4 py-3 font-medium hidden sm:table-cell">Recipient</th>
                                <th className="px-4 py-3 font-medium">Details</th>
                                <th className="px-4 py-3 font-medium hidden md:table-cell">Tx</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {mints.length === 0 ? (
                                <tr><td className="px-4 py-4 text-center text-gray-500" colSpan={6}>Waiting for mint events...</td></tr>
                            ) : (
                                mints.map(it => {
                                    const meta = metaCache.current.get(it.contract);
                                    const isNft = it.type === TokenType.ERC721 || it.type === TokenType.ERC1155;
                                    return (
                                        <tr key={`${it.txHash}-${it.logIndex}`} 
                                            onClick={() => handleRowClick(it)}
                                            className={`hover:bg-gray-800/60 ${isNft ? 'cursor-pointer' : ''}`}
                                        >
                                            <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtTime(it.timestamp)} <span className="text-gray-500 hidden sm:inline">({it.blockNumber})</span></td>
                                            <td className="px-4 py-3">{getTypePill(it.type)}</td>
                                            <td className="px-4 py-3 text-white">{meta?.name || shortenAddress(it.contract)}</td>
                                            <td className="px-4 py-3 font-mono text-gray-400 hidden sm:table-cell">{shortenAddress(it.to)}</td>
                                            <td className="px-4 py-3 font-mono text-amber-300">
                                              {it.type === TokenType.ERC721 && `ID: ${it.tokenId}`}
                                              {it.type === TokenType.ERC20 && `Amount: ${formatAmount(it.amount, meta?.decimals)}`}
                                              {it.type === TokenType.ERC1155 && `ID: ${it.tokenId}, Amt: ${it.amount}`}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-gray-400 hidden md:table-cell">{shortenAddress(it.txHash)}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>

        {modalContract && (
            <div 
                className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
                onClick={() => setModalContract(null)}
            >
                <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-xl w-full max-w-lg relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-4 border-b border-gray-700">
                        <h3 className="text-lg font-semibold text-white">NFT Collection</h3>
                        <button onClick={() => setModalContract(null)} className="text-gray-400 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="p-2">
                        <iframe
                            id='iframe-widget'
                            src={`https://${modalContract.toLowerCase()}_${CHAIN_ID}.nfts2.me/?widget=classic&hideBanner=true`}
                            style={{ height: '515px', width: '100%', border: 'none', borderRadius: '0 0 1rem 1rem' }}
                            title="NFT Widget"
                            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                        ></iframe>
                    </div>
                </div>
            </div>
        )}

        <footer className="text-center text-xs text-gray-500 pt-4 border-t border-gray-800">
          <p>
            This website only displays NFT mint transactions from NFTs created through the{' '}
            <a href="https://nfts2me.com/" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
              NFTS2ME
            </a>{' '}
            platform.
          </p>
          <p className="mt-2">
            made with love by{' '}
            <a href="https://x.com/wedhanr" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
              wedhanr
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
