// tests/utils.ts
import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";

// 官方 IDL 里的 Pool 账户 discriminator（你的 8 字节）
const POOL_DISCRIMINATOR = Uint8Array.from([
  241, 154, 109, 4, 17, 177, 109, 188,
]);

/**
 * 用 "types" 解码 Pool（保持 IDL 不变，不需要 program.account.pool）
 * 要求：pAMM 的 programId == 账户 owner；IDL.types 里存在 name="Pool" 的 struct
 */
export async function fetchPoolViaTypes(
  provider: AnchorProvider,
  pamm: Program<any>,
  poolPk: web3.PublicKey
) {
  const ai = await provider.connection.getAccountInfo(poolPk, "confirmed");
  if (!ai) throw new Error(`Pool account not found: ${poolPk.toBase58()}`);
  if (!ai.owner.equals(pamm.programId)) {
    throw new Error(
      `Owner mismatch: expected ${pamm.programId.toBase58()}, got ${ai.owner.toBase58()}`
    );
  }
  // 校验 discriminator
  const disc = ai.data.slice(0, 8);
  for (let i = 0; i < 8; i++) {
    if (disc[i] !== POOL_DISCRIMINATOR[i]) {
      throw new Error(`Discriminator mismatch for Pool at ${poolPk.toBase58()}`);
    }
  }
  // 注意anchor的驼峰转换
  console.log("pamm.programId:", pamm.programId.toBase58());
  console.log("IDL accounts:", (pamm.idl as any).accounts?.map((a: any) => a.name));
  console.log("IDL types:", (pamm.idl as any).types?.map((t: any) => t.name));

  // 用 "types" 里的 Pool 结构解码（去掉前 8 字节）.注意Anchor对大小写的转化
  const decoded: any = (pamm.coder as any).types.decode("pool", ai.data.slice(8));
  console.log("POOL properties are ", decoded);

  // 返回 camelCase 字段
  return {
    poolBump: decoded.poolBump as number,
    index: decoded.index as number,
    creator: new web3.PublicKey(decoded.creator),
    baseMint: new web3.PublicKey(decoded.baseMint),
    quoteMint: new web3.PublicKey(decoded.quoteMint),
    lpMint: new web3.PublicKey(decoded.lpMint),
    poolBaseTokenAccount: new web3.PublicKey(decoded.poolBaseTokenAccount),
    poolQuoteTokenAccount: new web3.PublicKey(decoded.poolQuoteTokenAccount),
    lpSupply: decoded.lpSupply as bigint | number,
    coinCreator: new web3.PublicKey(decoded.coinCreator),
  };
}
