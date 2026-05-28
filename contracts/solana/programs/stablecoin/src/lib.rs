use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};

declare_id!("HvFzXepn2hdJY7R2FNP2xZzNWgvi7W1EcBAZWzajpaQo");

#[program]
pub mod stablecoin {
    use super::*;

    /// Initialize the INRX mint on Solana
    pub fn initialize(
        ctx: Context<Initialize>,
        mint_cap: u64,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority  = ctx.accounts.authority.key();
        state.mint       = ctx.accounts.mint.key();
        state.mint_cap   = mint_cap;
        state.total_minted = 0;
        state.paused     = false;
        Ok(())
    }

    /// Mint INRX tokens (authority only)
    pub fn mint_tokens(
        ctx: Context<MintTokens>,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        require!(!state.paused, StablecoinError::Paused);
        require!(
            state.total_minted + amount <= state.mint_cap,
            StablecoinError::MintCapExceeded
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint:      ctx.accounts.mint.to_account_info(),
                to:        ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        token::mint_to(cpi_ctx, amount)?;

        let state = &mut ctx.accounts.state;
        state.total_minted += amount;
        Ok(())
    }

    /// Burn INRX tokens
    pub fn burn_tokens(
        ctx: Context<BurnTokens>,
        amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.state.paused, StablecoinError::Paused);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint:      ctx.accounts.mint.to_account_info(),
                from:      ctx.accounts.source.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::burn(cpi_ctx, amount)?;
        Ok(())
    }

    /// Pause all operations
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.state.paused = paused;
        Ok(())
    }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StateAccount::SIZE,
        seeds = [b"state", mint.key().as_ref()],
        bump
    )]
    pub state: Account<'info, StateAccount>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut, has_one = authority, has_one = mint)]
    pub state:       Account<'info, StateAccount>,
    #[account(mut)]
    pub mint:        Account<'info, Mint>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority:   Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub state:  Account<'info, StateAccount>,
    #[account(mut)]
    pub mint:   Account<'info, Mint>,
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,
    pub owner:  Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, has_one = authority)]
    pub state:     Account<'info, StateAccount>,
    pub authority: Signer<'info>,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct StateAccount {
    pub authority:    Pubkey,  // 32
    pub mint:         Pubkey,  // 32
    pub mint_cap:     u64,     // 8
    pub total_minted: u64,     // 8
    pub paused:       bool,    // 1
}

impl StateAccount {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 1 + 8;
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum StablecoinError {
    #[msg("Contract is paused")]
    Paused,
    #[msg("Mint cap exceeded")]
    MintCapExceeded,
    #[msg("Unauthorized")]
    Unauthorized,
}