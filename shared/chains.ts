/**
 * EVM chain registry.
 *
 * Why a registry instead of hardcoding Polygon: the Nimiq docs contradict
 * themselves. The "Supported Networks" list is Ethereum / Arbitrum One /
 * Optimism / Base / BNB Smart Chain / Sepolia, but the very next sentence says
 * "ERC-20 tokens on any listed chain — including USDT on Polygon". Polygon is
 * not in that list. Rather than bet the app on which half is right, we support
 * all of them and resolve availability at runtime via wallet_switchEthereumChain.
 *
 * Note `decimals` is per-chain on purpose: USDT is 6dp nearly everywhere but
 * BSC-USD on BNB Smart Chain is 18dp. Treating that as a global constant is a
 * 10^12 error waiting to happen.
 */

export interface ChainConfig {
  chainId: number
  name: string
  shortName: string
  /** ERC-20 contract for the stablecoin we transfer. */
  token: string
  tokenSymbol: string
  decimals: number
  explorer: string
  /** Params for wallet_addEthereumChain if the wallet doesn't know the chain. */
  rpcUrls: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  /** Present in the docs' official "Supported Networks" list. */
  documented: boolean
}

export const CHAINS: Record<number, ChainConfig> = {
  137: {
    chainId: 137,
    name: 'Polygon',
    shortName: 'Polygon',
    token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    tokenSymbol: 'USDT',
    decimals: 6,
    explorer: 'https://polygonscan.com',
    rpcUrls: ['https://polygon-rpc.com'],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    documented: false, // named in prose, absent from the supported list
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    tokenSymbol: 'USDT',
    decimals: 6,
    explorer: 'https://arbiscan.io',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    documented: true,
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    shortName: 'Optimism',
    token: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    tokenSymbol: 'USDT',
    decimals: 6,
    explorer: 'https://optimistic.etherscan.io',
    rpcUrls: ['https://mainnet.optimism.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    documented: true,
  },
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    shortName: 'BNB Chain',
    token: '0x55d398326f99059fF775485246999027B3197955',
    tokenSymbol: 'USDT',
    decimals: 18, // BSC-USD is 18dp, unlike every other USDT deployment
    explorer: 'https://bscscan.com',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    documented: true,
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'Base',
    token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    tokenSymbol: 'USDT',
    decimals: 6,
    explorer: 'https://basescan.org',
    rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    documented: true,
  },
  1: {
    chainId: 1,
    name: 'Ethereum',
    shortName: 'Ethereum',
    token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    tokenSymbol: 'USDT',
    decimals: 6,
    explorer: 'https://etherscan.io',
    rpcUrls: ['https://eth.llamarpc.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    documented: true,
  },
}

/**
 * Order we offer chains in when creating a Kitty. Cheap-and-documented first:
 * a group pot dies if each contributor pays $4 of gas to chip in $5.
 */
export const CHAIN_PREFERENCE: number[] = [42161, 8453, 10, 56, 137, 1]

export const DEFAULT_CHAIN_ID = 42161

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

export function chainsInPreferenceOrder(): ChainConfig[] {
  return CHAIN_PREFERENCE.map((id) => CHAINS[id]).filter(Boolean)
}

/** `0x`-prefixed hex chain id, as EIP-1193 wants it. */
export function toHexChainId(chainId: number): string {
  return '0x' + chainId.toString(16)
}

export function parseChainId(hex: unknown): number | null {
  if (typeof hex === 'number') return hex
  if (typeof hex !== 'string') return null
  const n = Number.parseInt(hex, 16)
  return Number.isFinite(n) ? n : null
}
