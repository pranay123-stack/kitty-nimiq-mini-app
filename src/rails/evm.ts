import { RailError, type ContributeParams, type ContributeResult, type PaymentRail, type RailAccount } from './types'
import { getChain, toHexChainId, parseChainId, type ChainConfig } from '../../shared/chains'
import { isValidEvmAddress } from '../../shared/addresses'

export { isValidEvmAddress } from '../../shared/addresses'

/** ERC-20 selectors. */
const SELECTOR_TRANSFER = '0xa9059cbb' // transfer(address,uint256)
const SELECTOR_BALANCE_OF = '0x70a08231' // balanceOf(address)

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

function provider(): Eip1193Provider {
  const eth = typeof window !== 'undefined' ? window.ethereum : undefined
  if (!eth) {
    throw new RailError(
      'No EVM wallet available. Open this inside Nimiq Pay.',
      'unavailable',
    )
  }
  return eth
}

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().padStart(64, '0')
}

export function encodeTransfer(to: string, amount: bigint): string {
  const addr = to.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(addr)) {
    throw new RailError('That wallet address looks wrong', 'invalid_address')
  }
  return SELECTOR_TRANSFER + pad32(addr) + pad32(amount.toString(16))
}

/**
 * EIP-1193 surfaces user rejection as code 4001 and an unknown chain as 4902.
 * Mapping these precisely is what separates "you cancelled, no problem" from a
 * scary red error — and rejection handling is explicitly graded.
 */
function classify(err: unknown): RailError {
  if (err instanceof RailError) return err
  const e = err as { code?: number | string; message?: string }
  const code = typeof e?.code === 'string' ? Number.parseInt(e.code, 10) : e?.code
  const message = e?.message ?? 'Transaction failed'

  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(message)) {
    return new RailError('Cancelled', 'rejected', err)
  }
  if (code === 4902) {
    return new RailError('That network is not available in your wallet', 'wrong_network', err)
  }
  if (/insufficient funds|exceeds balance|transfer amount exceeds/i.test(message)) {
    return new RailError('Not enough balance for this contribution', 'insufficient_funds', err)
  }
  return new RailError(message, 'failed', err)
}

export class EvmRail implements PaymentRail {
  readonly id = 'usdt' as const
  readonly chain: ChainConfig

  constructor(chainId: number) {
    const chain = getChain(chainId)
    if (!chain) throw new RailError(`Unsupported chain ${chainId}`, 'wrong_network')
    this.chain = chain
  }

  get symbol(): string {
    return this.chain.tokenSymbol
  }

  get decimals(): number {
    return this.chain.decimals
  }

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.ethereum
  }

  async connect(): Promise<RailAccount> {
    try {
      const accounts = (await provider().request({ method: 'eth_requestAccounts' })) as string[]
      const address = accounts?.[0]
      if (!address) throw new RailError('No wallet account available', 'unavailable')
      await this.ensureChain()
      return this.#account(address)
    } catch (err) {
      throw classify(err)
    }
  }

  async peek(): Promise<RailAccount | null> {
    try {
      const accounts = (await provider().request({ method: 'eth_accounts' })) as string[]
      return accounts?.[0] ? this.#account(accounts[0]) : null
    } catch {
      return null
    }
  }

  async currentChainId(): Promise<number | null> {
    try {
      return parseChainId(await provider().request({ method: 'eth_chainId' }))
    } catch {
      return null
    }
  }

  /**
   * Move the wallet to this Kitty's chain, adding it first if the wallet has
   * never heard of it. A pot is denominated on one chain, so this has to
   * succeed before we let the user approve anything.
   */
  async ensureChain(): Promise<void> {
    const current = await this.currentChainId()
    if (current === this.chain.chainId) return

    try {
      await provider().request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChainId(this.chain.chainId) }],
      })
    } catch (err) {
      const code = (err as { code?: number }).code
      if (code !== 4902) throw classify(err)
      // Unknown chain: offer to add it, then the switch is implicit.
      try {
        await provider().request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: toHexChainId(this.chain.chainId),
              chainName: this.chain.name,
              nativeCurrency: this.chain.nativeCurrency,
              rpcUrls: this.chain.rpcUrls,
              blockExplorerUrls: [this.chain.explorer],
            },
          ],
        })
      } catch (addErr) {
        throw classify(addErr)
      }
    }

    const after = await this.currentChainId()
    if (after !== this.chain.chainId) {
      throw new RailError(
        `Please switch your wallet to ${this.chain.name} to continue`,
        'wrong_network',
      )
    }
  }

  async tokenBalance(address: string): Promise<bigint> {
    const data = SELECTOR_BALANCE_OF + pad32(address.toLowerCase().replace(/^0x/, ''))
    const raw = (await provider().request({
      method: 'eth_call',
      params: [{ to: this.chain.token, data }, 'latest'],
    })) as string
    return raw && raw !== '0x' ? BigInt(raw) : 0n
  }

  async contribute({ to, amount }: ContributeParams): Promise<ContributeResult> {
    return this.#send(to, amount, 'Contribution failed')
  }

  async settle({ to, amount }: { to: string; amount: bigint }): Promise<ContributeResult> {
    return this.#send(to, amount, 'Payout failed')
  }

  async #send(to: string, amount: bigint, _fallback: string): Promise<ContributeResult> {
    if (!isValidEvmAddress(to)) {
      throw new RailError('That wallet address looks wrong', 'invalid_address')
    }
    if (amount <= 0n) {
      throw new RailError('Enter an amount above zero', 'failed')
    }

    await this.ensureChain()
    const account = await this.peek()
    const from = account?.address ?? (await this.connect()).address

    // Check balance before prompting: a native dialog that always fails is a
    // much worse experience than an inline "you need more USDT".
    try {
      const balance = await this.tokenBalance(from)
      if (balance < amount) {
        throw new RailError(
          `Not enough ${this.symbol} on ${this.chain.name}`,
          'insufficient_funds',
        )
      }
    } catch (err) {
      if (err instanceof RailError && err.code === 'insufficient_funds') throw err
      // A failed balance read shouldn't block the payment; let the wallet decide.
    }

    try {
      const txHash = (await provider().request({
        method: 'eth_sendTransaction',
        params: [{ from, to: this.chain.token, data: encodeTransfer(to, amount), value: '0x0' }],
      })) as string
      return { txHash: txHash.toLowerCase(), canonical: true }
    } catch (err) {
      throw classify(err)
    }
  }

  validateAddress(address: string): boolean {
    return isValidEvmAddress(address)
  }

  explorerTxUrl(txHash: string): string {
    return `${this.chain.explorer}/tx/${txHash}`
  }

  explorerAddressUrl(address: string): string {
    return `${this.chain.explorer}/address/${address}`
  }

  #account(address: string): RailAccount {
    const lower = address.toLowerCase()
    return { address: lower, short: `${lower.slice(0, 6)}…${lower.slice(-4)}` }
  }
}
