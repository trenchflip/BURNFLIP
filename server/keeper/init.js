import "dotenv/config";
import fs from "fs";
import path from "path";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(process.env.BURNFLIP_PROGRAM_ID || "11111111111111111111111111111111");
const MINT = new PublicKey(process.env.BURNFLIP_MINT || "8R5GEZbit9caGoqWq2bwZt2SJykQYPfZL9Rwe3enpump");
const BURN_ADDRESS = new PublicKey(
  process.env.BURN_ADDRESS || "1nc1nerator11111111111111111111111111111111"
);
const AUTHORITY_KEYPAIR = process.env.AUTHORITY_KEYPAIR || process.env.KEEPER_KEYPAIR;
const DEPOSIT_LAMPORTS = Number(process.env.DEPOSIT_LAMPORTS || 0);

if (!AUTHORITY_KEYPAIR) {
  throw new Error("Missing AUTHORITY_KEYPAIR or KEEPER_KEYPAIR");
}

function loadKeypair(p) {
  const raw = fs.readFileSync(p, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const keypair = loadKeypair(AUTHORITY_KEYPAIR);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idlPath = path.resolve("./target/idl/burnflip_vault.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state"), MINT.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), statePda.toBuffer()],
    PROGRAM_ID
  );
  const [timelockPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("timelock"), statePda.toBuffer()],
    PROGRAM_ID
  );

  console.log("State PDA:", statePda.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Timelock PDA:", timelockPda.toBase58());

  const startingBalanceLamports = DEPOSIT_LAMPORTS;

  await program.methods
    .initialize(new anchor.BN(startingBalanceLamports), BURN_ADDRESS)
    .accounts({
      authority: wallet.publicKey,
      mint: MINT,
      state: statePda,
      vault: vaultPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  if (DEPOSIT_LAMPORTS > 0) {
    await program.methods
      .deposit(new anchor.BN(DEPOSIT_LAMPORTS))
      .accounts({
        authority: wallet.publicKey,
        state: statePda,
        vault: vaultPda,
        mint: MINT,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  console.log("Initialize complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
