use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("7vbo8W8myMRKZRogqsF5u4RwZtUhN7BaFJR41StrhPkU");

// 基于 pamm.json 生成到本地的绑定：pump_amm::{cpi, program, types, ...}
declare_program!(pump_amm);

#[program]
pub mod pump_amm_swapper {
    use super::*;

    // === CPI: BUY ===
    // args: base_amount_out, max_quote_amount_in, track_volume (OptionBool)
    pub fn buy(
        ctx: Context<Buy>,
        base_amount_out: u64,
        max_quote_amount_in: u64,
        track_volume: pump_amm::types::OptionBool,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.program.to_account_info();

        let cpi_accounts = pump_amm::cpi::accounts::Buy {
            pool:                                 ctx.accounts.pool.to_account_info(),
            user:                                 ctx.accounts.user.to_account_info(),
            global_config:                        ctx.accounts.global_config.to_account_info(),
            base_mint:                            ctx.accounts.base_mint.to_account_info(),
            quote_mint:                           ctx.accounts.quote_mint.to_account_info(),
            user_base_token_account:              ctx.accounts.user_base_token_account.to_account_info(),
            user_quote_token_account:             ctx.accounts.user_quote_token_account.to_account_info(),
            pool_base_token_account:              ctx.accounts.pool_base_token_account.to_account_info(),
            pool_quote_token_account:             ctx.accounts.pool_quote_token_account.to_account_info(),
            protocol_fee_recipient:               ctx.accounts.protocol_fee_recipient.to_account_info(),
            protocol_fee_recipient_token_account: ctx.accounts.protocol_fee_recipient_token_account.to_account_info(),
            base_token_program:                   ctx.accounts.base_token_program.to_account_info(),
            quote_token_program:                  ctx.accounts.quote_token_program.to_account_info(),
            system_program:                       ctx.accounts.system_program.to_account_info(),
            associated_token_program:             ctx.accounts.associated_token_program.to_account_info(),
            event_authority:                      ctx.accounts.event_authority.to_account_info(),
            program:                              ctx.accounts.program.to_account_info(),
            coin_creator_vault_ata:               ctx.accounts.coin_creator_vault_ata.to_account_info(),
            coin_creator_vault_authority:         ctx.accounts.coin_creator_vault_authority.to_account_info(),
            global_volume_accumulator:            ctx.accounts.global_volume_accumulator.to_account_info(),
            user_volume_accumulator:              ctx.accounts.user_volume_accumulator.to_account_info(),
            fee_config:                           ctx.accounts.fee_config.to_account_info(),
            fee_program:                          ctx.accounts.fee_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        pump_amm::cpi::buy(cpi_ctx, base_amount_out, max_quote_amount_in, track_volume)
    }

    // === CPI: SELL ===
    // args: base_amount_in, min_quote_amount_out
    pub fn sell(
        ctx: Context<Sell>,
        base_amount_in: u64,
        min_quote_amount_out: u64,
    ) -> Result<()> {
        let cpi_program = ctx.accounts.program.to_account_info();

        let cpi_accounts = pump_amm::cpi::accounts::Sell {
            pool:                                 ctx.accounts.pool.to_account_info(),
            user:                                 ctx.accounts.user.to_account_info(),
            global_config:                        ctx.accounts.global_config.to_account_info(),
            base_mint:                            ctx.accounts.base_mint.to_account_info(),
            quote_mint:                           ctx.accounts.quote_mint.to_account_info(),
            user_base_token_account:              ctx.accounts.user_base_token_account.to_account_info(),
            user_quote_token_account:             ctx.accounts.user_quote_token_account.to_account_info(),
            pool_base_token_account:              ctx.accounts.pool_base_token_account.to_account_info(),
            pool_quote_token_account:             ctx.accounts.pool_quote_token_account.to_account_info(),
            protocol_fee_recipient:               ctx.accounts.protocol_fee_recipient.to_account_info(),
            protocol_fee_recipient_token_account: ctx.accounts.protocol_fee_recipient_token_account.to_account_info(),
            base_token_program:                   ctx.accounts.base_token_program.to_account_info(),
            quote_token_program:                  ctx.accounts.quote_token_program.to_account_info(),
            system_program:                       ctx.accounts.system_program.to_account_info(),
            associated_token_program:             ctx.accounts.associated_token_program.to_account_info(),
            event_authority:                      ctx.accounts.event_authority.to_account_info(),
            program:                              ctx.accounts.program.to_account_info(),
            coin_creator_vault_ata:               ctx.accounts.coin_creator_vault_ata.to_account_info(),
            coin_creator_vault_authority:         ctx.accounts.coin_creator_vault_authority.to_account_info(),
            fee_config:                           ctx.accounts.fee_config.to_account_info(),
            fee_program:                          ctx.accounts.fee_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        pump_amm::cpi::sell(cpi_ctx, base_amount_in, min_quote_amount_out)
    }
}

// ---- Accounts（字段名与 pamm.json 一致）----
#[derive(Accounts)]
pub struct Buy<'info> {
    /// CHECK:
    pub pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK:
    pub global_config: UncheckedAccount<'info>,

    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_quote_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub pool_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_quote_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    pub protocol_fee_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub protocol_fee_recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: 允许 Token / Token-2022 任一
    pub base_token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub quote_token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: PDA(["__event_authority"])
    pub event_authority: UncheckedAccount<'info>,

    /// pAMM 程序
    pub program: Program<'info, pump_amm::program::PumpAmm>,

    #[account(mut)]
    pub coin_creator_vault_ata: Account<'info, TokenAccount>,

    /// CHECK: PDA(["creator_vault", pool.coin_creator])
    pub coin_creator_vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: PDA(["global_volume_accumulator"])
    pub global_volume_accumulator: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: PDA(["user_volume_accumulator", user])
    pub user_volume_accumulator: UncheckedAccount<'info>,

    /// CHECK: PDA(["fee_config", <const 32 bytes>]) with program = fee_program
    pub fee_config: UncheckedAccount<'info>,

    /// CHECK: 常量地址 pfeeUxB6...
    pub fee_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    /// CHECK:
    pub pool: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK:
    pub global_config: UncheckedAccount<'info>,

    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_quote_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub pool_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_quote_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    pub protocol_fee_recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub protocol_fee_recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    pub base_token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub quote_token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK:
    pub event_authority: UncheckedAccount<'info>,
    pub program: Program<'info, pump_amm::program::PumpAmm>,

    #[account(mut)]
    pub coin_creator_vault_ata: Account<'info, TokenAccount>,

    /// CHECK:
    pub coin_creator_vault_authority: UncheckedAccount<'info>,

    /// CHECK:
    pub fee_config: UncheckedAccount<'info>,
    /// CHECK:
    pub fee_program: UncheckedAccount<'info>,
}
