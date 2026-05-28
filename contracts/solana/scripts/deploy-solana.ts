import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC ?? clusterApiUrl("devnet"),
    "confirmed"
  );

  const wallet = anchor.Wallet.local(); // uses ~/.config/solana/id.json
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("./target/idl/stablecoin.json", "utf8"));
  const program = new Program(idl, provider);

  // Create the SPL mint account
  const mintKeypair = Keypair.generate();
  const mint = await createMint(
    connection,
    wallet.payer,
    wallet.publicKey,   // mint authority
    wallet.publicKey,   // freeze authority
    6                   // decimals
  );

  console.log("INRX SPL Mint:", mint.toBase58());

  // Derive state PDA
  const [statePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state"), mint.toBuffer()],
    program.programId
  );

  const MINT_CAP = new anchor.BN(1_000_000_000 * 1_000_000); // 1B

  await program.methods.initialize(MINT_CAP)
  .accountsStrict({
      state:         statePda,
      mint:          mint,
      authority:     wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram:  anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .rpc();

  const addresses = {
    network: "devnet",
    programId: program.programId.toBase58(),
    mint: mint.toBase58(),
    statePda: statePda.toBase58(),
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync("./deployments/solana.json", JSON.stringify(addresses, null, 2));
  console.log("Solana deployment complete:", addresses);
}

main().catch(console.error);