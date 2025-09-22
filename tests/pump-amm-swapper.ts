import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createSyncNativeInstruction,            // 🔶 新增
} from "@solana/spl-token";
import { PumpAmmSwapper } from "../target/types/pump_amm_swapper";

// ✅ 使用你项目里重命名后的 pAMM IDL
import PAMM_IDL from "../idls/pump_amm.json";

// 🔶🔶🔶 【新增导入 | 高亮修改】从 utils.ts 引入基于 types 的 Pool 解码
// ======  ⬇️⬇️⬇️  ======
import { fetchPoolViaTypes } from "./utils";
// ======  ⬆️⬆️⬆️  ======

import * as dotenv from "dotenv";
dotenv.config();

/* 其余常量保持不变 */
const PAMM_PROGRAM_ID = new web3.PublicKey(
  process.env.PAMM_PROGRAM_ID ?? "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);
const FEE_PROGRAM_ID = new web3.PublicKey(
  process.env.FEE_PROGRAM_ID ?? "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
const ATA_PROGRAM_ID = new web3.PublicKey(
  process.env.ATA_PROGRAM_ID ?? "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const PROXY_PROGRAM_ID = process.env.PROXY_PROGRAM_ID
  ? new web3.PublicKey(process.env.PROXY_PROGRAM_ID)
  : new web3.PublicKey("7vbo8W8myMRKZRogqsF5u4RwZtUhN7BaFJR41StrhPkU");

// Useless-WSOL
const POOL = process.env.POOL
  ? new web3.PublicKey(process.env.POOL)
  : new web3.PublicKey("kV16LmKrpP1vnNkRhHYcGz2MpGfQ2jVF89WPtWnMpRS");

console.log("print Useless coin on Pump: ", POOL);

anchor.setProvider(AnchorProvider.env());
const provider = AnchorProvider.env();
const connection = provider.connection;
const wallet = provider.wallet as any;

const proxy = anchor.workspace.PumpAmmSwapper as Program<PumpAmmSwapper>;
// pAMM 程序：用于读/解码
const pamm = new Program(PAMM_IDL as any, provider);
console.log("pAMM programId (from IDL):", pamm.programId.toBase58());

// ===== Helpers: PDA 推导（保持不变）=====
const eventAuthority = () =>
  web3.PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PAMM_PROGRAM_ID
  )[0];

const globalVolumeAccumulator = () =>
  web3.PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PAMM_PROGRAM_ID
  )[0];

const userVolumeAccumulator = (user: web3.PublicKey) =>
  web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), user.toBuffer()],
    PAMM_PROGRAM_ID
  )[0];

const coinCreatorVaultAuthority = (coinCreator: web3.PublicKey) =>
  web3.PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), coinCreator.toBuffer()],
    PAMM_PROGRAM_ID
  )[0];

// IDL 里给的第二个 32B seed（转成 PublicKey 以便 toBuffer）
const FEE_CONFIG_CONST_SEED = new web3.PublicKey(
  Uint8Array.from([
    12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101, 244, 41, 141, 49, 86,
    213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99,
  ])
);
const feeConfigPda = () =>
  web3.PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), FEE_CONFIG_CONST_SEED.toBuffer()],
    FEE_PROGRAM_ID
  )[0];

// 读取 mint 的 owner 来判断 Token program （保持不变）
async function tokenProgramForMint(mint: web3.PublicKey): Promise<web3.PublicKey> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  const owner = info.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unknown token program for mint ${mint.toBase58()}: ${owner}`);
}

// ComputeBudget（保持不变）
function withPriorityFee(
  ixs: web3.TransactionInstruction[],
  cuLimit = Number(process.env.CU_LIMIT ?? 500_000),
  microlamports = Number(process.env.PRIORITY_FEE ?? 2_000)
) {
  ixs.push(
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microlamports })
  );
}

// 🔶🔶🔶 新增：确保 user 的 WSOL 余额 >= 需要的 lamports
async function ensureWrappedSol(
  amountLamports: bigint | number,                // 需要准备的 WSOL 金额（单位：lamports）
  owner: web3.PublicKey,
) {
  // 1) 创建/拿到 WSOL ATA
  const wsolMint = new web3.PublicKey("So11111111111111111111111111111111111111112");
  const ataAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,         // 费用支付者
    wsolMint,
    owner,
    false,
    "confirmed",
    {},
    TOKEN_PROGRAM_ID
  );

  // 2) 看看当前 WSOL 余额是否足够
  //   amount 是 spl-token 的 u64；我们只关心够不够，不够就补齐
  const need = typeof amountLamports === "bigint" ? amountLamports : BigInt(amountLamports);
  const have = BigInt(ataAcc.amount.toString());

  if (have < need) {
    const delta = need - have;

    // 3) 把本地钱包的 SOL 转到 WSOL ATA，然后 syncNative
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: ataAcc.address,
        lamports: Number(delta),
      }),
      createSyncNativeInstruction(ataAcc.address)  // 同步，把 lamports 变成 WSOL 余额
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }

  return ataAcc.address;
}


// 🔶🔶🔶 【替换：加载 Pool 字段 | 高亮修改】
// ======  ⬇️⬇️⬇️  ======
async function loadPoolFields(poolPk: web3.PublicKey) {
  // 原来：const pool = await pamm.account.pool.fetch(poolPk);
  // 现在：通过 types 解码（保持官方 IDL 不变）
  const pool = await fetchPoolViaTypes(provider, pamm, poolPk);
  console.log("print Useless coin pool on Pump: ", pool);

  // 这里的 globalConfig / protocolFeeRecipient 不在 Pool 结构里，
  // 请通过环境变量或你掌握的来源注入（示例用 env）
  const gc = process.env.PAMM_GLOBAL_CONFIG;
  const pr = process.env.PAMM_FEE_RECIPIENT;
  console.log("print PAMM_GLOBAL_CONFIG: ", gc);
  console.log("print PAMM_FEE_RECIPIENT: ", pr);

  if (!gc || !pr) {
    throw new Error(
      "缺少 PAMM_GLOBAL_CONFIG 或 PAMM_FEE_RECIPIENT 环境变量，请提供全局配置与手续费接收地址。"
    );
  }
  const globalConfig = new web3.PublicKey(gc);
  const protocolFeeRecipient = new web3.PublicKey(pr);

  return {
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    poolBaseTokenAccount: pool.poolBaseTokenAccount,
    poolQuoteTokenAccount: pool.poolQuoteTokenAccount,
    coinCreator: pool.coinCreator,
    globalConfig,
    protocolFeeRecipient,
  };
}
// ======  ⬆️⬆️⬆️  ======

// 封装：BUY（保持不变，依赖 loadPoolFields 的返回）
async function buyAmm(
  poolPk: web3.PublicKey,
  baseAmountOut: BN,
  maxQuoteIn: BN
) {
  const {
    baseMint,
    quoteMint,
    poolBaseTokenAccount,
    poolQuoteTokenAccount,
    coinCreator,
    globalConfig,
    protocolFeeRecipient,
  } = await loadPoolFields(poolPk);

  const user = wallet.publicKey;

  const baseTokenProgram = await tokenProgramForMint(baseMint);
  const quoteTokenProgram = await tokenProgramForMint(quoteMint);

  // 🔶 修改：用户 ATA 用 getOrCreateAssociatedTokenAccount（会在不存在时自动创建）
  const userBaseATAAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,       // 费用支付者（本地 NodeWallet 有 payer）
    baseMint,
    user,
    false,
    "confirmed",
    {},
    baseTokenProgram
  );
  const userBaseATA = userBaseATAAcc.address; // 传账户地址即可

  // 🔶 修改：用户的 quote ATA 同理
  const userQuoteATAAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    quoteMint,
    user,
    false,
    "confirmed",
    {},
    quoteTokenProgram
  );
  const userQuoteATA = userQuoteATAAcc.address;

  // 🔶🔶🔶 新增：如果 quoteMint 是 WSOL，则在 BUY 前把 maxQuoteIn 金额的 SOL 包成 WSOL
  if (quoteMint.equals(new web3.PublicKey("So11111111111111111111111111111111111111112"))) {
    // maxQuoteIn 是 BN，把它转成 bigint（lamports）
    await ensureWrappedSol(BigInt(maxQuoteIn.toString()), user);
  }

  const protocolFeeRecipientATA = getAssociatedTokenAddressSync(
    quoteMint,
    protocolFeeRecipient,
    true,
    quoteTokenProgram,
    ATA_PROGRAM_ID
  );

  const creatorVaultAuth = coinCreatorVaultAuthority(coinCreator);
  const creatorVaultATA = getAssociatedTokenAddressSync(
    quoteMint,
    creatorVaultAuth,
    true,
    quoteTokenProgram,
    ATA_PROGRAM_ID
  );

  // PDAs
  const ea = eventAuthority();
  const gva = globalVolumeAccumulator();
  const uva = userVolumeAccumulator(user);
  const feeCfg = feeConfigPda();

  // OptionBool -> Some(true)
  const trackVolume = { some: true } as any;

  // 可选 priority fee
  const preIxs: web3.TransactionInstruction[] = [];
  withPriorityFee(preIxs);

  console.log("before buyAMM######");
  const sig = await proxy.methods
    .buy(baseAmountOut, maxQuoteIn, trackVolume)
    .accounts({
      pool: poolPk,
      user,
      globalConfig,
      baseMint,
      quoteMint,
      userBaseTokenAccount: userBaseATA,
      userQuoteTokenAccount: userQuoteATA,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount: protocolFeeRecipientATA,
      baseTokenProgram,
      quoteTokenProgram,
      // idl文件里已经写死，Anchor自动解析不能再传
      // systemProgram: web3.SystemProgram.programId,
      // associatedTokenProgram: ATA_PROGRAM_ID,
      eventAuthority: ea,
      program: PAMM_PROGRAM_ID,
      coinCreatorVaultAta: creatorVaultATA,
      coinCreatorVaultAuthority: creatorVaultAuth,
      globalVolumeAccumulator: gva,
      userVolumeAccumulator: uva,
      feeConfig: feeCfg,
      feeProgram: FEE_PROGRAM_ID,
    })
    .preInstructions(preIxs)
    .rpc();

  return sig;
}

// 封装：SELL（保持不变，依赖 loadPoolFields 的返回）
async function sellAmm(
  poolPk: web3.PublicKey,
  baseAmountIn: BN,
  minQuoteOut: BN
) {
  const {
    baseMint,
    quoteMint,
    poolBaseTokenAccount,
    poolQuoteTokenAccount,
    coinCreator,
    globalConfig,
    protocolFeeRecipient,
  } = await loadPoolFields(poolPk);

  const user = wallet.publicKey;

  const baseTokenProgram = await tokenProgramForMint(baseMint);
  const quoteTokenProgram = await tokenProgramForMint(quoteMint);

  // 🔶 修改：同 BUY，自动创建用户两个 ATA
  const userBaseATAAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    baseMint,
    user,
    false,
    "confirmed",
    {},
    baseTokenProgram
  );
  const userBaseATA = userBaseATAAcc.address;

  const userQuoteATAAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    quoteMint,
    user,
    false,
    "confirmed",
    {},
    quoteTokenProgram
  );
  const userQuoteATA = userQuoteATAAcc.address;

  const protocolFeeRecipientATA = getAssociatedTokenAddressSync(
    quoteMint,
    protocolFeeRecipient,
    true,
    quoteTokenProgram,
    ATA_PROGRAM_ID
  );

  const creatorVaultAuth = coinCreatorVaultAuthority(coinCreator);
  const creatorVaultATA = getAssociatedTokenAddressSync(
    quoteMint,
    creatorVaultAuth,
    true,
    quoteTokenProgram,
    ATA_PROGRAM_ID
  );

  const ea = eventAuthority();
  const feeCfg = feeConfigPda();

  const preIxs: web3.TransactionInstruction[] = [];
  withPriorityFee(preIxs);

  const sig = await proxy.methods
    .sell(baseAmountIn, minQuoteOut)
    .accounts({
      pool: poolPk,
      user,
      globalConfig,
      baseMint,
      quoteMint,
      userBaseTokenAccount: userBaseATA,
      userQuoteTokenAccount: userQuoteATA,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount: protocolFeeRecipientATA,
      baseTokenProgram,
      quoteTokenProgram,
      // systemProgram: web3.SystemProgram.programId,
      // associatedTokenProgram: ATA_PROGRAM_ID,
      eventAuthority: ea,
      program: PAMM_PROGRAM_ID,
      coinCreatorVaultAta: creatorVaultATA,
      coinCreatorVaultAuthority: creatorVaultAuth,
      feeConfig: feeCfg,
      feeProgram: FEE_PROGRAM_ID,
    })
    .preInstructions(preIxs)
    .rpc();

  return sig;
}

// ===== Mocha 用例（保持不变）=====
describe("pump-amm-swapper", () => {
  it("CPI BUY", async () => {
    if (POOL.toBase58().includes("<POOL_PUBKEY>")) {
      throw new Error("请把 <POOL_PUBKEY> 替换为真实池子地址，或通过 env 变量 POOL 传入。");
    }
    const baseOut = new BN(process.env.BASE_OUT ?? "1000000");     // 示例：1e6（按精度改）
    const maxQuoteIn = new BN(process.env.MAX_QUOTE_IN ?? "5000000");
    const sig = await buyAmm(POOL, baseOut, maxQuoteIn);
    console.log("BUY tx:", sig);
  });

  it("CPI SELL", async () => {
    if (POOL.toBase58().includes("<POOL_PUBKEY>")) {
      throw new Error("请把 <POOL_PUBKEY> 替换为真实池子地址，或通过 env 变量 POOL 传入。");
    }
    const baseIn = new BN(process.env.BASE_IN ?? "500000");
    // const minQuoteOut = new BN(process.env.MIN_QUOTE_OUT ?? "2000000");
    const minQuoteOut = new BN(process.env.MIN_QUOTE_OUT ?? "0"); // 🔶 修改：避免 ExceededSlippage
    const sig = await sellAmm(POOL, baseIn, minQuoteOut);
    console.log("SELL tx:", sig);
  });
});

